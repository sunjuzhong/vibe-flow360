import { describe, expect, it, vi } from 'vitest'
import type { ComponentType } from 'react'
import { importLazyRoute, lazyRouteReloadKey } from './lazyRoute'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

describe('importLazyRoute', () => {
  it('reloads once for the same stale dynamic import', async () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    const failure = new TypeError('Failed to fetch dynamically imported module: /assets/TutorialLibraryPage-old.js')

    await expect(importLazyRoute(() => Promise.reject(failure), storage, reload)).rejects.toBe(failure)
    await expect(importLazyRoute(() => Promise.reject(failure), storage, reload)).rejects.toBe(failure)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(storage.getItem(lazyRouteReloadKey)).toBe(failure.message)
  })

  it('clears recovery state after a successful import', async () => {
    const storage = memoryStorage()
    storage.setItem(lazyRouteReloadKey, 'old failure')
    const module = { default: (() => null) as ComponentType }

    await expect(importLazyRoute(() => Promise.resolve(module), storage, vi.fn())).resolves.toBe(module)
    expect(storage.getItem(lazyRouteReloadKey)).toBeNull()
  })

  it('does not reload for an application error', async () => {
    const reload = vi.fn()
    const failure = new Error('tutorial data is invalid')

    await expect(importLazyRoute(() => Promise.reject(failure), memoryStorage(), reload)).rejects.toBe(failure)
    expect(reload).not.toHaveBeenCalled()
  })
})
