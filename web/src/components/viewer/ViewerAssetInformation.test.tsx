import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { ViewerAssetInformation } from './ViewerAssetInformation'

describe('ViewerAssetInformation', () => {
  it('renders loaded mesh statistics as right-panel information', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ViewerAssetInformation stats={{ faces: 6, edges: 12, triangles: 384 }} />
      </I18nProvider>,
    )

    expect(html).toContain('aria-label="Mesh statistics"')
    expect(html).toContain('<dt>Faces</dt><dd>6</dd>')
    expect(html).toContain('<dt>Edges</dt><dd>12</dd>')
    expect(html).toContain('<dt>Triangles</dt><dd>384</dd>')
  })

  it('stays absent until real viewer statistics are available', () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ViewerAssetInformation stats={null} /></I18nProvider>,
    )
    expect(html).toBe('')
  })
})
