import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { filterVolumeZones, groupVolumeZones } from './VolumeZoneInspector'
import { VolumeZoneInspector } from './VolumeZoneInspector'
import type { VolumeZoneRow } from '../../lib/volumeMeshReview'

const zones: VolumeZoneRow[] = [
  { id: 'fluid-1', name: 'Main Fluid', zoneType: 'fluid', typeProvenance: 'provided', color: '#aaa', visible: true },
  { id: 'rotor-1', name: 'Rotor', zoneType: 'rotation', typeProvenance: 'provided', color: '#bbb', visible: true },
  { id: 'zone-3', name: 'Mystery', zoneType: 'unknown', typeProvenance: 'unknown', color: '#ccc', visible: true, path: ['root', 'porous-block'] },
]

describe('VolumeZoneInspector filters', () => {
  it('searches stable id, display name, and type', () => {
    expect(filterVolumeZones(zones, 'rotor', 'all').map((zone) => zone.id)).toEqual(['rotor-1'])
    expect(filterVolumeZones(zones, 'fluid', 'all').map((zone) => zone.id)).toEqual(['fluid-1'])
    expect(filterVolumeZones(zones, 'porous-block', 'all').map((zone) => zone.id)).toEqual(['zone-3'])
  })

  it('filters unknown zone semantics explicitly', () => {
    expect(filterVolumeZones(zones, '', 'unknown').map((zone) => zone.id)).toEqual(['zone-3'])
  })

  it('creates real type groups instead of presenting a type filter', () => {
    expect(groupVolumeZones(zones).map(({ type, zones }) => [type, zones.length])).toEqual([
      ['fluid', 1],
      ['rotation', 1],
      ['unknown', 1],
    ])
  })

  it('keeps the full name available and exposes the selected row state', () => {
    const html = renderToStaticMarkup(createElement(
      I18nProvider,
      null,
      createElement(VolumeZoneInspector, {
        inventory: zones,
        selectedId: 'fluid-1',
        visibility: { 'fluid-1': true, 'rotor-1': true, 'zone-3': true },
        onSelect: () => undefined,
        onSetVisibility: () => undefined,
      }),
    ))

    expect(html).toContain('title="Main Fluid"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Collapse fluid')
    expect(html).not.toContain('aria-label="Isolate Main Fluid"')
    expect(html).not.toContain('Filter VolumeMesh zones by type')
  })
})
