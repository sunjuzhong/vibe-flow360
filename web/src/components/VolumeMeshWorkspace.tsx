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
import { useDistanceTool } from '../hooks/useDistanceTool'
import { DistanceToolPanel } from '../lib/viewer-tools/distance/DistanceToolPanel'
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
  const terminal = ['completed', 'processed', 'success', 'failed', 'error'].includes(statusLower)
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
  const distance = useDistanceTool({
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

  const checks = computeReadiness(detail)
  const readyCount = checks.filter((c) => c.status === 'ready').length

  return (
    <section className="volume-mesh-workspace cfd-stage-workspace">
      <div className="viewer-section cfd-stage-viewer">
        <LazyViewer3D
          manifest={manifest}
          state={viewerState}
          selection={viewerSelection}
          onSelectionChange={setViewerSelection}
          onFieldsDiscovered={handleFieldsDiscovered}
          projectId={projectId}
          resourceRef={viewerContext.assetRef}
          toolInput={distance.toolInput}
          overlays={distance.overlays}
          toolbar={
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
              <button type="button" className={distance.active ? 'active' : ''} aria-pressed={distance.active} onClick={distance.toggle}>
                <Ruler size={10} /> Measure
              </button>
            </>
          }
        />
        <div className={`cfd-viewer-source ${previewSource === 'fallback' ? 'context' : ''}`} role="status" aria-live="polite">
          <ScanLine size={13} />
          <div>
            <strong>{previewSource === 'fallback' ? 'Geometry context' : 'Volume mesh'}</strong>
            <span aria-label="volume mesh description">
              {previewSource === 'fallback'
                ? 'The VolumeMesh slice asset is unavailable; this is the parent Geometry, not volume cells.'
                : 'Inspect crinkled slices, cell growth, boundary layers, and zone interfaces.'}
            </span>
          </div>
        </div>
        <aside className="cfd-decision-panel">
          <div className="mesh-workspace-heading">
            <div>
              <span>VOLUME MESH REVIEW</span>
              <strong>Will this domain support a stable solution?</strong>
              <small>
                {terminal
                  ? failed
                    ? 'The mesh failed. Diagnose before retrying.'
                    : `Flow360 status: ${status}`
                  : 'Processing status refreshes automatically.'}
              </small>
            </div>
            {failed ? <AlertCircle size={20} className="status-failed" /> : <Activity size={20} />}
          </div>
          <div className="mesh-quality-grid volume-mesh cfd-quality-strip">
            {metrics.map(({ label, value, icon: Icon }) => (
              <div key={label} className="metric-card">
                <Icon size={14} />
                <span>{label}</span>
                <strong>{metricText(value)}</strong>
              </div>
            ))}
          </div>
          <div className="geometry-checks volume-mesh-checks">
            {checks.map((check) => (
              <div className={`volume-check volume-check-${check.status}`} key={check.label}>
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
          <DistanceToolPanel model={distance} />
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
        </aside>
      </div>
      <div className="cfd-stage-guidance">
        <strong>CFD review order</strong>
        <span>1. Domain extent and zones</span>
        <span>2. Near-wall prism layers</span>
        <span>3. Worst aspect ratio / minimum edge slices</span>
        <span>4. Wake and refinement continuity</span>
      </div>
    </section>
  )
}
