import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { ParameterEntityInventory } from './DraftEntityInventory'

describe('ParameterEntityInventory', () => {
  it('lists draft entities as hidden by default', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ParameterEntityInventory
          entities={[{ id: 'box-1', key: 'draft:box-1', name: 'Wake box', type: 'Box', source: 'draft', renderable: true, raw: {} }]}
          visibility={{}}
          onVisibilityChange={() => undefined}
          source="draft"
        />
      </I18nProvider>,
    )
    expect(html).toContain('Draft entities')
    expect(html).toContain('Wake box')
    expect(html).toContain('class="geometry-entity-row hidden"')
    expect(html).toContain('aria-label="Show parameter entity Wake box"')
    expect(html).toContain('aria-pressed="false"')
  })

  it('lists metadata-only wind-tunnel ghost surfaces without a misleading visibility action', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ParameterEntityInventory
          entities={[{ id: 'inlet', key: 'ghost:inlet', name: 'windTunnelInlet', type: 'WindTunnelGhostSurface', source: 'ghost', renderable: false, raw: {} }]}
          visibility={{}}
          onVisibilityChange={() => undefined}
          source="ghost"
        />
      </I18nProvider>,
    )
    expect(html).toContain('Ghost entities')
    expect(html).toContain('windTunnelInlet')
    expect(html).toContain('Metadata only')
    expect(html).toContain('aria-label="Spatial geometry is unavailable"')
    expect(html).toContain('disabled=""')
  })

  it('offers creation in an empty editable Draft entity group', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ParameterEntityInventory
          entities={[]}
          visibility={{}}
          onVisibilityChange={() => undefined}
          onMutate={async () => undefined}
          source="draft"
        />
      </I18nProvider>,
    )
    expect(html).toContain('Draft entities')
    expect(html).toContain('Add entity')
  })
})
