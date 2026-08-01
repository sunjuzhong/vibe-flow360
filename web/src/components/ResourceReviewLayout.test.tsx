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
  })
})
