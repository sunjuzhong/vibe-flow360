import {
  Activity,
  CheckCircle2,
  CircleDashed,
  GitPullRequestDraft,
  Grid3X3,
  Ruler,
  ScanLine,
  Triangle,
} from 'lucide-react'
import type { ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'
import { LazyViewer3D } from './viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import { useSurfaceMeshReview } from '../hooks/useSurfaceMeshReview'
import { SurfaceBoundaryInspector } from './surface-mesh/SurfaceBoundaryInspector'
import { SurfaceParameterSummary } from './surface-mesh/SurfaceParameterSummary'
import { SurfaceQualityInspector } from './surface-mesh/SurfaceQualityInspector'
import { SurfaceViewModeToolbar } from './surface-mesh/SurfaceViewModeToolbar'

const noSurfaceGroups: [] = []

function findMetric(value: unknown, aliases: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMetric(item, aliases)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const [key, child] of Object.entries(value)) {
    if (aliases.includes(key.toLowerCase())) return child
    const found = findMetric(child, aliases)
    if (found !== undefined) return found
  }
  return undefined
}

function metricText(value: unknown) {
  if (value === undefined || value === null || value === '') return 'Not reported'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'value' in value) {
    const metric = value as { value?: unknown; units?: unknown }
    return `${metric.value ?? '—'}${metric.units ? ` ${metric.units}` : ''}`
  }
  return JSON.stringify(value)
}

export default function SurfaceMeshWorkspace({
  detail,
  resourceId,
  geometryResourceId,
  onPlanVolumeMesh,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  geometryResourceId?: string | null
  onPlanVolumeMesh: () => void
}) {
  const { manifest, state: viewerState, source: previewSource, primaryError } = useResourcePreview(
    detail ? 'SurfaceMesh' : null,
    resourceId ?? detail?.id ?? null,
    detail && geometryResourceId ? 'Geometry' : null,
    geometryResourceId ?? null,
  )
  const review = useSurfaceMeshReview(
    manifest?.groups ?? noSurfaceGroups,
    detail?.simulation_params,
  )
  const source = detail?.summary ?? detail?.state ?? detail?.simulation_params
  const status = resourceStatus(detail)
  const terminal = ['completed', 'processed', 'success', 'failed', 'error'].includes(status.toLowerCase())
  const metrics = [
    {
      label: 'Surface elements',
      value: findMetric(source, ['face_count', 'surface_element_count', 'element_count', 'num_faces']),
      icon: Grid3X3,
    },
    {
      label: 'Minimum edge',
      value: findMetric(source, ['min_edge_length', 'minimum_edge_length', 'min_length']),
      icon: Ruler,
    },
    {
      label: 'Maximum aspect ratio',
      value: findMetric(source, ['max_aspect_ratio', 'maximum_aspect_ratio', 'aspect_ratio']),
      icon: Triangle,
    },
    {
      label: 'Maximum skewness',
      value: findMetric(source, ['max_skewness', 'maximum_skewness', 'skewness']),
      icon: ScanLine,
    },
  ]
  const checks = [
    { label: 'Surface mesh reached a terminal success state', ready: ['completed', 'processed', 'success'].includes(status.toLowerCase()) },
    { label: 'Simulation parameters are available', ready: Boolean(detail?.simulation_params && Object.keys(detail.simulation_params).length) },
    { label: 'No partial Flow360 reads were reported', ready: !detail?.errors || Object.keys(detail.errors).length === 0 },
  ]

  return (
    <section className="surface-mesh-workspace cfd-stage-workspace">
      <div className={`viewer-section cfd-stage-viewer surface-mode-${review.mode}`}>
        <LazyViewer3D
          manifest={manifest}
          state={viewerState}
          selection={review.selection}
          onSelectionChange={review.setSelection}
          entityVisibility={review.visibility}
          onEntityVisibilityChange={review.setVisibility}
          selectedField={review.mode === 'quality' ? review.selectedField : null}
          onSelectedFieldChange={review.setSelectedField}
          onFieldsDiscovered={review.handleFieldsDiscovered}
          fieldNames={review.qualityFieldNames}
          fieldRange={review.mode === 'quality' ? review.range : null}
          onFieldHistogramChange={review.setHistogram}
          onFieldExtremaChange={review.setExtrema}
          onFieldProbe={review.mode === 'quality' ? review.setProbe : undefined}
          focusTarget={review.focusTarget}
          showFieldPanel={review.mode === 'quality'}
          showEntityLegend={review.mode === 'boundaries'}
          toolbar={<SurfaceViewModeToolbar mode={review.mode} onChange={review.setMode} />}
        />
        <div className={`cfd-viewer-source ${previewSource === 'fallback' ? 'context' : ''}`} role="status" aria-live="polite">
          <ScanLine size={13} />
          <div>
            <strong id="surface-source-heading">{previewSource === 'fallback' ? 'Geometry context' : 'Surface mesh'}</strong>
            <span id="surface-source-detail">
              {previewSource === 'fallback'
                ? 'The SurfaceMesh render asset is unavailable; this is the parent Geometry, not the mesh.'
                : 'Inspect surface topology, boundaries, and element quality.'}
            </span>
          </div>
        </div>
        <aside className="cfd-decision-panel">
          <div className="mesh-workspace-heading">
            <div>
              <span>SURFACE MESH REVIEW</span>
              <strong>Is the surface discretization trustworthy?</strong>
              <small>{terminal ? `Flow360 status: ${status}` : 'Processing status refreshes automatically.'}</small>
            </div>
            <Activity size={20} />
          </div>
          <div className="mesh-quality-grid cfd-quality-strip">
            {metrics.map(({ label, value, icon: Icon }) => (
              <div key={label}>
                <Icon size={14} />
                <span>{label}</span>
                <strong>{metricText(value)}</strong>
              </div>
            ))}
          </div>
          <div className="geometry-checks">
            {checks.map((check) => (
              <div className={check.ready ? 'ready' : ''} key={check.label}>
                {check.ready ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                <span>{check.label}</span>
              </div>
            ))}
            {previewSource === 'fallback' && (
              <div>
                <CircleDashed size={14} />
                <span>Surface diagnostics asset is not available in the current CLI snapshot</span>
              </div>
            )}
          </div>
          <div className="surface-review-section">
            <div className="surface-review-heading">
              <span>
                {review.mode === 'quality'
                  ? 'QUALITY FIELDS'
                  : review.mode === 'boundaries' ? 'BOUNDARY ASSIGNMENTS' : 'DISPLAY SUMMARY'}
              </span>
              {review.mode === 'quality'
                ? <strong>{review.qualityFields.length} available</strong>
                : review.mode === 'boundaries'
                  ? <strong>{review.assignedBoundaryCount}/{review.boundaryInventory.length} assigned</strong>
                  : <strong>{manifest?.elements?.toLocaleString() ?? '—'} elements</strong>}
            </div>
            {review.mode === 'quality' ? (
              <SurfaceQualityInspector
                field={review.selectedFieldInfo}
                range={review.range}
                histogram={review.histogram}
                extrema={review.extrema}
                probe={review.probe}
                entityNames={Object.fromEntries(review.boundaryInventory.map((row) => [row.id, row.name]))}
                onRangeChange={review.setRange}
                onLocateExtreme={review.locateExtreme}
              />
            ) : review.mode === 'boundaries' ? (
              <SurfaceBoundaryInspector
                inventory={review.boundaryInventory}
                selectedId={review.selection.groupId}
                selectedBoundary={review.selectedBoundary}
                conflictCount={review.boundaryConflictCount}
                onSelect={(groupId) => review.setSelection({ groupId })}
                onIsolate={review.isolateBoundary}
                onShowAll={review.showAllBoundaries}
              />
            ) : (
              <p>
                Plain mode shows the unclassified surface discretization without boundary colors or diagnostic fields.
                Use it to inspect silhouette, feature capture, and local element density.
              </p>
            )}
          </div>
          <SurfaceParameterSummary parameters={review.surfaceParameters} />
          <button className="geometry-plan-action" onClick={onPlanVolumeMesh}>
            <GitPullRequestDraft size={15} />
            Plan Volume Mesh
          </button>
          {primaryError && previewSource === 'fallback' && (
            <small className="cfd-source-detail" title={primaryError}>Spatial context fallback is active</small>
          )}
        </aside>
      </div>
      <div className="cfd-stage-guidance">
        <strong>CFD review order</strong>
        <span>1. Feature capture</span>
        <span>2. Boundary grouping</span>
        <span>3. Area / aspect ratio / skewness</span>
        <span>4. Local refinement and boundary-layer intent</span>
      </div>
    </section>
  )
}
