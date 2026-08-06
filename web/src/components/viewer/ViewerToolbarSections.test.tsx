import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ViewerToolbarSections } from './ViewerToolbarSections'

describe('ViewerToolbarSections', () => {
  it('separates target workflow controls from independent viewer actions', () => {
    const html = renderToStaticMarkup(
      <ViewerToolbarSections
        goal={<button type="button">Quality</button>}
        actions={<button type="button">Measure</button>}
      />,
    )

    expect(html).toContain('aria-label="Target workflow controls"')
    expect(html).toContain('aria-label="Viewer actions"')
    expect(html).toContain('>Quality<')
    expect(html).toContain('>Measure<')
  })
})
