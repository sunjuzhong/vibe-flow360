import { describe, expect, it } from 'vitest'
import {
  loadSurfaceQualityFilter,
  parseSurfaceQualityFilter,
  saveSurfaceQualityFilter,
  surfaceQualityFilterStorageKey,
} from './surfaceQualityFilters'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('surface quality filter persistence', () => {
  it('saves independent compound filters per SurfaceMesh resource', () => {
    const storage = memoryStorage()
    const filter = {
      enabled: true,
      operator: 'and' as const,
      rules: [
        { id: 'one', fieldName: 'area', min: 1e-8, max: 1e-5 },
        { id: 'two', fieldName: 'skewness', min: 0.8, max: 1 },
      ],
    }
    saveSurfaceQualityFilter('sm-1', filter, storage)

    expect(loadSurfaceQualityFilter('sm-1', storage)).toEqual(filter)
    expect(loadSurfaceQualityFilter('sm-2', storage).rules).toEqual([])
    expect(storage.getItem(surfaceQualityFilterStorageKey('sm-1'))).not.toBeNull()
  })

  it('rejects malformed persisted rules and normalizes reversed bounds', () => {
    expect(parseSurfaceQualityFilter({ enabled: true, operator: 'xor', rules: [] })).toBeNull()
    expect(parseSurfaceQualityFilter({
      enabled: true,
      operator: 'or',
      rules: [{ id: 'one', fieldName: 'area', min: 10, max: 2 }],
    })).toEqual({
      enabled: true,
      operator: 'or',
      rules: [{ id: 'one', fieldName: 'area', min: 2, max: 10 }],
    })
  })
})
