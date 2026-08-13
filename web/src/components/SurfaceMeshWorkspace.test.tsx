import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import SurfaceMeshWorkspace from './SurfaceMeshWorkspace'

const surfaceReviewScenario = vi.hoisted(() => ({
  mode: 'quality' as 'quality' | 'boundaries',
  selected: false,
}))

vi.mock('../hooks/useResourcePreview', () => ({
  useResourcePreview: () => ({
    manifest: { asset_url: '/surface/manifest.json', format: 'flow360-uvf', groups: [] },
    state: { status: 'ready' },
    source: 'primary',
    primaryError: '',
  }),
}))

vi.mock('../hooks/useSurfaceMeshReview', () => ({
  nextSurfaceSelection: vi.fn(),
  useSurfaceMeshReview: () => ({
    mode: surfaceReviewScenario.mode,
    selection: { groupId: surfaceReviewScenario.selected ? 'face-1' : null },
    selectedBoundaryIds: surfaceReviewScenario.selected ? ['face-1'] : [],
    visibility: { 'face-1': true },
    qualityFields: [{ name: 'area', kind: 'scalar', dimension: 1, min: 1e-8, max: 1e-4 }],
    qualityFieldNames: ['area'],
    selectedField: 'area',
    selectedFieldInfo: { name: 'area', kind: 'scalar', dimension: 1, min: 1e-8, max: 1e-4 },
    range: [1e-8, 1e-4],
    histogram: {
      field: { name: 'area', kind: 'scalar', dimension: 1, min: 1e-8, max: 1e-4 },
      sampleCount: 12,
      bins: [{ min: 1e-8, max: 1e-4, count: 12 }],
    },
    extrema: null,
    probe: null,
    focusTarget: null,
    boundaryInventory: [{
      id: 'face-1',
      name: 'Face 1',
      status: 'unassigned',
      triangles: 12,
      assignments: [],
    }],
    selectedBoundary: surfaceReviewScenario.selected ? {
      id: 'face-1',
      name: 'body00001_face00001_full_boundary_name',
      status: 'unassigned',
      triangles: 12,
      assignments: [],
    } : undefined,
    boundaryConflictCount: 0,
    surfaceParameters: [{ path: 'meshing.maxEdgeLength', label: 'Max edge length', value: '0.5 m' }],
    setMode: vi.fn(),
    setSelection: vi.fn(),
    setVisibility: vi.fn(),
    setSelectedField: vi.fn(),
    handleFieldsDiscovered: vi.fn(),
    setRange: vi.fn(),
    setHistogram: vi.fn(),
    setExtrema: vi.fn(),
    setProbe: vi.fn(),
    locateExtreme: vi.fn(),
    isolateBoundary: vi.fn(),
    isolateBoundaries: vi.fn(),
    toggleBoundaryVisibility: vi.fn(),
    showAllBoundaries: vi.fn(),
    hideAllBoundaries: vi.fn(),
  }),
}))

vi.mock('../hooks/useSurfaceQualityFilter', () => ({
  useSurfaceQualityFilter: () => ({
    filter: {
      enabled: true,
      operator: 'and',
      rules: [{ id: 'area-rule', fieldName: 'area', min: 1e-8, max: 1e-4 }],
    },
    matchCount: 4,
    addRule: vi.fn(),
    removeRule: vi.fn(),
    updateRule: vi.fn(),
    setEnabled: vi.fn(),
    setOperator: vi.fn(),
    reset: vi.fn(),
    setMatchCount: vi.fn(),
  }),
}))

vi.mock('../hooks/useSurfaceMeshAdvancedReview', () => ({
  useSurfaceMeshAdvancedReview: () => ({
    comparisonVersions: [],
    compareId: '',
    comparison: null,
    comparisonLoading: false,
    comparisonError: '',
    clipEnabled: false,
    clipAxis: 'x',
    clipPosition: 0,
    clipPlane: null,
    captureRequest: 0,
    remediationBusy: false,
    remediationError: '',
    setCompareId: vi.fn(),
    setClipEnabled: vi.fn(),
    setClipAxis: vi.fn(),
    setClipPosition: vi.fn(),
    requestCapture: vi.fn(),
    runRemediation: vi.fn(),
  }),
}))

vi.mock('../hooks/useWorkspaceViewerTools', () => ({
  useWorkspaceViewerTools: () => ({ toolInput: undefined, overlays: [], onDoubleClick: undefined }),
}))

vi.mock('./viewer/LazyViewer3D', () => ({
  LazyViewer3D: ({ toolbar, topToolbar, fieldPanelExtra }: {
    toolbar?: ReactNode
    topToolbar?: ReactNode
    fieldPanelExtra?: ReactNode | ((context: { field: { name: string; kind: 'scalar'; min: number; max: number }; range: [number, number] }) => ReactNode)
  }) => (
    <div data-testid="viewer">
      {toolbar}
      {topToolbar}
      {typeof fieldPanelExtra === 'function'
        ? fieldPanelExtra({ field: { name: 'area', kind: 'scalar', min: 1e-8, max: 1e-4 }, range: [1e-8, 1e-4] })
        : fieldPanelExtra}
    </div>
  ),
}))

vi.mock('../lib/viewer-tools/ViewerToolsUI', () => ({
  ViewerToolsDock: () => <button type="button">Tools</button>,
  ViewerToolPanel: () => null,
}))

describe('SurfaceMeshWorkspace capabilities', () => {
  it('keeps 3D-affecting controls inline and all primary actions reachable', () => {
    surfaceReviewScenario.mode = 'quality'
    surfaceReviewScenario.selected = false
    const html = renderToStaticMarkup(
      <I18nProvider>
        <SurfaceMeshWorkspace
          detail={null}
          resourceId="surface-1"
          projectId="project-1"
          resourceRef={{ id: 'surface-1', type: 'SurfaceMesh' }}
          annotationsModel={{} as never}
          versions={[]}
          onCreateRemediationPlan={async () => undefined}
          onPlanVolumeMesh={async () => undefined}
        />
      </I18nProvider>,
    )

    expect(html).toContain('Surface boundaries')
    expect(html).toContain('aria-label="Hide Face 1"')
    expect(html).toContain('title="Face 1"')
    expect(html.match(/role="checkbox"/g)).toHaveLength(1)
    expect(html).toContain('resource-review-toggle checked')
    expect(html).toContain('<strong>Mesh quality</strong>')
    expect(html).toContain('1 fields available')
    expect(html).toContain('surface-quality-filter-panel')
    expect(html).toContain('viewer-field-diagnostics')
    expect(html).toContain('Rule 1 minimum area')
    expect(html).toContain('Review evidence')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Advanced review')
    expect(html).toContain('Compare · Clip · Export · AI patch')
    expect(html).toContain('Toggle clipping plane')
    expect(html).toContain('Export PNG')
    expect(html).toContain('Tools')
    expect(html).toContain('Create Draft')
    expect(html).toContain('current SimulationParams')
    expect(html.indexOf('surface-quality-filter-panel')).toBeLessThan(
      html.indexOf('resource-review-launchers'),
    )
  })

  it('shows Geometry-style details and operations for a selected boundary', () => {
    surfaceReviewScenario.mode = 'boundaries'
    surfaceReviewScenario.selected = true
    const html = renderToStaticMarkup(
      <I18nProvider>
        <SurfaceMeshWorkspace
          detail={null}
          resourceId="surface-1"
          projectId="project-1"
          resourceRef={{ id: 'surface-1', type: 'SurfaceMesh' }}
          annotationsModel={{} as never}
          versions={[]}
          onCreateRemediationPlan={async () => undefined}
          onPlanVolumeMesh={async () => undefined}
        />
      </I18nProvider>,
    )

    expect(html).toContain('surface-boundary-selection-card')
    expect(html).toContain('body00001_face00001_full_boundary_name')
    expect(html).toContain('Selection actions')
    expect(html).toContain('Focus')
    expect(html).toContain('Isolate')
    expect(html).toContain('Hide')
    expect(html).toContain('Show all')
    expect(html).toContain('Clear')
  })
})
