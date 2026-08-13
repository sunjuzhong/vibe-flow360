import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { DraftEntityInventory } from './DraftEntityInventory'

describe('DraftEntityInventory', () => {
  it('lists draft entities as hidden by default', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <DraftEntityInventory
          entities={[{ id: 'box-1', name: 'Wake box', type: 'Box', raw: {} }]}
          visibility={{}}
          onVisibilityChange={() => undefined}
        />
      </I18nProvider>,
    )
    expect(html).toContain('Draft entities')
    expect(html).toContain('Wake box')
    expect(html).toContain('class="geometry-entity-row hidden"')
    expect(html).toContain('aria-label="Show draft entity Wake box"')
    expect(html).toContain('aria-pressed="false"')
  })
})
