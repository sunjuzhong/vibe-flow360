import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { hasTranslation } from '../i18n/translations'
import {
  AdvancedDiagnosticsHelp,
  GeometryCapabilityDialog,
  GeometryPreflightHelp,
} from './GeometryWorkspace'

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
      'How advanced diagnostics are calculated',
      'All findings come from the synchronized default-LOD Flow360 UVF manifest and indexed triangle buffers; the Geometry is not modified.',
      'Area threshold = median provided face area × selected ratio. If no face area exists, triangle threshold = max(2, floor(median triangle count × ratio)).',
      'Vertices are quantized at bounding-box diagonal × 1e-8. Edge incidence finds free and non-manifold edges, union-find counts connected components, and BVH plus SAT tests non-adjacent triangle intersections.',
      'Samples up to 128 indexed normals per Face and computes max acos(nᵢ · nⱼ). A Face is flagged when that angle reaches the selected threshold; this is a curvature proxy, not a radius.',
      'Computes the per-axis gaps between every pair of solid AABBs, then takes their Euclidean distance and the minimum pair. Overlapping boxes return zero and remain inconclusive.',
      'Exact face-to-face gaps require CAD B-rep and kernel distance queries. UVF does not contain that evidence, so exact CAD clearance stays unavailable.',
      'Available = computed evidence. Proxy = an approximation. Unavailable or unknown = insufficient evidence and is never treated as passed.',
      'Results depend on the synchronized UVF LOD, tessellation quality, and model coordinate scale. Confirm candidates in 3D or with a CAD kernel before changing Geometry or meshing settings.',
    ]

    expect(html).toContain('role="tooltip"')
    expect(html).toContain('aria-label="About advanced diagnostics"')
    expect(html).toContain('help-tooltip--guide')
    expect(html).toContain('How advanced diagnostics are calculated')
    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })

  it('renders accessible preflight evidence guidance with Chinese coverage', () => {
    const html = renderToStaticMarkup(
      <I18nProvider><GeometryPreflightHelp /></I18nProvider>,
    )
    const messages = [
      'About Geometry preflight evidence',
      'How Geometry preflight evidence works',
      'Preflight combines synchronized resource metadata with optional topology diagnostics. It reports evidence for review and never modifies the Geometry.',
      'Checks processing state, physical units, bounding-box dimensions, surface inventory, generated naming, and metadata read errors.',
      'When diagnostics have run, quantized edge incidence, union-find connectivity, and BVH/SAT intersection tests provide tessellation topology evidence.',
      'Blocked must be resolved before meshing; warning requires engineering review; unknown means evidence is missing; ready means that specific check passed.',
      'The synchronized Geometry metadata may not contain topology results. Run diagnostics to calculate supported checks; unsupported checks remain unknown, not passed.',
      'The panel records the algorithm version, source, scale-relative tolerance, triangle count, runtime, and completion time for auditability.',
      'Topology results describe the synchronized default-LOD tessellation, not exact CAD B-rep topology, and depend on tessellation quality and model scale.',
    ]

    expect(html).toContain('help-tooltip--guide')
    expect(html).toContain('aria-label="About Geometry preflight evidence"')
    expect(html).toContain('How Geometry preflight evidence works')
    expect(messages.filter((message) => !hasTranslation(message, 'zh-CN'))).toEqual([])
  })
})
