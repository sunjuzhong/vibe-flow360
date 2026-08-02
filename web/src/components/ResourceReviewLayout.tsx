import type { ReactNode } from 'react'
import './ResourceReviewLayout.css'

export function ResourceReviewLayout({
  className = '',
  inventory,
  viewer,
  inspector,
  inventoryLabel,
  inspectorLabel,
}: {
  className?: string
  inventory: ReactNode
  viewer: ReactNode
  inspector: ReactNode
  inventoryLabel: string
  inspectorLabel: string
}) {
  return (
    <section className={`resource-review-workspace geometry-review-workspace ${className}`.trim()}>
      <aside
        className="resource-review-inventory geometry-entity-panel"
        data-review-region="inventory"
        style={{ gridArea: 'inventory' }}
        aria-label={inventoryLabel}
      >
        {inventory}
      </aside>
      <div
        className="viewer-section resource-review-viewer geometry-review-viewer"
        data-review-region="viewer"
        style={{ gridArea: 'viewer', order: 0 }}
      >
        {viewer}
      </div>
      <aside
        className="resource-review-inspector geometry-review-panel"
        data-review-region="inspector"
        style={{ gridArea: 'inspector' }}
        aria-label={inspectorLabel}
      >
        {inspector}
      </aside>
    </section>
  )
}
