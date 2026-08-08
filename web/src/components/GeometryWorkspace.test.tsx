import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { hasTranslation } from '../i18n/translations'
import { AdvancedDiagnosticsHelp, GeometryCapabilityDialog, GeometryClipPopover } from './GeometryWorkspace'

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

  it('renders accessible advanced diagnostic principles with Chinese coverage', () => {
    const html = renderToStaticMarkup(
      <I18nProvider><AdvancedDiagnosticsHelp /></I18nProvider>,
    )
    const messages = [
      'About advanced diagnostics',
      'How advanced diagnostics work',
      'The server analyzes synchronized Flow360 UVF evidence on demand and keeps unsupported checks explicitly unknown.',
      'Quantized edge incidence, union-find, and BVH/SAT tests find open or non-manifold edges, disconnected components, and triangle self-intersections.',
      'Compares each provided CAD face area with a fraction of the median; triangle count is used only as a fallback proxy.',
      'Samples tessellation normals per Face and flags the maximum pairwise angle above the selected threshold; this is a curvature proxy, not a radius.',
      'Solid bounding-box separation is only a lower-bound proxy; exact gaps and clearances require a CAD-kernel or mesher diagnostic.',
      'Available means evidence was computed, proxy means an approximation, and unavailable or unknown is never treated as passed.',
    ]

    expect(html).toContain('role="tooltip"')
    expect(html).toContain('aria-label="About advanced diagnostics"')
    expect(html).toContain('How advanced diagnostics work')
    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })
})
