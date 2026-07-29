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
  TrendingUp,
  TrendingDown,
  BarChart3,
} from 'lucide-react'
import { resourceStatus } from './ResourceDetailPanel'
import type { ResourceDetail } from '../api/client'
import { useConvergenceAssessment } from '../hooks/useConvergenceAssessment'
import type { ConvergenceAssessment, ConvergenceMetric, ConvergenceResult } from '../hooks/useConvergenceAssessment'

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
  onPlanCase,
  onRefresh,
}: {
  detail: ResourceDetail | null
  onPlanCase: () => void
  onRefresh: () => void
}) {
  const viewModel = normalizeCase(detail)
  const terminal = isTerminal(viewModel.status)
  const resultCount = detail?.results?.records?.length ?? 0
  const hasErrors = Boolean(detail?.errors && Object.keys(detail.errors).length)

  const { result: convergence, loading: convergenceLoading, refetch: refetchConvergence } =
    useConvergenceAssessment(detail?.id ?? null)

  const convResult = convergence as ConvergenceResult | null

  return (
    <section className="case-workspace">
      <div className="case-workspace-heading">
        <div>
          <span>CASE OVERVIEW</span>
          <strong>
            {viewModel.status === 'completed' && 'Simulation completed'}
            {viewModel.status === 'running' && 'Simulation in progress'}
            {viewModel.status === 'preprocessing' && 'Preparing solver inputs'}
            {viewModel.status === 'queued' && 'Waiting for execution slot'}
            {viewModel.status === 'failed' && 'Simulation failed'}
            {viewModel.status === 'unknown' && 'Simulation state is unknown'}
          </strong>
          <small>
            {terminal
              ? 'This Case reached a terminal state. Review results or plan a variation.'
              : 'Non-terminal Case states auto-refresh every 10 seconds.'}
          </small>
        </div>
        <div className="case-status-controls">
          <StatusBadge status={viewModel.status} />
          {!terminal && (
            <button className="toolbar-refresh" onClick={onRefresh} aria-label="Refresh case state">
              <Activity size={13} /> Refresh
            </button>
          )}
        </div>
      </div>

      {convResult && (
        <div className="case-convergence-section">
          <div className="convergence-header">
            <h3><BarChart3 size={15} /> Convergence Assessment</h3>
            <button
              className="toolbar-refresh"
              onClick={refetchConvergence}
              disabled={convergenceLoading}
              aria-label="Refresh convergence"
            >
              <RotateCw size={13} /> Refresh
            </button>
          </div>
          <div className={`convergence-banner convergence-${convResult.status}`}>
            {convResult.status === 'converged' && <CheckCircle2 size={18} />}
            {convResult.status === 'not-converged' && <AlertCircle size={18} />}
            {convResult.status === 'insufficient-data' && <CircleDashed size={18} />}
            <div>
              <strong>{formatConvergenceStatus(convResult.status)}</strong>
              <p>{convResult.reason}</p>
            </div>
          </div>
          {Object.entries(convResult.assessments).map(([key, assessment]: [string, ConvergenceAssessment]) => (
            <div key={key} className="convergence-metrics">
              <h4>{formatAssessmentKey(key)}</h4>
              <div className="convergence-metrics-grid">
                {Object.entries(assessment.metrics).map(([name, metric]: [string, ConvergenceMetric]) => (
                  <div key={name} className={`metric-card metric-${metric.stable ? 'stable' : 'unstable'}`}>
                    <div className="metric-header">
                      <span className="metric-name">{name}</span>
                      {metric.trend === 'decreasing' && <TrendingDown size={14} className="trend-down" />}
                      {metric.trend === 'increasing' && <TrendingUp size={14} className="trend-up" />}
                      {metric.trend === 'stable' && <span className="trend-stable">•</span>}
                    </div>
                    <div className="metric-values">
                      <div>Final: <strong>{formatNumber(metric.final)}</strong></div>
                      <div>Range: {formatNumber(metric.min)} – {formatNumber(metric.max)}</div>
                      <div>Mean: {formatNumber(metric.mean)}</div>
                      <div className={metric.stable ? 'stable-text' : 'unstable-text'}>
                        {metric.stable ? 'Stable' : 'Unstable'} {metric.oscillating && '(oscillating)'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {assessment.warnings && assessment.warnings.length > 0 && (
                <div className="convergence-warnings">
                  {assessment.warnings.map((w: string, i: number) => (
                    <p key={i} className="warning-text">{w}</p>
                  ))}
                </div>
              )}
            </div>
          ))}
          {convResult.files.length === 0 && (
            <p className="convergence-empty">No result files found for convergence assessment.</p>
          )}
        </div>
      )}

      <div className="case-overview-grid">
        <div className="case-metric-card">
          <Clock size={15} />
          <span>Elapsed wall time</span>
          <strong>{viewModel.runTime}</strong>
        </div>
        <div className="case-metric-card">
          <Clock size={15} />
          <span>Started</span>
          <strong>{viewModel.startTime}</strong>
        </div>
        <div className="case-metric-card">
          <Clock size={15} />
          <span>Finished</span>
          <strong>{viewModel.endTime}</strong>
        </div>
        <div className="case-metric-card">
          <FileOutput size={15} />
          <span>Result artifacts</span>
          <strong>{resultCount}</strong>
        </div>
      </div>

      {hasErrors && (
        <div className="case-warning-banner">
          <AlertCircle size={15} />
          <span>
            Some Flow360 fields for this Case are incomplete. The displayed summary may be partial.
          </span>
        </div>
      )}

      <div className="case-detail-grid">
        <section className="case-detail-section">
          <h3><Gauge size={15} /> Operating conditions</h3>
          <dl className="case-detail-list">
            {Object.keys(viewModel.operatingPoint).length ? (
              Object.entries(viewModel.operatingPoint).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{metricText(v)}</dd></div>
              ))
            ) : (
              <div className="case-empty">Not reported by Flow360 snapshot.</div>
            )}
          </dl>
        </section>

        <section className="case-detail-section">
          <h3><Thermometer size={15} /> Solver settings</h3>
          <dl className="case-detail-list">
            {Object.keys(viewModel.solverSettings).length ? (
              Object.entries(viewModel.solverSettings).slice(0, 8).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{metricText(v)}</dd></div>
              ))
            ) : (
              <div className="case-empty">Not reported by Flow360 snapshot.</div>
            )}
          </dl>
          <p className="case-subitem"><Wind size={12} /> Turbulence: {viewModel.turbulenceModel}</p>
        </section>

        <section className="case-detail-section">
          <h3><Wind size={15} /> Reference quantities</h3>
          <dl className="case-detail-list">
            {Object.keys(viewModel.referenceQuantities).length ? (
              Object.entries(viewModel.referenceQuantities).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{metricText(v)}</dd></div>
              ))
            ) : (
              <div className="case-empty">Not reported by Flow360 snapshot.</div>
            )}
          </dl>
        </section>
      </div>

      <div className="case-actions-row">
        <button
          className="geometry-plan-action"
          onClick={onPlanCase}
          disabled={viewModel.status === 'failed'}
          title={viewModel.status === 'failed' ? 'Cannot plan a variation from a failed Case' : 'Plan a Case variation'}
        >
          <GitPullRequestDraft size={15} />
          Plan Case Variation
        </button>
        <small className="readiness-summary">
          Case variation creation is staged as an auditable plan — it does not submit to Flow360 directly.
        </small>
      </div>
    </section>
  )
}
