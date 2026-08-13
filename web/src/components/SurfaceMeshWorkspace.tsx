import {
  Activity,
  ChevronDown,
  CheckCircle2,
  CircleDashed,
  Eye,
  EyeOff,
  Grid3X3,
  LocateFixed,
  Palette,
  Ruler,
  ScanLine,
  Settings2,
  Triangle,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProjectItem, ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'
import { LazyViewer3D, type ViewerAssetStats, type ViewerCameraCommand } from './viewer/LazyViewer3D'
import { ViewerAssetInformation } from './viewer/ViewerAssetInformation'
import { ViewerFieldDiagnostics } from './viewer/ViewerFieldDiagnostics'
import { useResourcePreview } from '../hooks/useResourcePreview'
import { nextSurfaceSelection, useSurfaceMeshReview } from '../hooks/useSurfaceMeshReview'
import { useSurfaceMeshAdvancedReview } from '../hooks/useSurfaceMeshAdvancedReview'
import { useSurfaceQualityFilter } from '../hooks/useSurfaceQualityFilter'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'
import { SurfaceBoundaryInspector } from './surface-mesh/SurfaceBoundaryInspector'
import './surface-mesh/SurfaceBoundarySelection.css'
import { SurfaceParameterSummary } from './surface-mesh/SurfaceParameterSummary'
import { SurfaceQualityFilterPanel } from './surface-mesh/SurfaceQualityFilterPanel'
import { ResourceReviewLayout } from './ResourceReviewLayout'
import { ParameterEntityInventory, useDraftEntities, useGhostEntities, useParameterEntityUnit, useParameterEntityVisibility } from './DraftEntityInventory'
import type { DraftEntityMutation } from '../lib/draftEntities'
import ResourceCreateDraftAction from './ResourceCreateDraftAction'
import {
  ResourceReviewDialog,
  ResourceReviewLauncher,
  ResourceReviewLaunchers,
  ResourceReviewToggle,
} from './ResourceReviewDialog'
import { useI18n } from '../i18n'
import {
  SurfaceAdvancedReview,
  SurfaceAdvancedToolbar,
} from './surface-mesh/SurfaceAdvancedReview'
import {
  buildSurfaceRemediationRecommendation,
  type SurfaceRemediationRecommendation,
} from '../lib/surfaceMeshAdvanced'
import { surfaceQualityRiskDirection } from '../lib/surfaceMeshReview'
import { applySurfaceOpacity, buildSurfaceAppearances } from '../lib/surfaceAppearance'

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
  onMutateDraftEntity,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  projectId: string
  resourceRef: ResourceRef
  annotationsModel: ProjectAnnotationsModel<JsonValue>
  geometryResourceId?: string | null
  versions: ProjectItem[]
  onCreateRemediationPlan: (recommendation: SurfaceRemediationRecommendation) => Promise<void>
  onPlanVolumeMesh: () => Promise<void>
  onMutateDraftEntity?: (mutation: DraftEntityMutation) => Promise<void>
}) {
  const { t } = useI18n()
  const [parameterEntityVisibility, setParameterEntityVisibility] = useParameterEntityVisibility(detail?.simulation_params)
  const parameterEntityUnit = useParameterEntityUnit(detail?.simulation_params)
  const draftEntities = useDraftEntities(detail?.simulation_params)
  const ghostEntities = useGhostEntities(detail?.simulation_params)
  const parameterEntities = useMemo(() => [...draftEntities, ...ghostEntities], [draftEntities, ghostEntities])
  const [activeReviewDialog, setActiveReviewDialog] = useState<'preflight' | 'parameters' | 'advanced' | null>(null)
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand | null>(null)
  const [viewerAssetStats, setViewerAssetStats] = useState<ViewerAssetStats | null>(null)
  const [surfaceOpacityOverrides, setSurfaceOpacityOverrides] = useState<Record<string, number>>({})
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
  const selectedBoundaryVisible = review.selectedBoundaryIds.length > 0
    && review.selectedBoundaryIds.every((id) => review.visibility[id] !== false)
  const selectedBoundaryAssignments = [...new Set(review.selectedBoundaries.flatMap((boundary) =>
    boundary.assignments.map((assignment) => `${assignment.modelName} · ${assignment.modelType}`),
  ))]
  const selectedBoundaryStatuses = [...new Set(review.selectedBoundaries.map((boundary) => boundary.status))]
  const selectedBoundaryTriangles = review.selectedBoundaries.every((boundary) => boundary.triangles !== undefined)
    ? review.selectedBoundaries.reduce((total, boundary) => total + (boundary.triangles ?? 0), 0)
    : undefined
  const boundaryIds = review.boundaryInventory.map((boundary) => boundary.id)
  const surfaceOpacityTargetIds = review.selectedBoundaryIds.length > 0
    ? review.selectedBoundaryIds
    : boundaryIds
  const surfaceOpacityValues = surfaceOpacityTargetIds.map((id) => surfaceOpacityOverrides[id] ?? 1)
  const surfaceOpacity = surfaceOpacityValues.length > 0
    ? surfaceOpacityValues.reduce((total, value) => total + value, 0) / surfaceOpacityValues.length
    : 1
  const surfaceOpacityMixed = surfaceOpacityValues.some((value) => Math.abs(value - surfaceOpacity) > 0.001)
  const surfaceAppearances = useMemo(() => buildSurfaceAppearances(
    boundaryIds,
    Object.fromEntries((manifest?.groups ?? []).map((group) => [group.id, group.color])),
    surfaceOpacityOverrides,
  ), [boundaryIds.join('\u0000'), manifest?.groups, surfaceOpacityOverrides])

  useEffect(() => {
    setSurfaceOpacityOverrides({})
  }, [detail?.id, resourceId])

  const updateSurfaceOpacity = (opacity: number) => {
    setSurfaceOpacityOverrides((current) => applySurfaceOpacity(
      current,
      surfaceOpacityTargetIds,
      opacity,
    ))
  }
  const requestSelectionFocus = () => {
    setCameraCommand((current) => ({ type: 'fit-selection', nonce: (current?.nonce ?? 0) + 1 }))
  }

  return (
    <ResourceReviewLayout
      className={`surface-mesh-workspace surface-review-workspace surface-mode-${review.mode}`}
      inventoryLabel={t('SurfaceMesh boundary inventory')}
      inspectorLabel={t('SurfaceMesh engineering review')}
      inventory={(
        <>
          <div className="geometry-panel-heading">
            <div><span>{t('MESH')}</span><strong>{t('Visualization objects')}</strong></div>
            <span className="geometry-count-badge">{review.boundaryInventory.length + parameterEntities.length}</span>
          </div>
          <div className="geometry-entity-tree surface-entity-tree">
            <SurfaceBoundaryInspector
              inventory={review.boundaryInventory}
              selectedIds={review.selectedBoundaryIds}
              conflictCount={review.boundaryConflictCount}
              visibility={review.visibility}
              onSelect={(groupId, additive) => review.setSelection(
                nextSurfaceSelection(review.selection, groupId, additive),
              )}
              onToggleVisibility={review.toggleBoundaryVisibility}
              onShowAll={review.showAllBoundaries}
              onHideAll={review.hideAllBoundaries}
            />
            <ParameterEntityInventory
              entities={draftEntities}
              visibility={parameterEntityVisibility}
              onVisibilityChange={setParameterEntityVisibility}
              source="draft"
              unit={parameterEntityUnit}
              onMutate={onMutateDraftEntity}
            />
            <ParameterEntityInventory
              entities={ghostEntities}
              visibility={parameterEntityVisibility}
              onVisibilityChange={setParameterEntityVisibility}
              source="ghost"
            />
          </div>
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
          entityAppearances={surfaceAppearances}
          parameterEntities={parameterEntities}
          parameterEntityVisibility={parameterEntityVisibility}
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
          onAssetStatsChange={setViewerAssetStats}
          focusTarget={review.focusTarget}
          cameraCommand={cameraCommand}
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
          fieldPanelExtra={review.mode === 'quality' ? ((fieldPanel) => (
            <ViewerFieldDiagnostics
              field={fieldPanel.field}
              range={fieldPanel.range}
              histogram={review.histogram}
              extrema={review.extrema}
              probe={review.probe}
              entityNames={Object.fromEntries(review.boundaryInventory.map((row) => [row.id, row.name]))}
              riskDirection={surfaceQualityRiskDirection(review.selectedFieldInfo?.name ?? '')}
              onLocateExtreme={review.locateExtreme}
            />
          )) : undefined}
          showEntityLegend={false}
          topToolbar={(
                <div className="surface-combined-toolbar">
                  <SurfaceAdvancedToolbar
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

          <details className="case-review-details case-review-evidence">
            <summary>
              <span>{t('Review evidence')}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className="case-review-evidence-content">
              <ViewerAssetInformation stats={viewerAssetStats} />
              {reportedMetrics.length > 0 && (
                <div className="geometry-summary-grid surface-summary-grid">
                  {reportedMetrics.map(({ label, value, icon: Icon }) => (
                    <div key={label}>
                      <span><Icon size={12} /> {t(label)}</span>
                      <strong>{metricText(value)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          <section className="geometry-selection-card surface-appearance-card">
            <div className="geometry-section-title"><Palette size={13} /> {t('Surface appearance')}</div>
            <div className="surface-opacity-heading">
              <span>
                {review.selectedBoundaryIds.length > 0
                  ? t('Selected boundaries · {count}').replace('{count}', String(review.selectedBoundaryIds.length))
                  : t('All Surface boundaries')}
              </span>
              <strong>
                {Math.round(surfaceOpacity * 100)}%{surfaceOpacityMixed ? ` · ${t('Mixed')}` : ''}
              </strong>
            </div>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={surfaceOpacity}
              disabled={surfaceOpacityTargetIds.length === 0}
              aria-label={t('Surface opacity')}
              onInput={(event) => updateSurfaceOpacity(Number(event.currentTarget.value))}
            />
            <p>{t('Adjust transparency to inspect internal mesh details.')}</p>
          </section>

          {review.selectedBoundaries.length > 0 && (
            <section className="geometry-selection-card surface-boundary-selection-card">
              <div className="geometry-section-title"><ScanLine size={13} /> {t('Selection properties')}</div>
              <dl>
                {review.selectedBoundaries.length > 1 ? (
                  <div><dt>{t('Selection')}</dt><dd>{t('{count} items selected').replace('{count}', String(review.selectedBoundaries.length))}</dd></div>
                ) : (
                  <>
                    <div><dt>{t('Name')}</dt><dd>{review.selectedBoundary?.name}</dd></div>
                    <div><dt>ID</dt><dd title={review.selectedBoundary?.id}>{review.selectedBoundary?.id}</dd></div>
                  </>
                )}
                <div><dt>{t('Rendered elements')}</dt><dd>{selectedBoundaryTriangles?.toLocaleString() ?? t('Not reported')}</dd></div>
                <div><dt>{t('Status')}</dt><dd>{selectedBoundaryStatuses.map(t).join(', ')}</dd></div>
                <div><dt>{t('Assignment')}</dt><dd>{selectedBoundaryAssignments.join(', ') || t('Unassigned')}</dd></div>
              </dl>
              <div className="surface-selection-actions" aria-label={t('Selection actions')}>
                <button type="button" onClick={requestSelectionFocus}>
                  <LocateFixed size={12} /> {t('Focus')}
                </button>
                <button type="button" onClick={() => review.isolateBoundaries(review.selectedBoundaryIds)}>
                  <ScanLine size={12} /> {t('Isolate')}
                </button>
                <button type="button" onClick={() => review.setVisibility({
                  ...review.visibility,
                  ...Object.fromEntries(review.selectedBoundaryIds.map((id) => [id, !selectedBoundaryVisible])),
                })}>
                  {selectedBoundaryVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                  {t(selectedBoundaryVisible ? 'Hide' : 'Show')}
                </button>
                <button type="button" onClick={review.showAllBoundaries}>
                  <Eye size={12} /> {t('Show all')}
                </button>
                <button type="button" onClick={() => review.setSelection({ groupId: null })}>
                  <X size={12} /> {t('Clear')}
                </button>
              </div>
            </section>
          )}

          {review.mode === 'quality' && (
            <section className="geometry-selection-card surface-active-review">
              <div className="geometry-section-title">
                <ScanLine size={13} /> {t('Mesh quality · {count} fields').replace('{count}', String(review.qualityFields.length))}
              </div>
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
            </section>
          )}

          {review.qualityFields.length > 0 && (
            <ResourceReviewToggle
              label={t('Mesh quality')}
              summary={t('{count} fields available').replace('{count}', String(review.qualityFields.length))}
              checked={review.mode === 'quality'}
              onChange={(checked) => review.setMode(checked ? 'quality' : 'boundaries')}
            />
          )}
          <ResourceReviewLaunchers>
            <ResourceReviewLauncher
              icon={<Activity size={14} />}
              label={t('Preflight evidence')}
              summary={t('{count} conflicts · {unassigned} unassigned')
                .replace('{count}', String(review.boundaryConflictCount))
                .replace('{unassigned}', String(unassignedBoundaryCount))}
              onClick={() => setActiveReviewDialog('preflight')}
            />
            {review.surfaceParameters.length > 0 && (
              <ResourceReviewLauncher
                icon={<Settings2 size={14} />}
                label={t('Parameters and evidence')}
                summary={t('{count} surface parameters').replace('{count}', String(review.surfaceParameters.length))}
                onClick={() => setActiveReviewDialog('parameters')}
              />
            )}
            <ResourceReviewLauncher
              icon={<Settings2 size={14} />}
              label={t('Advanced review')}
              summary={t('Compare · Export · AI patch')}
              onClick={() => setActiveReviewDialog('advanced')}
            />
          </ResourceReviewLaunchers>
          <div className="case-review-actions">
            <ResourceCreateDraftAction onCreate={onPlanVolumeMesh} />
          </div>
          {primaryError && previewSource === 'fallback' && (
            <small className="cfd-source-detail" title={primaryError}>Spatial context fallback is active</small>
          )}
          {activeReviewDialog === 'preflight' && (
            <ResourceReviewDialog
              title={t('Preflight evidence')}
              subtitle={reviewLabel}
              icon={<Activity size={18} />}
              onClose={() => setActiveReviewDialog(null)}
            >
              <div className="geometry-checks surface-review-notices">
                {review.boundaryConflictCount > 0 && (
                  <div className="blocked"><Activity size={14} /><span><strong>{review.boundaryConflictCount} conflicting boundary assignments</strong></span></div>
                )}
                {unassignedBoundaryCount > 0 && (
                  <div className="warning"><CircleDashed size={14} /><span><strong>{unassignedBoundaryCount} unassigned boundaries</strong></span></div>
                )}
                {reviewNotices.length > 0 ? reviewNotices.map((notice) => (
                  <div className="warning" key={notice}><CircleDashed size={14} /><span><strong>{notice}</strong></span></div>
                )) : review.boundaryConflictCount === 0 && unassignedBoundaryCount === 0
                  ? <div className="ready"><CheckCircle2 size={14} /><span><strong>{reviewDetail}</strong></span></div>
                  : null}
              </div>
            </ResourceReviewDialog>
          )}
          {activeReviewDialog === 'parameters' && (
            <ResourceReviewDialog
              title={t('Parameters and evidence')}
              subtitle={t('{count} surface parameters').replace('{count}', String(review.surfaceParameters.length))}
              icon={<Settings2 size={18} />}
              onClose={() => setActiveReviewDialog(null)}
            >
              <SurfaceParameterSummary parameters={review.surfaceParameters} defaultOpen />
            </ResourceReviewDialog>
          )}
          {activeReviewDialog === 'advanced' && (
            <ResourceReviewDialog
              title={t('Advanced review')}
              subtitle={t('Compare · Export · AI patch')}
              icon={<Settings2 size={18} />}
              onClose={() => setActiveReviewDialog(null)}
            >
              <SurfaceAdvancedReview
                defaultOpen
                versions={advanced.comparisonVersions}
                compareId={advanced.compareId}
                comparisonName={advanced.comparison?.resource.name}
                loading={advanced.comparisonLoading}
                error={advanced.comparisonError}
                parameterDifferences={advanced.comparison?.parameterDifferences ?? []}
                baselineHistogram={review.histogram}
                comparisonHistogram={advanced.comparison?.histogram ?? null}
                qualityError={advanced.comparison?.qualityError}
                field={review.selectedFieldInfo}
                probe={review.probe}
                remediationBusy={advanced.remediationBusy}
                remediationError={advanced.remediationError}
                onCompareId={advanced.setCompareId}
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
            </ResourceReviewDialog>
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
