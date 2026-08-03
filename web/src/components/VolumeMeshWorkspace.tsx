import {
  Activity,
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  GitPullRequestDraft,
  Layers,
  Ruler,
  ScanLine,
  Share2,
  Triangle,
  Volume2,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useState, useCallback, useMemo } from 'react'
import type { ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'
import { LazyViewer3D, type ViewerSelection } from './viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import { ResourceReviewLayout } from './ResourceReviewLayout'
import {
  createViewerContext,
  findLengthUnit,
} from '../lib/viewer-tools/context/ViewerContext'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'
import type { UVFFieldInfo } from '../lib/uvf-three'

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
  if (typeof value === 'object' && 'value' in (value as object)) {
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

type ReadinessCheck = {
  label: string
  status: 'ready' | 'warning' | 'blocked' | 'missing'
  hint: string
}

export function computeReadiness(detail: ResourceDetail | null): ReadinessCheck[] {
  const status = resourceStatus(detail).toLowerCase()
  const source = detail?.summary ?? detail?.state ?? detail?.simulation_params
  const cellCount = findMetric(source, ['cell_count', 'num_cells', 'cells', 'element_count', 'volume_cell_count'])
  const minOrtho = findMetric(source, ['minimum_orthogonality', 'min_orthogonality', 'orthogonality'])
  const maxSkew = findMetric(source, ['max_skewness', 'maximum_skewness', 'skewness'])
  const hasCells = cellCount !== undefined && cellCount !== null && cellCount !== ''
  const hasParams = Boolean(detail?.simulation_params && Object.keys(detail.simulation_params).length)
  const noErrors = !detail?.errors || Object.keys(detail.errors).length === 0

  return [
    {
      label: 'Volume mesh reached a terminal state',
      status: ['completed', 'processed', 'success'].includes(status)
        ? 'ready'
        : status === 'failed' || status === 'error'
        ? 'blocked'
        : 'warning',
      hint: `Current status: ${status || 'unknown'}`,
    },
    {
      label: 'Cell count is reported',
      status: hasCells ? 'ready' : 'missing',
      hint: hasCells ? `Cell count: ${metricText(cellCount)}` : 'Not reported by Flow360 snapshot',
    },
    {
      label: 'Mesh quality indicators are available',
      status: minOrtho !== undefined || maxSkew !== undefined ? 'ready' : 'missing',
      hint:
        minOrtho === undefined && maxSkew === undefined
          ? 'Quality fields were not reported'
          : `min orthogonality ${metricText(minOrtho)} · max skewness ${metricText(maxSkew)}`,
    },
    {
      label: 'Simulation parameters are available',
      status: hasParams ? 'ready' : 'missing',
      hint: hasParams ? 'SimulationParams patch can be derived from the baseline' : 'Baseline SimulationParams missing',
    },
    {
      label: 'No partial Flow360 reads were reported',
      status: noErrors ? 'ready' : 'warning',
      hint: noErrors ? 'All Flow360 calls for this snapshot succeeded' : 'Some fields fell back to cache defaults',
    },
  ]
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
  onPlanCase: () => void
  onShowLogs?: () => void
}) {
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({})
  const [volumeFields, setVolumeFields] = useState<string[]>([])
  const [activeSlice, setActiveSlice] = useState<string | null>(null)

  const handleFieldsDiscovered = useCallback((fields: UVFFieldInfo[]) => {
    const sliceFields = fields.filter((f) =>
      /slice|cell|growth|layer|zone|interface|orthog|skew/i.test(f.name),
    )
    setVolumeFields(sliceFields.map((f) => f.name))
  }, [])

  const { manifest, state: viewerState, source: previewSource, primaryError } = useResourcePreview(
    detail ? 'VolumeMesh' : null,
    resourceId ?? detail?.id ?? null,
    detail && geometryResourceId ? 'Geometry' : null,
    geometryResourceId ?? null,
  )
  const status = resourceStatus(detail)
  const statusLower = status.toLowerCase()
  const failed = ['failed', 'error'].includes(statusLower)
  const source = detail?.summary ?? detail?.state ?? detail?.simulation_params
  const unit = findLengthUnit([
    detail?.simulation_params,
    detail?.summary,
    detail?.state,
  ])
  const viewerContext = useMemo(() => createViewerContext({
    projectId,
    resourceRef,
    assetSource: previewSource,
    fallbackAssetRef: geometryResourceId
      ? { id: geometryResourceId, type: 'Geometry' }
      : null,
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

  const metrics = [
    {
      label: 'Cell count',
      value: findMetric(source, ['cell_count', 'num_cells', 'cells', 'element_count', 'volume_cell_count']),
      icon: Layers,
    },
    {
      label: 'Node count',
      value: findMetric(source, ['node_count', 'num_nodes', 'nodes', 'vertex_count']),
      icon: Share2,
    },
    {
      label: 'Minimum orthogonality',
      value: findMetric(source, ['minimum_orthogonality', 'min_orthogonality', 'orthogonality']),
      icon: Triangle,
    },
    {
      label: 'Maximum skewness',
      value: findMetric(source, ['max_skewness', 'maximum_skewness', 'skewness']),
      icon: ScanLine,
    },
    {
      label: 'Minimum cell size',
      value: findMetric(source, ['min_cell_size', 'minimum_cell_size', 'cell_size']),
      icon: Ruler,
    },
    {
      label: 'Computing domain',
      value: findMetric(source, ['domain_extent', 'domain', 'bounding_box']),
      icon: Volume2,
    },
  ]
  const reportedMetrics = metrics.filter((metric) => isReportedMetric(metric.value))

  const checks = computeReadiness(detail)
  const readyCount = checks.filter((c) => c.status === 'ready').length
  const warningCount = checks.filter((c) => c.status === 'warning' || c.status === 'missing').length
  const blockedCount = checks.filter((c) => c.status === 'blocked').length
  const reviewLevel = blockedCount > 0 ? 'blocked' : warningCount > 0 ? 'warning' : 'ready'
  const reviewLabel = reviewLevel === 'ready'
    ? 'Ready for Case planning'
    : reviewLevel === 'blocked' ? 'Resolve volume mesh blockers' : 'Engineering review required'
  const reviewDetail = reviewLevel === 'ready'
    ? 'The volume mesh lifecycle, cell inventory, quality evidence, and parameters are available for downstream review.'
    : reviewLevel === 'blocked'
      ? 'The volume mesh failed. Review the logs and correct meshing inputs before planning a Case.'
      : 'Review missing mesh evidence and lifecycle state before relying on this domain for a Case.'
  const groups = manifest?.groups ?? []
  const visibleGroupCount = groups.filter((group) => entityVisibility[group.id] ?? group.visible).length
  const selectedGroup = groups.find((group) => group.id === viewerSelection.groupId) ?? null

  const toggleGroupVisibility = (groupId: string) => {
    const group = groups.find((candidate) => candidate.id === groupId)
    if (!group) return
    setEntityVisibility((current) => ({
      ...current,
      [groupId]: !(current[groupId] ?? group.visible),
    }))
  }

  const showAllGroups = () => {
    setEntityVisibility(Object.fromEntries(groups.map((group) => [group.id, true])))
  }

  return (
    <ResourceReviewLayout
      className="volume-mesh-workspace volume-review-workspace"
      inventoryLabel="VolumeMesh region inventory"
      inspectorLabel="VolumeMesh engineering review"
      inventory={(
        <>
          <div className="geometry-panel-heading">
            <div>
              <span>{previewSource === 'fallback' ? 'CONTEXT' : 'REGIONS'}</span>
              <strong>{previewSource === 'fallback' ? 'Geometry inventory' : 'Domain inventory'}</strong>
            </div>
            <span className="geometry-count-badge">{groups.length}</span>
          </div>
          <div className="geometry-selection-tools volume-region-tools">
            <strong>{visibleGroupCount}/{groups.length} visible</strong>
            <button type="button" onClick={showAllGroups} disabled={groups.length === 0}>Show all</button>
          </div>
          <div className="geometry-entity-tree">
            <div className="geometry-tree-root">
              <Volume2 size={13} />
              <strong>{previewSource === 'fallback' ? 'Geometry surfaces' : 'Cell zones and regions'}</strong>
              <span>{groups.length}</span>
            </div>
            {groups.map((group) => {
              const visible = entityVisibility[group.id] ?? group.visible
              return (
                <div
                  className={`geometry-entity-row ${viewerSelection.groupId === group.id ? 'selected' : ''} ${visible ? '' : 'hidden'}`}
                  data-entity-id={group.id}
                  key={group.id}
                >
                  <button
                    type="button"
                    className="geometry-entity-select"
                    onClick={() => setViewerSelection({ groupId: group.id })}
                    title="Select volume region"
                  >
                    <span className="viewer-color-swatch" style={{ background: group.color }} />
                    <span>{group.name}</span>
                    <small>{group.triangles !== undefined ? `${group.triangles.toLocaleString()} elems` : 'region'}</small>
                  </button>
                  <button
                    type="button"
                    className="geometry-entity-visibility"
                    aria-label={`${visible ? 'Hide' : 'Show'} region ${group.name}`}
                    aria-pressed={visible}
                    onClick={() => toggleGroupVisibility(group.id)}
                  >
                    {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                </div>
              )
            })}
            {groups.length === 0 && (
              <div className="geometry-empty-list">No volume regions were reported by the visualization asset.</div>
            )}
          </div>
        </>
      )}
      viewer={(
        <>
          <LazyViewer3D
            manifest={manifest}
            state={viewerState}
            selection={viewerSelection}
            onSelectionChange={setViewerSelection}
            entityVisibility={entityVisibility}
            onEntityVisibilityChange={setEntityVisibility}
            selectedField={activeSlice}
            showEntityLegend={false}
            onFieldsDiscovered={handleFieldsDiscovered}
            projectId={projectId}
            resourceRef={viewerContext.assetRef}
            toolInput={tools.toolInput}
            overlays={tools.overlays}
            onDoubleClick={tools.onDoubleClick}
            toolbar={(
              <>
                {volumeFields.length > 0 && (
                  <>
                    <button
                      className={!activeSlice ? 'active' : ''}
                      onClick={() => setActiveSlice(null)}
                      aria-label="Show full mesh"
                    >
                      <Layers size={10} /> Full
                    </button>
                    {volumeFields.slice(0, 4).map((name) => (
                      <button
                        key={name}
                        className={activeSlice === name ? 'active' : ''}
                        onClick={() => setActiveSlice(activeSlice === name ? null : name)}
                      >
                        {name}
                      </button>
                    ))}
                  </>
                )}
                <ViewerToolsDock model={tools} />
              </>
            )}
          />
          <ViewerToolPanel model={tools} />
        </>
      )}
      inspector={(
        <>
          <div className={`geometry-readiness-card ${reviewLevel}`}>
            <div className="geometry-panel-heading">
              <div><span>VOLUME MESH REVIEW</span><strong>{reviewLabel}</strong></div>
              {reviewLevel === 'ready'
                ? <CheckCircle2 size={20} />
                : reviewLevel === 'blocked'
                  ? <AlertCircle size={20} />
                  : <Activity size={20} />}
            </div>
            <p>{reviewDetail}</p>
            <div className="geometry-readiness-counts">
              {blockedCount > 0 && <span className="blocked">{blockedCount} blocker{blockedCount === 1 ? '' : 's'}</span>}
              {warningCount > 0 && <span className="warning">{warningCount} warnings / missing</span>}
              <span className="warning">Status · {status}</span>
            </div>
          </div>
          {reportedMetrics.length > 0 && (
            <div className="geometry-summary-grid volume-summary-grid">
              {reportedMetrics.map(({ label, value, icon: Icon }) => (
                <div key={label}>
                  <span><Icon size={12} /> {label}</span>
                  <strong>{metricText(value)}</strong>
                </div>
              ))}
            </div>
          )}
          <section className="geometry-selection-card volume-selection-card">
            <div className="geometry-section-title"><Layers size={13} /> Selection properties</div>
            {selectedGroup ? (
              <dl>
                <div><dt>Name</dt><dd>{selectedGroup.name}</dd></div>
                <div><dt>ID</dt><dd title={selectedGroup.id}>{selectedGroup.id}</dd></div>
                <div><dt>Elements</dt><dd>{selectedGroup.triangles?.toLocaleString() ?? 'Not reported'}</dd></div>
                <div><dt>Vertices</dt><dd>{selectedGroup.vertices?.toLocaleString() ?? 'Not reported'}</dd></div>
              </dl>
            ) : (
              <p>Select a cell zone or region in the inventory or 3D viewer to inspect it.</p>
            )}
          </section>
          {previewSource === 'fallback' && (
            <div className="volume-source-warning" role="status">
              <AlertCircle size={14} />
              <span>
                <strong>Geometry context shown</strong>
                The VolumeMesh slice asset is unavailable; these are parent Geometry surfaces, not volume cells.
              </span>
            </div>
          )}
          <div className="geometry-checks volume-mesh-checks">
            {checks.map((check) => (
              <div className={check.status === 'missing' ? 'unknown' : check.status} key={check.label}>
                {check.status === 'ready' ? (
                  <CheckCircle2 size={14} />
                ) : check.status === 'blocked' ? (
                  <AlertCircle size={14} />
                ) : (
                  <CircleDashed size={14} />
                )}
                <div>
                  <span>{check.label}</span>
                  <small>{check.hint}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="geometry-plan-action-stack">
            <button
              className="geometry-plan-action"
              onClick={onPlanCase}
              disabled={failed}
              title={failed ? 'Cannot plan a Case from a failed volume mesh' : 'Plan a Case using this volume mesh'}
            >
              <GitPullRequestDraft size={15} />
              Plan Case
            </button>
            {failed && onShowLogs && (
              <button className="secondary-action" onClick={onShowLogs}>
                <Activity size={14} />
                View Logs
              </button>
            )}
            <small className="readiness-summary">{readyCount}/{checks.length} readiness checks passed</small>
            {primaryError && previewSource === 'fallback' && (
              <small className="cfd-source-detail" title={primaryError}>Spatial context fallback is active</small>
            )}
          </div>
          <section className="geometry-inspection-card volume-review-order">
            <div className="geometry-section-title"><ScanLine size={13} /> CFD review order</div>
            <ol>
              <li>Domain extent and zones</li>
              <li>Near-wall prism layers</li>
              <li>Worst aspect ratio / minimum edge slices</li>
              <li>Wake and refinement continuity</li>
            </ol>
          </section>
        </>
      )}
    />
  )
}
