import { describe, expect, it } from 'vitest'
import {
  buildGeometryEntityAppearances,
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

  it('shares custom presets and editable builtin overrides', () => {
    const storage = memoryStorage()
    const custom = newGeometryAppearance('Shared style', '#334455', 0.8, 'shared')
    const editedBuiltins = defaultGeometryAppearances.map((appearance) =>
      appearance.id === 'default-cad' ? { ...appearance, opacity: 0.42 } : appearance,
    )
    saveGeometryAppearanceLibrary([...editedBuiltins, custom], storage)
    const loaded = loadGeometryAppearanceLibrary(storage)
    expect(loaded).toHaveLength(defaultGeometryAppearances.length + 1)
    expect(loaded[0]).toMatchObject({ id: 'default-cad', opacity: 0.42, builtin: true })
    expect(loaded.at(-1)).toMatchObject({ id: 'shared', name: 'Shared style' })
  })

  it('creates normalized custom appearances', () => {
    expect(newGeometryAppearance('  Steel look  ', '#abcdef', 0.7, 'appearance-1')).toEqual({
      id: 'appearance-1', name: 'Steel look', color: '#abcdef', opacity: 0.7,
    })
  })

  it('reactively derives every face bound to a changed appearance', () => {
    const assignments = { faceA: 'shared', faceB: 'shared' }
    const before = buildGeometryEntityAppearances(assignments, [
      { id: 'shared', name: 'Shared', color: '#112233', opacity: 0.8 },
    ])
    const after = buildGeometryEntityAppearances(assignments, [
      { id: 'shared', name: 'Shared', color: '#aabbcc', opacity: 0.35 },
    ])
    expect(before.faceA).toEqual({ color: '#112233', opacity: 0.8 })
    expect(after).toEqual({
      faceA: { color: '#aabbcc', opacity: 0.35 },
      faceB: { color: '#aabbcc', opacity: 0.35 },
    })
  })

  it('treats unassigned faces as reactively bound to Default CAD', () => {
    const appearances = defaultGeometryAppearances.map((appearance) =>
      appearance.id === 'default-cad' ? { ...appearance, opacity: 0.3 } : appearance,
    )
    expect(buildGeometryEntityAppearances({}, appearances, ['faceA', 'faceB'])).toEqual({
      faceA: { color: '#6f8790', opacity: 0.3 },
      faceB: { color: '#6f8790', opacity: 0.3 },
    })
  })
})
