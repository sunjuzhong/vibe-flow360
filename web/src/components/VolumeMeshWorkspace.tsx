import {
  Activity,
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Eye,
  Layers,
  Ruler,
  ScanLine,
  Settings2,
  Share2,
  SlidersHorizontal,
  Triangle,
  Volume2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'
import { LazyViewer3D, type ViewerAssetStats, type ViewerCameraCommand } from './viewer/LazyViewer3D'
import { ViewerAssetInformation } from './viewer/ViewerAssetInformation'
import { useResourcePreview } from '../hooks/useResourcePreview'
import { useVolumeMeshReview } from '../hooks/useVolumeMeshReview'
import { useSurfaceQualityFilter } from '../hooks/useSurfaceQualityFilter'
import { useVolumeQualityThresholds } from '../hooks/useVolumeQualityThresholds'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import { ResourceReviewLayout } from './ResourceReviewLayout'
import ResourceCreateDraftAction from './ResourceCreateDraftAction'
import {
  ResourceReviewDialog,
  ResourceReviewLauncher,
  ResourceReviewLaunchers,
} from './ResourceReviewDialog'
import { useI18n } from '../i18n'
import { createViewerContext, findLengthUnit } from '../lib/viewer-tools/context/ViewerContext'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'
import { assessVolumeMeshQuality, computeVolumeReadiness, volumeQualityRiskFilter } from '../lib/volumeMeshReview'
import { SurfaceQualityFilterPanel } from './surface-mesh/SurfaceQualityFilterPanel'
import { VolumeCapabilityPanel } from './volume-mesh/VolumeCapabilityPanel'
import { VolumeParameterSummary } from './volume-mesh/VolumeParameterSummary'
import { VolumeQualityInspector } from './volume-mesh/VolumeQualityInspector'
import { VolumeSliceInspector } from './volume-mesh/VolumeSliceInspector'
import { VolumeViewModeToolbar } from './volume-mesh/VolumeViewModeToolbar'
import { VolumeZoneInspector } from './volume-mesh/VolumeZoneInspector'
import { VolumeZoneSelectionCard } from './volume-mesh/VolumeZoneSelectionCard'
import { BoundaryLayerInspector } from './volume-mesh/BoundaryLayerInspector'
import { VolumeQualityAssessmentPanel } from './volume-mesh/VolumeQualityAssessmentPanel'
import { VolumeRefinementInspector } from './volume-mesh/VolumeRefinementInspector'
import { volumeRefinementOverlays } from '../lib/volumeRefinementReview'

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

export function computeReadiness(detail: ResourceDetail | null) {
  return computeVolumeReadiness({ detail })
}

export default function VolumeMeshWorkspace({
  detail,
  resourceId,
  projectId,
  resourceRef,
  annotationsModel,
  geometryResourceId,
  onPlanCase,
  onShowLogs,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  projectId: string
  resourceRef: ResourceRef
  annotationsModel: ProjectAnnotationsModel<JsonValue>
  geometryResourceId?: string | null
  onPlanCase: () => Promise<void>
  onShowLogs?: () => void
}) {
  const { t } = useI18n()
  const [activeReviewDialog, setActiveReviewDialog] = useState<'preflight' | 'quality' | 'parameters' | null>(null)
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand | null>(null)
  const [viewerAssetStats, setViewerAssetStats] = useState<ViewerAssetStats | null>(null)
  const { manifest, state: viewerState, source: previewSource, primaryError } = useResourcePreview(
    detail ? 'VolumeMesh' : null,
    resourceId ?? detail?.id ?? null,
    detail && geometryResourceId ? 'Geometry' : null,
    geometryResourceId ?? null,
  )
  const previewKind = previewSource ?? 'none'
  const review = useVolumeMeshReview({
    groups: manifest?.groups ?? [],
    detail,
    previewSource: previewKind,
    boundingBox: manifest?.bounding_box,
  })
  const qualityFilter = useSurfaceQualityFilter(
    `volume:${resourceId ?? detail?.id ?? ''}`,
    review.qualityFields,
  )
  const qualityThresholds = useVolumeQualityThresholds(
    `volume:${resourceId ?? detail?.id ?? ''}`,
    review.qualityFields,
  )
  const qualityAssessment = useMemo(() => assessVolumeMeshQuality({
    fields: review.qualityFields,
    thresholds: qualityThresholds.thresholds,
    histogram: review.histogram,
  }), [qualityThresholds.thresholds, review.histogram, review.qualityFields])
  const status = resourceStatus(detail)
  const failed = ['failed', 'error'].includes(status.toLowerCase())
  const metricSources = [detail?.summary, detail?.state, detail?.simulation_params]
  const unit = findLengthUnit(metricSources)
  const viewerContext = useMemo(() => createViewerContext({
    projectId,
    resourceRef,
    assetSource: previewSource,
    fallbackAssetRef: geometryResourceId ? { id: geometryResourceId, type: 'Geometry' } : null,
    unit,
    capabilities: ['distance', 'surface-picking', 'field-probe'],
  }), [geometryResourceId, previewSource, projectId, resourceRef, unit])
  const tools = useWorkspaceViewerTools({
    projectId,
    resourceRef: viewerContext.resourceRef,
    assetRef: viewerContext.assetRef,
    coordinateFrame: viewerContext.coordinateFrame,
    annotationsModel,
    unit: viewerContext.unit,
  })
  const [selectedRefinementRegionId, setSelectedRefinementRegionId] = useState<string | null>(null)
  const refinementOverlays = useMemo(() => volumeRefinementOverlays(
    review.refinements,
    viewerContext.assetRef,
    selectedRefinementRegionId,
  ), [review.refinements, selectedRefinementRegionId, viewerContext.assetRef])
  const viewerOverlays = useMemo(() => review.mode === 'refinements' ? {
    ...tools.overlays,
    saved: [...(tools.overlays.saved ?? []), ...refinementOverlays],
  } : tools.overlays, [refinementOverlays, review.mode, tools.overlays])
  const metrics = [
    { label: 'Cell count', value: findMetric(metricSources, ['cell_count', 'num_cells', 'cells', 'element_count', 'volume_cell_count']), icon: Layers },
    { label: 'Node count', value: findMetric(metricSources, ['node_count', 'num_nodes', 'nodes', 'vertex_count']), icon: Share2 },
    { label: 'Minimum orthogonality', value: findMetric(metricSources, ['minimum_orthogonality', 'min_orthogonality', 'orthogonality']), icon: Triangle },
    { label: 'Maximum skewness', value: findMetric(metricSources, ['max_skewness', 'maximum_skewness', 'skewness']), icon: ScanLine },
    { label: 'Minimum cell size', value: findMetric(metricSources, ['min_cell_size', 'minimum_cell_size', 'cell_size']), icon: Ruler },
    { label: 'Computing domain', value: findMetric(metricSources, ['domain_extent', 'domain', 'bounding_box']), icon: Volume2 },
  ]
  const reportedMetrics = metrics.filter((metric) => isReportedMetric(metric.value))
  const checks = computeVolumeReadiness({
    detail,
    previewSource: previewKind,
    groups: manifest?.groups ?? [],
    fields: review.allFields,
  })
  const readyCount = checks.filter((check) => check.status === 'ready').length
  const warningCount = checks.filter((check) => check.status === 'warning' || check.status === 'missing').length
  const blockedCount = checks.filter((check) => check.status === 'blocked').length
  const reviewLevel = blockedCount > 0 ? 'blocked' : warningCount > 0 ? 'warning' : 'ready'
  const reviewLabel = reviewLevel === 'ready'
    ? 'Ready for a Case Draft'
    : reviewLevel === 'blocked' ? 'Resolve volume mesh blockers' : 'Engineering review required'
  const selectedZone = review.selectedZone
  const selectedZoneVisible = selectedZone ? review.visibility[selectedZone.id] !== false : false
  const entityNames = Object.fromEntries(review.zones.map((zone) => [zone.id, zone.name]))

  return (
    <ResourceReviewLayout
      className={`volume-mesh-workspace volume-review-workspace volume-mode-${review.mode}`}
      inventoryLabel="VolumeMesh region inventory"
      inspectorLabel="VolumeMesh engineering review"
      inventory={(
        <>
          <div className="geometry-panel-heading">
            <div>
              <span>{previewSource === 'fallback' ? 'CONTEXT' : 'REGIONS'}</span>
              <strong>{previewSource === 'fallback' ? 'Geometry inventory' : 'Domain inventory'}</strong>
            </div>
            <span className="geometry-count-badge">{review.zones.length}</span>
          </div>
          <VolumeZoneInspector
            inventory={review.zones}
            selectedId={review.selection.groupId}
            visibility={review.visibility}
            onSelect={(groupId) => review.setSelection({ groupId })}
            onIsolate={review.isolateZone}
            onToggleVisibility={review.toggleZoneVisibility}
            onShowAll={review.showAllZones}
            onHideAll={review.hideAllZones}
            contextOnly={previewSource === 'fallback'}
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
            selectedField={review.mode === 'quality' || review.mode === 'boundary-layer' ? review.selectedField : null}
            onSelectedFieldChange={review.setSelectedField}
            onFieldsDiscovered={review.handleFieldsDiscovered}
            fieldNames={review.mode === 'boundary-layer' ? review.boundaryLayerFieldNames : review.qualityFieldNames}
            fieldRange={review.mode === 'quality' || review.mode === 'boundary-layer' ? review.range : null}
            onFieldHistogramChange={review.setHistogram}
            onFieldExtremaChange={review.setExtrema}
            onFieldProbe={review.mode === 'quality' || review.mode === 'boundary-layer' ? review.setProbe : undefined}
            fieldFilter={review.mode === 'quality' ? qualityFilter.filter : null}
            onFieldFilterMatchCount={qualityFilter.setMatchCount}
            onAssetStatsChange={setViewerAssetStats}
            focusTarget={review.focusTarget}
            cameraCommand={cameraCommand}
            clipPlane={review.mode === 'slices' ? review.clipPlane : null}
            showFieldPanel={review.mode === 'quality' || review.mode === 'boundary-layer'}
            showEntityLegend={false}
            showWarnings={previewSource !== 'fallback'}
            projectId={projectId}
            resourceRef={viewerContext.assetRef}
            toolInput={tools.toolInput}
            overlays={viewerOverlays}
            onDoubleClick={tools.onDoubleClick}
            toolbar={<VolumeViewModeToolbar mode={review.mode} onChange={review.setMode} />}
            topToolbar={<ViewerToolsDock model={tools} />}
          />
          <ViewerToolPanel model={tools} />
        </>
      )}
      inspector={(
        <>
          <div className={`geometry-readiness-card ${reviewLevel}`}>
            <div className="geometry-panel-heading">
              <div><span>VOLUME MESH REVIEW</span><strong>{reviewLabel}</strong></div>
              {reviewLevel === 'ready' ? <CheckCircle2 size={20} /> : reviewLevel === 'blocked' ? <AlertCircle size={20} /> : <Activity size={20} />}
            </div>
            <p>{reviewLevel === 'ready'
              ? 'Lifecycle, zones, quality evidence, and parameters are available for downstream review.'
              : reviewLevel === 'blocked'
                ? 'The volume mesh failed. Review logs and meshing inputs before creating a Case Draft.'
                : 'Missing data remains visible as missing or proxy evidence; review it before relying on this mesh.'}</p>
            <div className="geometry-readiness-counts">
              {blockedCount > 0 && <span className="blocked">{`${blockedCount} ${blockedCount === 1 ? 'blocker' : 'blockers'}`}</span>}
              {warningCount > 0 && <span className="warning">{warningCount} warnings / missing</span>}
              <span className="warning">Status · {status}</span>
            </div>
          </div>

          <ViewerAssetInformation stats={viewerAssetStats} />

          {reportedMetrics.length > 0 && (
            <div className="geometry-summary-grid volume-summary-grid">
              {reportedMetrics.map(({ label, value, icon: Icon }) => (
                <div key={label}><span><Icon size={12} /> {label}</span><strong>{metricText(value)}</strong></div>
              ))}
            </div>
          )}

          <VolumeZoneSelectionCard
            zone={selectedZone}
            visible={selectedZoneVisible}
            contextOnly={previewSource === 'fallback'}
            onFocus={() => setCameraCommand({ type: 'fit-selection', nonce: Date.now() })}
            onIsolate={() => selectedZone && review.isolateZone(selectedZone.id)}
            onToggleVisibility={() => selectedZone && review.toggleZoneVisibility(selectedZone.id)}
            onShowAll={review.showAllZones}
            onClear={() => review.setSelection({ groupId: null })}
          />

          {review.mode === 'quality' ? (
            <section className="geometry-selection-card volume-active-review">
              <div className="geometry-section-title"><ScanLine size={13} /> Cell quality · {review.qualityFields.length} fields</div>
              <VolumeQualityInspector
                field={review.selectedFieldInfo}
                range={review.range}
                histogram={review.histogram}
                extrema={review.extrema}
                probe={review.probe}
                entityNames={entityNames}
                onRangeChange={(range) => review.setRange(range)}
                onLocateExtreme={review.locateExtreme}
              />
            </section>
          ) : review.mode === 'boundary-layer' ? (
            <BoundaryLayerInspector
              review={review.boundaryLayer}
              field={review.selectedFieldInfo}
              histogram={review.histogram}
              extrema={review.extrema}
              probe={review.probe}
              entityNames={entityNames}
              onSelectTarget={(groupId) => review.setSelection({ groupId })}
              onLocateExtreme={review.locateExtreme}
            />
          ) : review.mode === 'refinements' ? (
            <VolumeRefinementInspector
              review={review.refinements}
              selectedRegionId={selectedRefinementRegionId}
              onSelectRegion={setSelectedRefinementRegionId}
              onFocusRegion={(regionId) => {
                const region = review.refinements.regions.find((candidate) => candidate.id === regionId)
                if (!region) return
                setSelectedRefinementRegionId(regionId)
                review.focusPoint([...region.center])
              }}
              onSelectTarget={(groupId) => review.setSelection({ groupId })}
            />
          ) : review.mode === 'slices' ? (
            <VolumeSliceInspector
              enabled={review.clipEnabled}
              axis={review.clipAxis}
              position={review.clipPosition}
              bounds={review.clipBounds}
              available={previewSource === 'primary'}
              variants={review.sliceVariants}
              variant={review.sliceVariant}
              onEnabled={review.setClipEnabled}
              onAxis={review.setClipAxis}
              onPosition={review.setClipPosition}
              onVariant={review.setSliceVariant}
            />
          ) : review.mode === 'zones' ? (
            <div className="volume-mode-guidance"><Eye size={12} /> {t('Select a region to review its properties and available actions above.')}</div>
          ) : (
            <VolumeCapabilityPanel capabilities={review.capabilities} />
          )}

          {previewSource === 'fallback' && (
            <div className="volume-source-warning" role="status">
              <AlertCircle size={14} />
              <span><strong>Geometry context shown</strong>These are parent Geometry surfaces, not volume cells or diagnostic slices.</span>
            </div>
          )}

          <ResourceReviewLaunchers>
            <ResourceReviewLauncher
              icon={<Activity size={14} />}
              label={t('Preflight evidence')}
              summary={t('{ready}/{total} readiness checks passed')
                .replace('{ready}', String(readyCount))
                .replace('{total}', String(checks.length))}
              onClick={() => setActiveReviewDialog('preflight')}
            />
            {review.mode === 'quality' && (
              <ResourceReviewLauncher
                icon={<SlidersHorizontal size={14} />}
                label={t('Quality controls')}
                summary={t('{count} findings · {matches} matches')
                  .replace('{count}', String(qualityAssessment.findings.length))
                  .replace('{matches}', String(qualityFilter.matchCount ?? 0))}
                onClick={() => setActiveReviewDialog('quality')}
              />
            )}
            {review.parameters.length > 0 && (
              <ResourceReviewLauncher
                icon={<Settings2 size={14} />}
                label={t('Parameters and evidence')}
                summary={t('{count} volume mesh parameters').replace('{count}', String(review.parameters.length))}
                onClick={() => setActiveReviewDialog('parameters')}
              />
            )}
          </ResourceReviewLaunchers>

          <div className="geometry-plan-action-stack">
            <ResourceCreateDraftAction onCreate={onPlanCase} />
            {failed && onShowLogs && <button className="secondary-action" onClick={onShowLogs}><Activity size={14} /> View Logs</button>}
            <small className="readiness-summary">{readyCount}/{checks.length} readiness checks passed</small>
            {primaryError && previewSource === 'fallback' && <small className="cfd-source-detail" title={primaryError}>Spatial context fallback is active</small>}
          </div>
          {activeReviewDialog === 'preflight' && (
            <ResourceReviewDialog
              title={t('Preflight evidence')}
              subtitle={reviewLabel}
              icon={<Activity size={18} />}
              onClose={() => setActiveReviewDialog(null)}
            >
              <div className="geometry-checks volume-mesh-checks">
                {checks.map((check) => (
                  <div className={check.status === 'missing' ? 'unknown' : check.status} key={check.label}>
                    {check.status === 'ready' ? <CheckCircle2 size={14} /> : check.status === 'blocked' ? <AlertCircle size={14} /> : <CircleDashed size={14} />}
                    <div><span>{check.label}</span><small>{check.hint}</small></div>
                  </div>
                ))}
              </div>
            </ResourceReviewDialog>
          )}
          {activeReviewDialog === 'quality' && (
            <ResourceReviewDialog
              title={t('Quality controls')}
              subtitle={t('{count} cell quality fields').replace('{count}', String(review.qualityFields.length))}
              icon={<SlidersHorizontal size={18} />}
              onClose={() => setActiveReviewDialog(null)}
            >
              <VolumeQualityAssessmentPanel
                assessment={qualityAssessment}
                thresholds={qualityThresholds.thresholds}
                selectedFieldName={review.selectedField}
                onThresholdChange={qualityThresholds.updateThreshold}
                onResetThreshold={qualityThresholds.resetThreshold}
                onResetAll={qualityThresholds.resetAll}
                onReviewFinding={(finding) => {
                  const field = review.qualityFields.find((candidate) => candidate.name === finding.fieldName)
                  const threshold = qualityThresholds.thresholds.find((candidate) => candidate.fieldName === finding.fieldName)
                  if (!field || !threshold) return
                  review.setSelectedField(field.name)
                  qualityFilter.setFilter(volumeQualityRiskFilter(field, threshold))
                }}
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
                elementLabel="Cell"
              />
            </ResourceReviewDialog>
          )}
          {activeReviewDialog === 'parameters' && (
            <ResourceReviewDialog
              title={t('Parameters and evidence')}
              subtitle={t('{count} volume mesh parameters').replace('{count}', String(review.parameters.length))}
              icon={<Settings2 size={18} />}
              onClose={() => setActiveReviewDialog(null)}
            >
              <VolumeParameterSummary parameters={review.parameters} />
            </ResourceReviewDialog>
          )}
        </>
      )}
    />
  )
}
