import { UVFLoader } from './loader'
import type { UVFAsset, UVFLoadProgress } from './types'

export type UVFAssetLoadOptions = {
  signal?: AbortSignal
  onProgress?: (progress: UVFLoadProgress) => void
}

type AssetLoader = (url: string, options: UVFAssetLoadOptions) => Promise<UVFAsset>

type CacheEntry = {
  url: string
  controller: AbortController
  promise: Promise<UVFAsset>
  asset: UVFAsset | null
  references: number
  prefetched: boolean
  lastUsed: number
}

function abortError() {
  return new DOMException('The UVF asset request was aborted', 'AbortError')
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const aborted = () => {
      signal.removeEventListener('abort', aborted)
      reject(abortError())
    }
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', aborted)
        resolve(value)
      },
      (cause) => {
        signal.removeEventListener('abort', aborted)
        reject(cause)
      },
    )
  })
}

/**
 * Bounded cache for immutable UVF frame assets. Active scene assets are pinned;
 * neighbouring frames remain decoded until LRU eviction.
 */
export class UVFAssetLRU {
  private readonly entries = new Map<string, CacheEntry>()
  private clock = 0
  private disposed = false

  constructor(
    readonly capacity = 5,
    private readonly loadAsset: AssetLoader = (url, options) => new UVFLoader().load(url, options),
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('UVF asset cache capacity must be positive')
  }

  async acquire(url: string, options: UVFAssetLoadOptions = {}): Promise<UVFAsset> {
    if (this.disposed) throw new Error('UVF asset cache is disposed')
    const entry = this.ensure(url, options.onProgress)
    entry.references++
    entry.lastUsed = ++this.clock
    try {
      return await waitWithSignal(entry.promise, options.signal)
    } catch (cause) {
      this.release(url)
      throw cause
    }
  }

  release(url: string) {
    const entry = this.entries.get(url)
    if (!entry) return
    entry.references = Math.max(0, entry.references - 1)
    entry.lastUsed = ++this.clock
    if (!entry.asset && entry.references === 0 && !entry.prefetched) {
      entry.controller.abort()
      this.entries.delete(url)
    }
    this.trim()
  }

  prefetch(urls: readonly string[]) {
    if (this.disposed) return
    const targets = new Set(urls.filter(Boolean))
    for (const entry of this.entries.values()) entry.prefetched = targets.has(entry.url)
    for (const url of targets) {
      const entry = this.ensure(url)
      entry.prefetched = true
      entry.lastUsed = ++this.clock
      void entry.promise.catch(() => undefined)
    }
    for (const [url, entry] of this.entries) {
      if (!entry.asset && entry.references === 0 && !entry.prefetched) {
        entry.controller.abort()
        this.entries.delete(url)
      }
    }
    this.trim()
  }

  get size() {
    return this.entries.size
  }

  has(url: string) {
    return this.entries.has(url)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.values()) {
      entry.controller.abort()
      entry.asset?.dispose()
    }
    this.entries.clear()
  }

  private ensure(url: string, onProgress?: (progress: UVFLoadProgress) => void) {
    const existing = this.entries.get(url)
    if (existing) return existing
    const controller = new AbortController()
    const entry: CacheEntry = {
      url,
      controller,
      promise: Promise.resolve(null as unknown as UVFAsset),
      asset: null,
      references: 0,
      prefetched: false,
      lastUsed: ++this.clock,
    }
    entry.promise = this.loadAsset(url, { signal: controller.signal, onProgress })
      .then((asset) => {
        if (this.disposed || controller.signal.aborted) {
          asset.dispose()
          throw abortError()
        }
        entry.asset = asset
        entry.lastUsed = ++this.clock
        this.trim()
        return asset
      })
      .catch((cause) => {
        if (this.entries.get(url) === entry) this.entries.delete(url)
        throw cause
      })
    this.entries.set(url, entry)
    return entry
  }

  private trim() {
    if (this.entries.size <= this.capacity) return
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.references === 0 && !entry.prefetched)
      .sort((left, right) => left.lastUsed - right.lastUsed)
    for (const entry of candidates) {
      if (this.entries.size <= this.capacity) break
      entry.controller.abort()
      entry.asset?.dispose()
      this.entries.delete(entry.url)
    }
  }
}
