import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GeometryClipPopover } from './GeometryWorkspace'

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
