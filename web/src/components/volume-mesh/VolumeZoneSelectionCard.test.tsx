import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import type { VolumeZoneRow } from '../../lib/volumeMeshReview'
import { VolumeZoneSelectionCard } from './VolumeZoneSelectionCard'

const selectedZone: VolumeZoneRow = {
  id: 'slice-flat',
  name: 'Worst-quality x-normal slice based on maximum aspect ratio in zone fluid (flat)',
  color: '#78939a',
  visible: true,
  triangles: 120398,
  vertices: 40210,
  zoneType: 'fluid',
  typeProvenance: 'name-inferred',
}

describe('VolumeZoneSelectionCard', () => {
  it('shows the complete selected-zone identity, properties, and actions', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <VolumeZoneSelectionCard
          zone={selectedZone}
          visible
          contextOnly={false}
          onFocus={() => undefined}
          onIsolate={() => undefined}
          onToggleVisibility={() => undefined}
          onShowAll={() => undefined}
          onClear={() => undefined}
        />
      </I18nProvider>,
    )

    expect(html).toContain(selectedZone.name)
    expect(html).not.toContain(selectedZone.id)
    expect(html).toContain('120,398')
    expect(html).toContain('40,210')
    expect(html).toContain('Selection actions')
    expect(html).toContain('Focus')
    expect(html).toContain('Isolate')
    expect(html).toContain('Clear selection')
  })
})
