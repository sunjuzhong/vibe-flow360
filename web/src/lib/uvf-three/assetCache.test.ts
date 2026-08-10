import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { UVFAsset } from './types'
import { UVFAssetLRU } from './assetCache'

function fakeAsset(dispose = vi.fn()): UVFAsset {
  return {
    object: new THREE.Group(),
    faces: 0,
    edges: 0,
    vertices: 0,
    triangles: 0,
    fields: [],
    lodLevels: 1,
    currentLOD: 0,
    entityLODs: {},
    entities: [],
    getEntityObject: () => undefined,
    dispose,
  }
}

describe('UVFAssetLRU', () => {
  it('reuses decoded assets and evicts the least-recently-used unpinned frame', async () => {
    const assets = new Map<string, UVFAsset>()
    const load = vi.fn(async (url: string) => {
      const asset = fakeAsset()
      assets.set(url, asset)
      return asset
    })
    const cache = new UVFAssetLRU(3, load)

    const first = await cache.acquire('frame-1')
    cache.release('frame-1')
    expect(await cache.acquire('frame-1')).toBe(first)
    cache.release('frame-1')
    for (const url of ['frame-2', 'frame-3', 'frame-4']) {
      await cache.acquire(url)
      cache.release(url)
    }

    expect(cache.size).toBe(3)
    expect(cache.has('frame-1')).toBe(false)
    expect(assets.get('frame-1')?.dispose).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledTimes(4)
    cache.dispose()
  })

  it('cancels an obsolete prefetch while retaining current targets', async () => {
    const aborted: string[] = []
    const load = vi.fn((url: string, { signal }: { signal?: AbortSignal }) => new Promise<UVFAsset>((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        aborted.push(url)
        reject(new DOMException('aborted', 'AbortError'))
      }, { once: true })
      if (url === 'frame-2') resolve(fakeAsset())
    }))
    const cache = new UVFAssetLRU(5, load)

    cache.prefetch(['frame-1'])
    cache.prefetch(['frame-2'])
    await Promise.resolve()

    expect(aborted).toEqual(['frame-1'])
    expect(cache.has('frame-1')).toBe(false)
    expect(cache.has('frame-2')).toBe(true)
    cache.dispose()
  })
})
