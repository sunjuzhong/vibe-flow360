import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResourceReviewLayout } from './ResourceReviewLayout'

describe('ResourceReviewLayout', () => {
  it('provides the shared inventory, viewer, and inspector hierarchy', () => {
    const markup = renderToStaticMarkup(
      <ResourceReviewLayout
        className="surface-review-workspace"
        inventory={<span>Boundaries</span>}
        viewer={<span>Surface viewer</span>}
        inspector={<span>Engineering review</span>}
        inventoryLabel="SurfaceMesh boundary inventory"
        inspectorLabel="SurfaceMesh engineering review"
      />,
    )

    expect(markup).toContain('resource-review-workspace geometry-review-workspace surface-review-workspace')
    expect(markup).toContain('resource-review-inventory geometry-entity-panel')
    expect(markup).toContain('resource-review-viewer geometry-review-viewer')
    expect(markup).toContain('resource-review-inspector geometry-review-panel')
    expect(markup).toContain('aria-label="SurfaceMesh boundary inventory"')
    expect(markup).toContain('data-review-region="inventory"')
    expect(markup).toContain('data-review-region="viewer"')
    expect(markup).toContain('data-review-region="inspector"')
    expect(markup).toContain('style="grid-area:inventory"')
    expect(markup).toContain('style="grid-area:viewer;order:0"')
    expect(markup).toContain('style="grid-area:inspector"')
    expect(markup.indexOf('data-review-region="inventory"')).toBeLessThan(
      markup.indexOf('data-review-region="viewer"'),
    )
    expect(markup.indexOf('data-review-region="viewer"')).toBeLessThan(
      markup.indexOf('data-review-region="inspector"'),
    )
  })

})
