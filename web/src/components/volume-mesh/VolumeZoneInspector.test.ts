import { describe, expect, it } from 'vitest'
import { filterVolumeZones } from './VolumeZoneInspector'
import type { VolumeZoneRow } from '../../lib/volumeMeshReview'

const zones: VolumeZoneRow[] = [
  { id: 'fluid-1', name: 'Main Fluid', zoneType: 'fluid', typeProvenance: 'provided', color: '#aaa', visible: true },
  { id: 'rotor-1', name: 'Rotor', zoneType: 'rotation', typeProvenance: 'provided', color: '#bbb', visible: true },
  { id: 'zone-3', name: 'Mystery', zoneType: 'unknown', typeProvenance: 'unknown', color: '#ccc', visible: true },
]

describe('VolumeZoneInspector filters', () => {
  it('searches stable id, display name, and type', () => {
    expect(filterVolumeZones(zones, 'rotor', 'all').map((zone) => zone.id)).toEqual(['rotor-1'])
    expect(filterVolumeZones(zones, 'fluid', 'all').map((zone) => zone.id)).toEqual(['fluid-1'])
  })

  it('filters unknown zone semantics explicitly', () => {
    expect(filterVolumeZones(zones, '', 'unknown').map((zone) => zone.id)).toEqual(['zone-3'])
  })
})
