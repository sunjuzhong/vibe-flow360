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
import type { ProjectItem, ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'
import { LazyViewer3D } from './viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import { useSurfaceMeshReview } from '../hooks/useSurfaceMeshReview'
import { useSurfaceMeshAdvancedReview } from '../hooks/useSurfaceMeshAdvancedReview'
import { SurfaceBoundaryInspector } from './surface-mesh/SurfaceBoundaryInspector'
import { SurfaceParameterSummary } from './surface-mesh/SurfaceParameterSummary'
import { SurfaceQualityInspector } from './surface-mesh/SurfaceQualityInspector'
import { SurfaceViewModeToolbar } from './surface-mesh/SurfaceViewModeToolbar'
import { ResourceReviewLayout } from './ResourceReviewLayout'
import {
  SurfaceAdvancedReview,
  SurfaceAdvancedToolbar,
} from './surface-mesh/SurfaceAdvancedReview'
import {
  buildSurfaceRemediationRecommendation,
  type SurfaceRemediationRecommendation,
} from '../lib/surfaceMeshAdvanced'

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
  versions,
  onCreateRemediationPlan,
  onPlanVolumeMesh,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  geometryResourceId?: string | null
  versions: ProjectItem[]
  onCreateRemediationPlan: (recommendation: SurfaceRemediationRecommendation) => Promise<void>
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
  const advanced = useSurfaceMeshAdvancedReview({
    versions,
    currentId: resourceId ?? detail?.id ?? '',
    currentDetail: detail,
    selectedField: review.selectedField,
  })
  const source = detail?.summary ?? detail?.state ?? detail?.simulation_params
  const status = resourceStatus(detail)
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
  const successful = ['completed', 'processed', 'success'].includes(status.toLowerCase())
  const failed = ['failed', 'error'].includes(status.toLowerCase())
  const unassignedBoundaryCount = review.boundaryInventory.filter((row) => row.status === 'unassigned').length
  const reviewLevel = failed || review.boundaryConflictCount > 0
    ? 'blocked'
    : successful && checks.every((check) => check.ready) && previewSource !== 'fallback'
      ? 'ready'
      : 'warning'
  const reviewLabel = reviewLevel === 'ready'
    ? 'Ready for volume meshing review'
    : reviewLevel === 'blocked' ? 'Resolve mesh review blockers' : 'Engineering review required'
  const reviewDetail = reviewLevel === 'ready'
    ? 'The SurfaceMesh asset, parameters, and resource reads are available for downstream review.'
    : reviewLevel === 'blocked'
      ? 'Failed processing or conflicting boundary assignments must be resolved before trusting this mesh.'
      : 'Review processing state, missing evidence, and unassigned boundaries before proceeding.'

  return (
    <ResourceReviewLayout
      className={`surface-mesh-workspace surface-review-workspace surface-mode-${review.mode}`}
      inventoryLabel="SurfaceMesh boundary inventory"
      inspectorLabel="SurfaceMesh engineering review"
      inventory={(
        <>
          <div className="geometry-panel-heading">
            <div><span>BOUNDARIES</span><strong>Surface inventory</strong></div>
            <span className="geometry-count-badge">{review.boundaryInventory.length}</span>
          </div>
          <SurfaceBoundaryInspector
            inventory={review.boundaryInventory}
            selectedId={review.selection.groupId}
            selectedBoundary={review.selectedBoundary}
            conflictCount={review.boundaryConflictCount}
            visibility={review.visibility}
            onSelect={(groupId) => review.setSelection({ groupId })}
            onIsolate={review.isolateBoundary}
            onToggleVisibility={review.toggleBoundaryVisibility}
            onShowAll={review.showAllBoundaries}
          />
        </>
      )}
      viewer={(
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
          clipPlane={advanced.clipPlane}
          measurementPoints={advanced.measurementPoints}
          onPickPoint={advanced.measurementEnabled ? advanced.pickPoint : undefined}
          captureRequest={advanced.captureRequest}
          onCapture={(dataUrl) => downloadDataUrl(
            dataUrl,
            `${detail?.id ?? 'surface-mesh'}-review.png`,
          )}
          showFieldPanel={review.mode === 'quality'}
          showEntityLegend={false}
          toolbar={(
            <div className="surface-combined-toolbar">
              <SurfaceViewModeToolbar mode={review.mode} onChange={review.setMode} />
              <SurfaceAdvancedToolbar
                clipping={advanced.clipEnabled}
                measuring={advanced.measurementEnabled}
                onToggleClipping={() => advanced.setClipEnabled(!advanced.clipEnabled)}
                onToggleMeasuring={() => advanced.setMeasurementEnabled(!advanced.measurementEnabled)}
                onCapture={advanced.requestCapture}
              />
            </div>
          )}
        />
      )}
      inspector={(
        <>
          <div className={`geometry-readiness-card ${reviewLevel}`}>
            <div className="geometry-panel-heading">
              <div><span>SURFACE MESH REVIEW</span><strong>{reviewLabel}</strong></div>
              {reviewLevel === 'ready' ? <CheckCircle2 size={20} /> : <Activity size={20} />}
            </div>
            <p>{reviewDetail}</p>
            <div className="geometry-readiness-counts">
              {review.boundaryConflictCount > 0 && (
                <span className="blocked">{review.boundaryConflictCount} conflicts</span>
              )}
              <span className="warning">{unassignedBoundaryCount} unassigned</span>
              <span className="warning">Status · {status}</span>
            </div>
          </div>

          <div className="geometry-summary-grid surface-summary-grid">
            {metrics.map(({ label, value, icon: Icon }) => (
              <div key={label}>
                <span><Icon size={12} /> {label}</span>
                <strong>{metricText(value)}</strong>
              </div>
            ))}
          </div>

          <div className="geometry-checks">
            {checks.map((check) => (
              <div className={check.ready ? 'ready' : 'warning'} key={check.label}>
                {check.ready ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                <span><strong>{check.label}</strong></span>
              </div>
            ))}
            {previewSource === 'fallback' && (
              <div className="warning">
                <CircleDashed size={14} />
                <span><strong>Geometry context fallback</strong><small>The SurfaceMesh render asset is unavailable.</small></span>
              </div>
            )}
          </div>

          <section className="geometry-selection-card surface-active-review">
            <div className="geometry-section-title">
              <ScanLine size={13} />
                {review.mode === 'quality'
                  ? `Mesh quality · ${review.qualityFields.length} fields`
                  : review.mode === 'boundaries'
                    ? 'Selection properties'
                    : 'Plain mesh display'}
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
              review.selectedBoundary ? (
                <dl>
                  <div><dt>Name</dt><dd>{review.selectedBoundary.name}</dd></div>
                  <div><dt>ID</dt><dd title={review.selectedBoundary.id}>{review.selectedBoundary.id}</dd></div>
                  <div><dt>Triangles</dt><dd>{review.selectedBoundary.triangles?.toLocaleString() ?? 'Not reported'}</dd></div>
                  <div><dt>Assignment</dt><dd>
                    {review.selectedBoundary.assignments.map((assignment) => assignment.modelName).join(', ') || 'Unassigned'}
                  </dd></div>
                </dl>
              ) : <p>Select a boundary in the inventory or 3D viewer to inspect it.</p>
            ) : (
              <p>
                Plain mode shows the unclassified surface discretization without boundary colors or diagnostic fields.
                Use it to inspect silhouette, feature capture, and local element density.
              </p>
            )}
          </section>

          <SurfaceParameterSummary parameters={review.surfaceParameters} />
          <SurfaceAdvancedReview
            versions={advanced.comparisonVersions}
            compareId={advanced.compareId}
            comparisonName={advanced.comparison?.resource.name}
            loading={advanced.comparisonLoading}
            error={advanced.comparisonError}
            parameterDifferences={advanced.comparison?.parameterDifferences ?? []}
            baselineHistogram={review.histogram}
            comparisonHistogram={advanced.comparison?.histogram ?? null}
            qualityError={advanced.comparison?.qualityError}
            clipEnabled={advanced.clipEnabled}
            clipAxis={advanced.clipAxis}
            clipPosition={advanced.clipPosition}
            measurementEnabled={advanced.measurementEnabled}
            measurementPointCount={advanced.measurementPoints.length}
            measurementDistance={advanced.distance}
            field={review.selectedFieldInfo}
            probe={review.probe}
            remediationBusy={advanced.remediationBusy}
            remediationError={advanced.remediationError}
            onCompareId={advanced.setCompareId}
            onClipEnabled={advanced.setClipEnabled}
            onClipAxis={advanced.setClipAxis}
            onClipPosition={advanced.setClipPosition}
            onMeasurementEnabled={advanced.setMeasurementEnabled}
            onClearMeasurement={advanced.clearMeasurement}
            onCreateRemediation={() => {
              if (!review.selectedFieldInfo || !review.probe) return
              const recommendation = buildSurfaceRemediationRecommendation({
                field: review.selectedFieldInfo,
                probe: review.probe,
                simulationParams: detail?.simulation_params,
              })
              void advanced.runRemediation(() => onCreateRemediationPlan(recommendation))
            }}
          />
          <button className="geometry-plan-action" onClick={onPlanVolumeMesh}>
            <GitPullRequestDraft size={15} />
            Plan Volume Mesh
          </button>
          {primaryError && previewSource === 'fallback' && (
            <small className="cfd-source-detail" title={primaryError}>Spatial context fallback is active</small>
          )}
        </>
      )}
    />
  )
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = fileName.replace(/[^a-z0-9._-]+/gi, '-')
  anchor.click()
}
