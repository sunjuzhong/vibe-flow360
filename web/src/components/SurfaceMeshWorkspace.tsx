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
import { useSurfaceQualityFilter } from '../hooks/useSurfaceQualityFilter'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'
import { SurfaceBoundaryInspector } from './surface-mesh/SurfaceBoundaryInspector'
import { SurfaceParameterSummary } from './surface-mesh/SurfaceParameterSummary'
import { SurfaceQualityInspector } from './surface-mesh/SurfaceQualityInspector'
import { SurfaceQualityFilterPanel } from './surface-mesh/SurfaceQualityFilterPanel'
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
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in value) {
    const metric = value as { value?: unknown; units?: unknown }
    return `${metric.value ?? '—'}${metric.units ? ` ${metric.units}` : ''}`
  }
  return JSON.stringify(value)
}

function isReportedMetric(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (typeof value !== 'object') return true
  if (Array.isArray(value)) return value.length > 0
  if ('value' in value) {
    const metric = value as { value?: unknown }
    return metric.value !== undefined && metric.value !== null && metric.value !== ''
  }
  return Object.keys(value).length > 0
}

export default function SurfaceMeshWorkspace({
  detail,
  resourceId,
  projectId,
  resourceRef,
  annotationsModel,
  geometryResourceId,
  versions,
  onCreateRemediationPlan,
  onPlanVolumeMesh,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  projectId: string
  resourceRef: ResourceRef
  annotationsModel: ProjectAnnotationsModel<JsonValue>
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
  const qualityFilter = useSurfaceQualityFilter(
    resourceId ?? detail?.id ?? '',
    review.qualityFields,
  )
  const advanced = useSurfaceMeshAdvancedReview({
    versions,
    currentId: resourceId ?? detail?.id ?? '',
    currentDetail: detail,
    selectedField: review.selectedField,
  })
  const tools = useWorkspaceViewerTools({ projectId, resourceRef, annotationsModel })
  const metricSources = [detail?.summary, detail?.state, detail?.simulation_params]
  const status = resourceStatus(detail)
  const metrics = [
    {
      label: 'Surface elements',
      value: findMetric(metricSources, ['face_count', 'surface_element_count', 'element_count', 'num_faces']),
      icon: Grid3X3,
    },
    {
      label: 'Minimum edge',
      value: findMetric(metricSources, ['min_edge_length', 'minimum_edge_length', 'min_length']),
      icon: Ruler,
    },
    {
      label: 'Maximum aspect ratio',
      value: findMetric(metricSources, ['max_aspect_ratio', 'maximum_aspect_ratio', 'aspect_ratio']),
      icon: Triangle,
    },
    {
      label: 'Maximum skewness',
      value: findMetric(metricSources, ['max_skewness', 'maximum_skewness', 'skewness']),
      icon: ScanLine,
    },
  ]
  const reportedMetrics = metrics.filter((metric) => isReportedMetric(metric.value))
  const successful = ['completed', 'processed', 'success'].includes(status.toLowerCase())
  const failed = ['failed', 'error'].includes(status.toLowerCase())
  const hasSimulationParams = Boolean(detail?.simulation_params && Object.keys(detail.simulation_params).length)
  const partialReadCount = Object.keys(detail?.errors ?? {}).length
  const reviewNotices = [
    ...(!hasSimulationParams ? ['Surface meshing parameters are unavailable.'] : []),
    ...(partialReadCount > 0 ? [`${partialReadCount} partial Flow360 read${partialReadCount === 1 ? '' : 's'} require attention.`] : []),
    ...(previewSource === 'fallback' ? ['SurfaceMesh render data is unavailable; geometry context is shown as a fallback.'] : []),
  ]
  const unassignedBoundaryCount = review.boundaryInventory.filter((row) => row.status === 'unassigned').length
  const reviewLevel = failed || review.boundaryConflictCount > 0
    ? 'blocked'
    : successful && hasSimulationParams && partialReadCount === 0 && previewSource !== 'fallback'
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
            onHideAll={review.hideAllBoundaries}
          />
        </>
      )}
      viewer={(
        <>
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
          fieldFilter={review.mode === 'quality' ? qualityFilter.filter : null}
          onFieldFilterMatchCount={qualityFilter.setMatchCount}
          focusTarget={review.focusTarget}
          clipPlane={advanced.clipPlane}
          projectId={projectId}
          resourceRef={resourceRef}
          toolInput={tools.toolInput}
          overlays={tools.overlays}
          onDoubleClick={tools.onDoubleClick}
          captureRequest={advanced.captureRequest}
          onCapture={(dataUrl) => downloadDataUrl(
            dataUrl,
            `${detail?.id ?? 'surface-mesh'}-review.png`,
          )}
          showFieldPanel={review.mode === 'quality'}
          showEntityLegend={false}
          toolbar={<SurfaceViewModeToolbar mode={review.mode} onChange={review.setMode} />}
          topToolbar={(
                <div className="surface-combined-toolbar">
                  <SurfaceAdvancedToolbar
                    clipping={advanced.clipEnabled}
                    onToggleClipping={() => advanced.setClipEnabled(!advanced.clipEnabled)}
                    onCapture={advanced.requestCapture}
                  />
                  <ViewerToolsDock model={tools} />
                </div>
          )}
        />
        <ViewerToolPanel model={tools} />
        </>
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
              {unassignedBoundaryCount > 0 && <span className="warning">{unassignedBoundaryCount} unassigned</span>}
              <span className="warning">Status · {status}</span>
            </div>
          </div>

          {reportedMetrics.length > 0 && (
            <div className="geometry-summary-grid surface-summary-grid">
              {reportedMetrics.map(({ label, value, icon: Icon }) => (
                <div key={label}>
                  <span><Icon size={12} /> {label}</span>
                  <strong>{metricText(value)}</strong>
                </div>
              ))}
            </div>
          )}

          {reviewNotices.length > 0 && (
            <div className="geometry-checks surface-review-notices">
              {reviewNotices.map((notice) => (
                <div className="warning" key={notice}>
                  <CircleDashed size={14} />
                  <span><strong>{notice}</strong></span>
                </div>
              ))}
            </div>
          )}

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
              <>
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
                <SurfaceQualityFilterPanel
                  fields={review.qualityFields}
                  filter={qualityFilter.filter}
                  matchCount={qualityFilter.matchCount}
                  onAddRule={qualityFilter.addRule}
                  onRemoveRule={qualityFilter.removeRule}
                  onUpdateRule={qualityFilter.updateRule}
                  onEnabledChange={qualityFilter.setEnabled}
                  onOperatorChange={qualityFilter.setOperator}
                  onReset={qualityFilter.reset}
                />
              </>
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

          {review.surfaceParameters.length > 0 && (
            <SurfaceParameterSummary parameters={review.surfaceParameters} />
          )}
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
            field={review.selectedFieldInfo}
            probe={review.probe}
            remediationBusy={advanced.remediationBusy}
            remediationError={advanced.remediationError}
            onCompareId={advanced.setCompareId}
            onClipEnabled={advanced.setClipEnabled}
            onClipAxis={advanced.setClipAxis}
            onClipPosition={advanced.setClipPosition}
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
            Configure Volume Mesh Draft
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
