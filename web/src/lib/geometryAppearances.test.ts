import { describe, expect, it } from 'vitest'
import {
  buildGeometryEntityAppearances,
  canDeleteGeometryAppearance,
  clearGeometryAppearanceOverrides,
  cfdGeometryAppearancePresets,
  defaultGeometryAppearances,
  geometryAppearancePresetForBoundary,
  isGeometryAppearancePreset,
  loadGeometryAppearanceLibrary,
  loadGeometryAppearanceAssignments,
  newGeometryAppearance,
  parseGeometryAppearanceLibrary,
  resolveGeometryAppearanceAssignments,
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
  it('migrates legacy seeds and rejects malformed custom appearances', () => {
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

  it('shares regular seeded materials and their edits', () => {
    const storage = memoryStorage()
    const custom = newGeometryAppearance('Shared style', '#334455', 0.8, 'shared')
    const editedSeeds = defaultGeometryAppearances.map((appearance) =>
      appearance.id === 'default-cad' ? { ...appearance, opacity: 0.42 } : appearance,
    )
    saveGeometryAppearanceLibrary([...editedSeeds, custom], storage)
    const loaded = loadGeometryAppearanceLibrary(storage)
    expect(loaded).toHaveLength(defaultGeometryAppearances.length + 1)
    expect(loaded[0]).toEqual({ id: 'default-cad', name: 'Default CAD', color: '#6f8790', opacity: 0.42 })
    expect(loaded.at(-1)).toMatchObject({ id: 'shared', name: 'Shared style' })
  })

  it('additively migrates version 2 libraries with CFD presets without overwriting edits', () => {
    const parsed = parseGeometryAppearanceLibrary(JSON.stringify({
      version: 2,
      items: [
        { id: 'default-cad', name: 'My CAD', color: '#112233', opacity: 0.42 },
        { id: 'custom', name: 'My style', color: '#334455', opacity: 0.8 },
      ],
    }))
    expect(parsed.find(({ id }) => id === 'default-cad')).toEqual({
      id: 'default-cad', name: 'My CAD', color: '#112233', opacity: 0.42,
    })
    expect(parsed.find(({ id }) => id === 'custom')?.name).toBe('My style')
    expect(cfdGeometryAppearancePresets.every((preset) => parsed.some(({ id }) => id === preset.id))).toBe(true)
  })

  it('does not restore retired presets from a saved library', () => {
    const storage = memoryStorage()
    saveGeometryAppearanceLibrary([
      ...defaultGeometryAppearances,
      { id: 'transparent', name: 'Transparent enclosure', color: '#8fb8c8', opacity: 0.28 },
      { id: 'rotating', name: 'Rotating zone', color: '#d59a2d', opacity: 0.78 },
    ], storage)
    const loadedIds = loadGeometryAppearanceLibrary(storage).map(({ id }) => id)
    expect(loadedIds).not.toContain('transparent')
    expect(loadedIds).not.toContain('rotating')
  })

  it('removes assignments to retired presets from local storage', () => {
    const storage = memoryStorage()
    saveGeometryAppearanceAssignments('geo-1', {
      faceA: 'transparent',
      faceB: 'rotating',
      faceC: 'custom',
    }, storage)
    expect(loadGeometryAppearanceAssignments('geo-1', storage)).toEqual({ faceC: 'custom' })
  })

  it('identifies every system preset while leaving custom materials deletable', () => {
    expect(defaultGeometryAppearances.every(({ id }) => isGeometryAppearancePreset(id))).toBe(true)
    expect(isGeometryAppearancePreset('appearance-custom')).toBe(false)
    expect(defaultGeometryAppearances.every(({ id }) => !canDeleteGeometryAppearance(id, defaultGeometryAppearances.length + 1))).toBe(true)
    expect(canDeleteGeometryAppearance('appearance-custom', defaultGeometryAppearances.length + 1)).toBe(true)
  })

  it('maps solver boundary types and semantic roles to display presets', () => {
    expect(geometryAppearancePresetForBoundary('Wall')).toBe('cfd-wall')
    expect(geometryAppearancePresetForBoundary('Freestream')).toBe('cfd-farfield')
    expect(geometryAppearancePresetForBoundary('VelocityInlet')).toBe('cfd-inflow')
    expect(geometryAppearancePresetForBoundary('PressureOutflow')).toBe('cfd-outflow')
    expect(geometryAppearancePresetForBoundary('SlipWall')).toBe('cfd-slip-wall')
    expect(geometryAppearancePresetForBoundary('Periodic')).toBe('cfd-periodic')
    expect(geometryAppearancePresetForBoundary('unknown')).toBeNull()
  })

  it('reactively resolves params, semantic edits, and explicit visual overrides in priority order', () => {
    expect(resolveGeometryAppearanceAssignments(
      { wing: 'cfd-wall', farfield: 'cfd-farfield' },
      { wing: 'cfd-slip-wall' },
      {},
    )).toEqual({ wing: 'cfd-wall', farfield: 'cfd-farfield' })
    expect(resolveGeometryAppearanceAssignments(
      { wing: 'cfd-wall' },
      { wing: 'cfd-slip-wall' },
      { wing: 'custom-red' },
    )).toEqual({ wing: 'custom-red' })
    expect(clearGeometryAppearanceOverrides({ wing: 'custom-red', farfield: 'custom-blue' }, ['wing']))
      .toEqual({ farfield: 'custom-blue' })
  })

  it('keeps Surface associations stable when a material name changes', () => {
    const assignments = { faceA: 'shared-material-id' }
    const before = buildGeometryEntityAppearances(assignments, [
      { id: 'shared-material-id', name: 'Old name', color: '#112233', opacity: 0.8 },
    ])
    const after = buildGeometryEntityAppearances(assignments, [
      { id: 'shared-material-id', name: 'Renamed safely', color: '#112233', opacity: 0.8 },
    ])
    expect(after).toEqual(before)
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

  it('falls back to Default CAD when a saved appearance no longer exists', () => {
    expect(buildGeometryEntityAppearances(
      { faceA: 'transparent' },
      defaultGeometryAppearances,
      ['faceA'],
    )).toEqual({ faceA: { color: '#6f8790', opacity: 0.9 } })
  })
})
