import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Pause,
  Play,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type PlanExecutionSnapshot, type SimulationPlan } from '../api/client'
import { errorMessage } from '../lib/errors'

export function isExecutionTrackable(plan: SimulationPlan) {
  return ['running', 'submitted', 'reconciling', 'completed', 'failed'].includes(plan.status)
}

export default function ExecutionMonitor({
  plan,
  onPlanUpdate,
}: {
  plan: SimulationPlan
  onPlanUpdate: (plan: SimulationPlan) => void
}) {
  const [snapshot, setSnapshot] = useState<PlanExecutionSnapshot | null>(null)
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    try {
      const next = await api.planExecution(plan.id)
      setSnapshot(next)
      setRefreshError('')
      onPlanUpdate(next.plan)
    } catch (cause) {
      setRefreshError(errorMessage(cause))
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [onPlanUpdate, plan.id])

  useEffect(() => {
    setSnapshot(null)
    setPaused(false)
    setRefreshError('')
  }, [plan.id])

  useEffect(() => {
    if (!isExecutionTrackable(plan)) return
    void refresh()
    if (paused || snapshot?.terminal) return
    const timer = window.setInterval(() => void refresh(), 4000)
    return () => window.clearInterval(timer)
  }, [paused, plan.status, refresh, snapshot?.terminal])

  const phase = snapshot?.phase
    ?? (plan.status === 'running' ? 'Submitting to Flow360'
      : plan.status === 'reconciling' ? 'Reconciling remote submission'
        : plan.status === 'completed' ? 'Completed'
          : plan.status === 'failed' ? 'Failed'
            : 'Accepted by Flow360')
  const progress = snapshot?.progress
    ?? (plan.status === 'completed' || plan.status === 'failed' ? 100 : plan.status === 'running' ? 15 : 35)
  const terminal = snapshot?.terminal ?? ['completed', 'failed'].includes(plan.status)
  const success = phase === 'Completed'

  return (
    <section className={`execution-monitor ${terminal ? success ? 'complete' : 'failed' : ''}`}>
      <header>
        <div className="execution-monitor-title">
          {terminal
            ? success ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />
            : <Activity size={18} className={loading ? 'pulse' : ''} />}
          <span>
            <strong>{phase}</strong>
            <small>
              {paused ? 'Live updates paused · the Flow360 cloud run continues'
                : terminal ? 'Final remote state'
                  : 'Live status · refreshes every 4 seconds'}
            </small>
          </span>
        </div>
        <div className="execution-monitor-actions">
          {!terminal && (
            <button type="button" onClick={() => setPaused((current) => !current)}>
              {paused ? <Play size={13} /> : <Pause size={13} />}
              {paused ? 'Resume updates' : 'Pause updates'}
            </button>
          )}
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
        </div>
      </header>

      <div className="execution-progress-row">
        <div className="execution-progress-track" aria-label={`${progress}% complete`}>
          <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
        <strong>{progress}%</strong>
      </div>

      <div className="execution-metadata">
        {snapshot?.resource_type && <span><small>Resource</small><strong>{snapshot.resource_type}</strong></span>}
        {snapshot?.resource_id && <span><small>Remote ID</small><code>{snapshot.resource_id}</code></span>}
        {snapshot?.remote_state && <span><small>Flow360 state</small><strong>{snapshot.remote_state}</strong></span>}
        {snapshot?.refreshed_at && <span><small>Last refresh</small><strong>{new Date(snapshot.refreshed_at).toLocaleTimeString()}</strong></span>}
      </div>

      {snapshot?.state_error && <div className="execution-inline-warning"><AlertCircle size={13} />{snapshot.state_error}</div>}
      {refreshError && <div className="execution-inline-warning"><AlertCircle size={13} />Status refresh failed: {refreshError}</div>}

      <div className="execution-log">
        <div className="execution-log-heading">
          <span><Terminal size={14} /><strong>Flow360 log tail</strong></span>
          <small>Latest 120 lines</small>
        </div>
        {snapshot?.logs_available
          ? <pre>{snapshot.logs || 'Flow360 returned an empty log tail.'}</pre>
          : <div className="execution-log-empty">
              {snapshot?.logs_error ?? (loading ? 'Loading remote logs…' : 'Logs will appear after Flow360 starts the remote job.')}
            </div>}
      </div>
    </section>
  )
}
