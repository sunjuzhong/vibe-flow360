import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { filterVolumeZones } from './VolumeZoneInspector'
import { VolumeZoneInspector } from './VolumeZoneInspector'
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

  it('keeps the full name available and exposes the selected row state', () => {
    const html = renderToStaticMarkup(createElement(
      I18nProvider,
      null,
      createElement(VolumeZoneInspector, {
        inventory: zones,
        selectedId: 'fluid-1',
        visibility: { 'fluid-1': true, 'rotor-1': true, 'zone-3': true },
        onSelect: () => undefined,
        onIsolate: () => undefined,
        onToggleVisibility: () => undefined,
        onShowAll: () => undefined,
        onHideAll: () => undefined,
      }),
    ))

    expect(html).toContain('title="Main Fluid"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Hide Main Fluid"')
    expect(html).toContain('aria-label="Isolate Main Fluid"')
  })
})
