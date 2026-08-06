import {
  Activity,
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  GitPullRequestDraft,
  Play,
  Pause,
  RotateCw,
  Gauge,
  Thermometer,
  Wind,
  FileOutput,
  BarChart3,
  ScanLine,
  Layers,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { resourceStatus } from './ResourceDetailPanel'
import { api, type ResourceDetail } from '../api/client'
import { useConvergenceAssessment } from '../hooks/useConvergenceAssessment'
import type { ConvergenceAssessment, ConvergenceMetric, ConvergenceResult } from '../hooks/useConvergenceAssessment'
import { LazyViewer3D, type ViewerSelection } from './viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import { ResourceReviewLayout } from './ResourceReviewLayout'
import { ResultTablePreview, isTabularResult } from './ResultTablePreview'
import { StructuredDataView } from './StructuredDataView'
import {
  createViewerContext,
  findLengthUnit,
} from '../lib/viewer-tools/context/ViewerContext'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'
import type { UVFFieldInfo } from '../lib/uvf-three'
import {
  ManifestMemberGroup,
  manifestVisibilityMap,
  visibleManifestMemberCount,
} from './ManifestMemberGroup'

function formatConvergenceStatus(status: string): string {
  switch (status) {
    case 'converged': return 'Converged — Results are stable'
    case 'not-converged': return 'Not Converged — Results show drift or instability'
    case 'insufficient-data': return 'Insufficient Data — Unable to assess convergence'
    default: return status
  }
}

function formatAssessmentKey(key: string): string {
  switch (key) {
    case 'residuals': return 'Residual Convergence'
    case 'forces': return 'Force Coefficients'
    case 'overall': return 'Overall Assessment'
    default: return key.charAt(0).toUpperCase() + key.slice(1)
  }
}

function formatNumber(v: number): string {
  if (Math.abs(v) >= 1) return v.toFixed(4)
  if (Math.abs(v) >= 0.01) return v.toFixed(6)
  return v.toExponential(3)
}

export type CaseStatusView =
  | 'queued'
  | 'preprocessing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'unknown'

export function mapCaseStatus(detail: ResourceDetail | null): CaseStatusView {
  const raw = resourceStatus(detail).toLowerCase()
  if (['queued', 'pending', 'waiting'].includes(raw)) return 'queued'
  if (['preprocessing', 'pre-process'].includes(raw)) return 'preprocessing'
  if (['running', 'executing'].includes(raw)) return 'running'
  if (['completed', 'processed', 'success', 'done'].includes(raw)) return 'completed'
  if (['failed', 'error', 'crashed'].includes(raw)) return 'failed'
  return 'unknown'
}

export function statusLabel(view: CaseStatusView): string {
  switch (view) {
    case 'queued': return 'Queued'
    case 'preprocessing': return 'Preprocessing'
    case 'running': return 'Running'
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
    default: return 'Unknown'
  }
}

export function isTerminal(view: CaseStatusView): boolean {
  return view === 'completed' || view === 'failed'
}

type CaseSurfaceGroup = { id: string; visible: boolean }

export function visibleCaseSurfaceCount(groups: CaseSurfaceGroup[], visibility: Record<string, boolean>): number {
  return visibleManifestMemberCount(groups, visibility)
}

export function caseSurfaceVisibilityMap(groups: CaseSurfaceGroup[], visible: boolean): Record<string, boolean> {
  return manifestVisibilityMap(groups, visible)
}

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
  if (typeof value === 'object' && value && 'value' in (value as object)) {
    const metric = value as { value?: unknown; units?: unknown }
    return `${metric.value ?? '—'}${metric.units ? ` ${metric.units}` : ''}`
  }
  return JSON.stringify(value)
}

type NormalizedCase = {
  status: CaseStatusView
  runTime: string
  startTime: string
  endTime: string
  operatingPoint: Record<string, unknown>
  solverSettings: Record<string, unknown>
  turbulenceModel: string
  referenceQuantities: Record<string, unknown>
  resultCount: number
}

export function normalizeCase(detail: ResourceDetail | null): NormalizedCase {
  const view = mapCaseStatus(detail)
  const summary = detail?.summary ?? {}
  const info = detail?.info ?? {}
  const params = detail?.simulation_params ?? {}

  const startRaw = findMetric(info, ['started_at', 'start_time', 'started'])
  const endRaw = findMetric(info, ['completed_at', 'end_time', 'finished', 'completed'])
  const elapsed = findMetric(summary, ['elapsed_time', 'run_time', 'duration', 'wall_time'])

  const operatingCondition =
    findMetric(params, ['operating_condition']) ??
    findMetric(summary, ['operating_condition']) ??
    {}
  const solver =
    findMetric(params, ['solver']) ??
    findMetric(summary, ['solver']) ??
    {}
  const turbulence =
    findMetric(summary, ['turbulence_model', 'turbulence']) ??
    findMetric(params, ['turbulence_model']) ??
    'Not reported'
  const references =
    findMetric(params, ['reference_quantities']) ??
    findMetric(summary, ['reference_quantities']) ??
    {}

  return {
    status: view,
    runTime: metricText(elapsed),
    startTime: metricText(startRaw),
    endTime: metricText(endRaw),
    operatingPoint: (operatingCondition && typeof operatingCondition === 'object'
      ? (operatingCondition as Record<string, unknown>)
      : {}),
    solverSettings: (solver && typeof solver === 'object'
      ? (solver as Record<string, unknown>)
      : {}),
    turbulenceModel: typeof turbulence === 'string' ? turbulence : metricText(turbulence),
    referenceQuantities: (references && typeof references === 'object'
      ? (references as Record<string, unknown>)
      : {}),
    resultCount: detail?.results?.records?.length ?? 0,
  }
}

function StatusBadge({ status }: { status: CaseStatusView }) {
  const map: Record<CaseStatusView, { icon: React.ComponentType<{ size?: number }>; className: string }> = {
    queued: { icon: Pause, className: 'status-queued' },
    preprocessing: { icon: RotateCw, className: 'status-preprocessing' },
    running: { icon: Play, className: 'status-running' },
    completed: { icon: CheckCircle2, className: 'status-completed' },
    failed: { icon: AlertCircle, className: 'status-failed' },
    unknown: { icon: CircleDashed, className: 'status-unknown' },
  }
  const cfg = map[status]
  const Icon = cfg.icon
  return (
    <span className={`hero-status ${cfg.className}`}>
      <Icon size={13} /> {statusLabel(status)}
    </span>
  )
}

export default function CaseWorkspace({
  detail,
  resourceId,
  projectId,
  resourceRef,
  annotationsModel,
  geometryResourceId,
  onPlanCase,
  onRefresh,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  projectId: string
  resourceRef: ResourceRef
  annotationsModel: ProjectAnnotationsModel<JsonValue>
  geometryResourceId?: string | null
  onPlanCase: () => void
  onRefresh: () => void
}) {
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({})
  const [caseFields, setCaseFields] = useState<string[]>([])
  const [activeField, setActiveField] = useState<string | null>(null)
  const [resultPreview, setResultPreview] = useState<{
    path: string
    content?: string
    error?: string
    loading: boolean
  } | null>(null)
  const viewModel = normalizeCase(detail)
  const terminal = isTerminal(viewModel.status)
  const resultCount = detail?.results?.records?.length ?? 0
  const hasErrors = Boolean(detail?.errors && Object.keys(detail.errors).length)

  const { result: convergence, loading: convergenceLoading, refetch: refetchConvergence } =
    useConvergenceAssessment(detail?.id ?? null)

  const convResult = convergence as ConvergenceResult | null
  const { manifest, state: viewerState, source: previewSource, primaryError } = useResourcePreview(
    detail ? 'Case' : null,
    resourceId ?? detail?.id ?? null,
    detail && geometryResourceId ? 'Geometry' : null,
    geometryResourceId ?? null,
  )
  const surfaceGroups = manifest?.groups ?? []
  const visibleSurfaceCount = visibleCaseSurfaceCount(surfaceGroups, entityVisibility)

  useEffect(() => {
    setEntityVisibility(Object.fromEntries(surfaceGroups.map((group) => [group.id, group.visible])))
    setViewerSelection({ groupId: null })
  }, [manifest?.asset_url])

  const toggleSurfaceVisibility = (groupId: string) => {
    const group = surfaceGroups.find((candidate) => candidate.id === groupId)
    if (!group) return
    setEntityVisibility((current) => ({
      ...current,
      [groupId]: !(current[groupId] ?? group.visible),
    }))
  }
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
  const velocity = findMetric(viewModel.operatingPoint, ['velocity_magnitude', 'velocity', 'mach'])

  const handleFieldsDiscovered = useCallback((fields: UVFFieldInfo[]) => {
    setCaseFields(fields.map((f) => f.name))
  }, [])

  const openResultPreview = useCallback(async (path: string) => {
    setResultPreview({ path, loading: true })
    try {
      const content = await api.previewResult('Case', resourceId ?? detail?.id ?? '', path)
      setResultPreview({ path, content, loading: false })
    } catch (error) {
      setResultPreview({ path, error: String(error).replace('Error: ', ''), loading: false })
    }
  }, [detail?.id, resourceId])

  const resultRecords = detail?.results?.records ?? []
  const reviewLevel = viewModel.status === 'failed'
    ? 'blocked'
    : viewModel.status === 'completed' && convResult?.status === 'converged'
      ? 'ready'
      : 'warning'
  const reviewLabel = viewModel.status === 'completed'
    ? convResult?.status === 'converged' ? 'Results ready for engineering use' : 'Review result confidence'
    : viewModel.status === 'failed'
      ? 'Resolve solver failure'
      : viewModel.status === 'running'
        ? 'Solution is progressing'
        : viewModel.status === 'unknown'
          ? 'Case state unavailable'
          : `${statusLabel(viewModel.status)} Case`
  const reviewDetail = terminal
    ? 'Judge convergence and physical outputs before using this Case or creating a variation.'
    : 'Monitor residuals, forces, CFL, and solution bounds while the solver advances.'

  return (
    <ResourceReviewLayout
      className="case-workspace case-review-workspace"
      inventoryLabel="Case solution inventory"
      inspectorLabel="Case engineering review"
      inventory={(
        <>
          <div className="geometry-panel-heading">
            <div>
              <span>{previewSource === 'fallback' ? 'CONTEXT' : 'SOLUTION'}</span>
              <strong>{previewSource === 'fallback' ? 'Geometry context' : 'Result fields'}</strong>
            </div>
            <span className="geometry-count-badge">{caseFields.length}</span>
          </div>
          <div className="case-surface-inventory">
            <ManifestMemberGroup
              label={previewSource === 'fallback' ? 'Geometry surfaces' : 'Case surfaces'}
              memberLabel="surfaces"
              icon={<Layers size={13} aria-hidden="true" />}
              total={surfaceGroups.length}
              visibleCount={visibleSurfaceCount}
              onHideAll={() => setEntityVisibility(caseSurfaceVisibilityMap(surfaceGroups, false))}
              onShowAll={() => setEntityVisibility(caseSurfaceVisibilityMap(surfaceGroups, true))}
            >
              <div className="case-surface-list">
                {surfaceGroups.map((group) => {
                  const visible = entityVisibility[group.id] ?? group.visible
                  return (
                    <div className={`geometry-entity-row ${viewerSelection.groupId === group.id ? 'selected' : ''} ${visible ? '' : 'hidden'}`} data-entity-id={group.id} key={group.id}>
                      <button type="button" className="geometry-entity-select" onClick={() => setViewerSelection({ groupId: group.id })} title="Select Case surface">
                        <span className="viewer-color-swatch" style={{ background: group.color }} />
                        <span>{group.name}</span>
                        <small>{group.triangles !== undefined ? `${group.triangles.toLocaleString()} tris` : 'surface'}</small>
                      </button>
                      <button
                        type="button"
                        className="geometry-entity-visibility"
                        aria-label={`${visible ? 'Hide' : 'Show'} surface ${group.name}`}
                        aria-pressed={visible}
                        onClick={() => toggleSurfaceVisibility(group.id)}
                      >
                        {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                    </div>
                  )
                })}
                {surfaceGroups.length === 0 && <div className="geometry-empty-list">No surfaces were reported by the visualization asset.</div>}
              </div>
            </ManifestMemberGroup>
          </div>
          <div className="case-field-inventory">
            <div className="geometry-tree-root">
              <ScanLine size={13} />
              <strong>Field visualization</strong>
              <span>{caseFields.length}</span>
            </div>
            <button
              type="button"
              className={`case-field-row ${activeField === null ? 'selected' : ''}`}
              onClick={() => setActiveField(null)}
            >
              <Layers size={12} />
              <span>Surface / mesh</span>
              <small>base</small>
            </button>
            {caseFields.map((field) => (
              <button
                type="button"
                className={`case-field-row ${activeField === field ? 'selected' : ''}`}
                onClick={() => setActiveField(field)}
                key={field}
              >
                <span className="case-field-swatch" />
                <span>{field}</span>
                <small>field</small>
              </button>
            ))}
            {caseFields.length === 0 && (
              <div className="geometry-empty-list">
                {previewSource === 'fallback'
                  ? 'No browser-ready Case fields; parent Geometry is shown for spatial context.'
                  : 'No solution fields were reported by the visualization asset.'}
              </div>
            )}
          </div>
          <div className="case-result-inventory">
            <div className="geometry-tree-root">
              <FileOutput size={13} />
              <strong>Result artifacts</strong>
              <span>{resultRecords.length}</span>
            </div>
            {resultRecords.map((result, index) => {
              const path = result.path
              const label = result.name ?? path ?? `Result ${index + 1}`
              const previewable = isTabularResult(path, result.file_type) && Boolean(path)
              const content = (
                <>
                  <FileOutput size={11} />
                  <span title={path ?? result.name}>{label}</span>
                  <small>{previewable ? 'Open' : result.file_type ?? 'file'}</small>
                </>
              )
              return previewable ? (
                <button
                  type="button"
                  className="case-result-row previewable"
                  onClick={() => void openResultPreview(path!)}
                  aria-label={`Preview ${label}`}
                  key={path ?? label}
                >
                  {content}
                </button>
              ) : (
                <div className="case-result-row" key={path ?? label}>{content}</div>
              )
            })}
            {resultRecords.length === 0 && <div className="geometry-empty-list">No result artifacts reported.</div>}
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
            selectedField={activeField}
            showEntityLegend={false}
            onFieldsDiscovered={handleFieldsDiscovered}
            projectId={projectId}
            resourceRef={viewerContext.assetRef}
            toolInput={tools.toolInput}
            overlays={tools.overlays}
            onDoubleClick={tools.onDoubleClick}
            toolbar={activeField && <span className="viewer-toolbar-field-hint">Field · {activeField}</span>}
            topToolbar={<ViewerToolsDock model={tools} />}
          />
          <ViewerToolPanel model={tools} />
          {previewSource === 'fallback' && (
            <div className="cfd-viewer-source context" role="status" aria-live="polite">
              <ScanLine size={13} />
              <div>
                <strong>Geometry context</strong>
                <span aria-label="case field description">
                  Case field data is unavailable; parent Geometry anchors the solver and result context.
                </span>
              </div>
            </div>
          )}
          {resultPreview && (
            <ResultTablePreview
              path={resultPreview.path}
              content={resultPreview.content}
              loading={resultPreview.loading}
              error={resultPreview.error}
              candidates={resultRecords.flatMap((result, index) => result.path && /\.csv$/i.test(result.path)
                ? [{ path: result.path, label: result.name ?? `Result ${index + 1}` }]
                : [])}
              loadCandidate={(candidatePath) => api.previewResult('Case', resourceId ?? detail?.id ?? '', candidatePath)}
              onClose={() => setResultPreview(null)}
            />
          )}
        </>
      )}
      inspector={(
        <>
          <div className={`geometry-readiness-card ${reviewLevel}`}>
            <div className="geometry-panel-heading case-review-heading">
              <div><span>CASE REVIEW</span><strong>{reviewLabel}</strong></div>
              <StatusBadge status={viewModel.status} />
            </div>
            <p>{reviewDetail}</p>
            <div className="geometry-readiness-counts">
              <span className={reviewLevel === 'blocked' ? 'blocked' : 'warning'}>Status · {statusLabel(viewModel.status)}</span>
              {convResult && <span className={convResult.status === 'converged' ? 'ready' : 'warning'}>Convergence · {convResult.status}</span>}
            </div>
          </div>

          {convResult && (
            <div className={`convergence-banner compact convergence-${convResult.status}`}>
              {convResult.status === 'converged' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              <div>
                <strong>{formatConvergenceStatus(convResult.status)}</strong>
                <p>{convResult.reason}</p>
              </div>
            </div>
          )}

          <div className="geometry-summary-grid case-summary-grid">
            <div><span><Clock size={12} /> Elapsed</span><strong>{viewModel.runTime}</strong></div>
            <div><span><Gauge size={12} /> Operating point</span><strong>{metricText(velocity)}</strong></div>
            <div><span><FileOutput size={12} /> Results</span><strong>{viewModel.resultCount}</strong></div>
            <div><span><Wind size={12} /> Turbulence</span><strong>{viewModel.turbulenceModel}</strong></div>
          </div>

          {hasErrors && (
            <div className="case-warning-banner">
              <AlertCircle size={14} />
              <span>Some Flow360 reads are incomplete; this review may be partial.</span>
            </div>
          )}

          <section className="geometry-selection-card case-lifecycle-card">
            <div className="geometry-section-title"><Activity size={13} /> Solver lifecycle</div>
            <dl>
              <div><dt>Started</dt><dd>{viewModel.startTime}</dd></div>
              <div><dt>Finished</dt><dd>{viewModel.endTime}</dd></div>
              <div><dt>Artifacts</dt><dd>{resultCount}</dd></div>
              <div><dt>Selected field</dt><dd>{activeField ?? 'Base mesh'}</dd></div>
            </dl>
          </section>

          <details className="case-review-details" open>
            <summary><Gauge size={13} /> Physical setup</summary>
            <div className="case-review-detail-block">
              <strong>Operating conditions</strong>
              <StructuredDataView value={viewModel.operatingPoint} empty="Not reported by Flow360 snapshot." />
              <strong>Reference quantities</strong>
              <StructuredDataView value={viewModel.referenceQuantities} empty="Not reported by Flow360 snapshot." />
            </div>
          </details>

          <details className="case-review-details">
            <summary><Thermometer size={13} /> Solver settings</summary>
            <div className="case-review-detail-block">
              <StructuredDataView value={viewModel.solverSettings} empty="Not reported by Flow360 snapshot." />
            </div>
          </details>

          {convResult && (
            <details className="case-review-details">
              <summary><BarChart3 size={13} /> Convergence evidence</summary>
              <div className="case-review-detail-block">
                {Object.entries(convResult.assessments).map(([key, assessment]: [string, ConvergenceAssessment]) => (
                  <div className="case-assessment-compact" key={key}>
                    <strong>{formatAssessmentKey(key)}</strong>
                    {Object.entries(assessment.metrics).map(([name, metric]: [string, ConvergenceMetric]) => (
                      <div className={metric.stable ? 'stable' : 'unstable'} key={name}>
                        <span>{name}</span>
                        <small>{formatNumber(metric.final)} · {metric.stable ? 'stable' : metric.trend}</small>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}

          {previewSource === 'fallback' && (
            <div className="volume-source-warning" role="status">
              <AlertCircle size={14} />
              <span><strong>Geometry context shown</strong>Case result fields are unavailable as a browser asset.</span>
            </div>
          )}

          <div className="case-review-actions">
            <button className="toolbar-refresh" onClick={() => { onRefresh(); refetchConvergence() }} disabled={convergenceLoading} aria-label="Refresh case state">
              <RotateCw size={13} /> Refresh
            </button>
            <button
              className="geometry-plan-action"
              onClick={onPlanCase}
              disabled={viewModel.status === 'failed'}
              title={viewModel.status === 'failed' ? 'Cannot create a Draft from a failed Case' : 'Configure a Case Draft variation'}
            >
              <GitPullRequestDraft size={14} /> Draft variation
            </button>
          </div>
          <small className="readiness-summary">Variations are staged as auditable Draft revisions before Flow360 execution.</small>
          {primaryError && previewSource === 'fallback' && (
            <small className="cfd-source-detail" title={primaryError}>Spatial context fallback is active</small>
          )}
        </>
      )}
    />
  )
}
