import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GeometryCapabilityDialog, GeometryClipPopover } from './GeometryWorkspace'

describe('GeometryClipPopover', () => {
  it('renders clipping controls as a dismissible inspection dialog', () => {
    const html = renderToStaticMarkup(
      <GeometryClipPopover
        axis="y"
        position={0.25}
        onAxisChange={() => undefined}
        onPositionChange={() => undefined}
        onClose={() => undefined}
      />,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Inspection tools"')
    expect(html).toContain('aria-label="Close inspection tools"')
    expect(html).toContain('aria-label="Geometry clipping plane position"')
    expect(html).toContain('<option value="y" selected="">Y plane</option>')
  })
})

describe('GeometryCapabilityDialog', () => {
  it('renders focused capability content as a dismissible modal', () => {
    const html = renderToStaticMarkup(
      <GeometryCapabilityDialog
        title="Geometry health evidence"
        subtitle="4 warnings or unknown to review"
        icon={<span>!</span>}
        onClose={() => undefined}
      >
        <p>Warning evidence</p>
      </GeometryCapabilityDialog>,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-label="Geometry health evidence"')
    expect(html).toContain('aria-label="Close Geometry health evidence"')
    expect(html).toContain('4 warnings or unknown to review')
    expect(html).toContain('Warning evidence')
  })
})
