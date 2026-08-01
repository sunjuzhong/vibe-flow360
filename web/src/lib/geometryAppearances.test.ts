import { describe, expect, it } from 'vitest'
import {
  defaultGeometryAppearances,
  loadGeometryAppearanceLibrary,
  loadGeometryAppearanceAssignments,
  newGeometryAppearance,
  parseGeometryAppearanceLibrary,
  saveGeometryAppearanceAssignments,
  saveGeometryAppearanceLibrary,
} from './geometryAppearances'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('geometry appearance persistence', () => {
  it('keeps builtins and rejects malformed custom appearances', () => {
    const parsed = parseGeometryAppearanceLibrary(JSON.stringify([
      { id: 'custom', name: 'My style', color: '#123456', opacity: 0.6 },
      { id: 'broken', name: 'Broken', color: 'red', opacity: 4 },
    ]))
    expect(parsed).toHaveLength(defaultGeometryAppearances.length + 1)
    expect(parsed.at(-1)?.id).toBe('custom')
  })

  it('stores assignments separately for each Geometry resource', () => {
    const storage = memoryStorage()
    saveGeometryAppearanceAssignments('geo-1', { faceA: 'custom' }, storage)
    expect(loadGeometryAppearanceAssignments('geo-1', storage)).toEqual({ faceA: 'custom' })
    expect(loadGeometryAppearanceAssignments('geo-2', storage)).toEqual({})
  })

  it('shares custom presets without serializing builtins', () => {
    const storage = memoryStorage()
    const custom = newGeometryAppearance('Shared style', '#334455', 0.8, 'shared')
    saveGeometryAppearanceLibrary([...defaultGeometryAppearances, custom], storage)
    const loaded = loadGeometryAppearanceLibrary(storage)
    expect(loaded).toHaveLength(defaultGeometryAppearances.length + 1)
    expect(loaded.at(-1)).toMatchObject({ id: 'shared', name: 'Shared style' })
  })

  it('creates normalized custom appearances', () => {
    expect(newGeometryAppearance('  Steel look  ', '#abcdef', 0.7, 'appearance-1')).toEqual({
      id: 'appearance-1', name: 'Steel look', color: '#abcdef', opacity: 0.7,
    })
  })
})
