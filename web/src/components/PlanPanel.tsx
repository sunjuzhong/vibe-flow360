import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  Clock3,
  Code2,
  GitPullRequestDraft,
  Play,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ProjectInfo, type ResourceNode, type SimulationPlan } from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'

const targetOptions: Record<string, Array<{ value: SimulationPlan['target']; label: string }>> = {
  Geometry: [
    { value: 'surface-mesh', label: 'Surface Mesh' },
    { value: 'volume-mesh', label: 'Volume Mesh' },
    { value: 'case', label: 'Case' },
  ],
  SurfaceMesh: [
    { value: 'volume-mesh', label: 'Volume Mesh' },
    { value: 'case', label: 'Case' },
  ],
  VolumeMesh: [{ value: 'case', label: 'Case' }],
  Case: [{ value: 'case', label: 'Case variation' }],
}

function compactValue(value: unknown) {
  if (value === undefined) return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 180 ? `${text.slice(0, 180)}…` : text
}

function statusLabel(status: SimulationPlan['status']) {
  return {
    draft: 'Draft',
    approved: 'Approved',
    running: 'Submitting',
    submitted: 'Submitted',
    failed: 'Failed',
    reconciling: 'Reconciling',
  }[status]
}

const errorCategoryLabels: Record<string, string> = {
  timeout: 'Flow360 timed out',
  authentication: 'Authentication failed',
  validation: 'Validation rejected',
  network: 'Network error',
  unknown: 'Unknown error',
  double_submit: 'Double-submit blocked',
}

export default function PlanPanel({
  open,
  onClose,
  project,
  resource,
  onSubmitted,
}: {
  open: boolean
  onClose: () => void
  project: ProjectInfo
  resource: ResourceNode
  onSubmitted: () => void
}) {
  const options = targetOptions[resource.type] ?? []
  const [plans, setPlans] = useState<SimulationPlan[]>([])
  const [selected, setSelected] = useState<SimulationPlan | null>(null)
  const [showForm, setShowForm] = useState(true)
  const [name, setName] = useState('')
  const [intent, setIntent] = useState('')
  const [target, setTarget] = useState<SimulationPlan['target']>(options[0]?.value ?? 'case')
  const [patch, setPatch] = useState('{}')
  const [reviewed, setReviewed] = useState(false)
  const [executeConfirmed, setExecuteConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<'approve' | 'run' | 'compile' | null>(null)
  const [error, setError] = useState('')
  const panelRef = useFocusTrap(open, onClose, 'input,textarea,select,button.primary,button.execute,button:not(.icon-button)')

  const loadPlans = useCallback(async () => {
    try {
      const response = await api.plans(project.id, resource.id)
      setPlans(response.plans)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    }
  }, [project.id, resource.id])

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setShowForm(true)
    setName(`${resource.name} · ${options[0]?.label ?? 'Case'}`)
    setIntent('')
    setTarget(options[0]?.value ?? 'case')
    setPatch('{}')
    setReviewed(false)
    setExecuteConfirmed(false)
    setError('')
    void loadPlans()
  }, [loadPlans, open, options, resource.name])

  const hasValidationError = useMemo(
    () => selected?.validations.some((item) => item.level === 'error') ?? false,
    [selected],
  )

  const createPlan = async (event: FormEvent) => {
    event.preventDefault()
    if (loading || submittingAction) return
    setError('')
    let parsedPatch: Record<string, unknown>
    try {
      parsedPatch = JSON.parse(patch)
      if (!parsedPatch || Array.isArray(parsedPatch) || typeof parsedPatch !== 'object') {
        throw new Error('Patch must be a JSON object')
      }
    } catch (cause) {
      setError(`Invalid SimulationParams patch: ${String(cause).replace('Error: ', '')}`)
      return
    }
    setLoading(true)
    setSubmittingAction('compile')
    try {
      const plan = await api.createPlan({
        project_id: project.id,
        project_name: project.name,
        source_id: resource.id,
        source_type: resource.type,
        source_name: resource.name,
        target,
        name,
        intent,
        patch: parsedPatch,
      })
      setSelected(plan)
      setPlans((current) => [plan, ...current.filter((item) => item.id !== plan.id)])
      setShowForm(false)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setSubmittingAction(null)
    }
  }

  const approve = async () => {
    if (!selected || !reviewed || loading || submittingAction) return
    setLoading(true)
    setSubmittingAction('approve')
    setError('')
    try {
      const plan = await api.approvePlan(selected.id)
      setSelected(plan)
      setPlans((current) => current.map((item) => item.id === plan.id ? plan : item))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setSubmittingAction(null)
    }
  }

  const run = async () => {
    if (!selected || !executeConfirmed || loading || submittingAction) return
    if (selected.status !== 'approved' && selected.status !== 'failed') return
    if (selected.submission_id && selected.status !== 'failed') {
      setError('This plan has already been submitted to Flow360 and is protected from double-submit.')
      return
    }
    if (!window.confirm(`Submit “${selected.name}” to Flow360? This may create billable cloud resources.`)) return
    setLoading(true)
    setSubmittingAction('run')
    setError('')
    try {
      const plan = await api.runPlan(selected.id)
      setSelected(plan)
      setPlans((current) => current.map((item) => item.id === plan.id ? plan : item))
      if (plan.status === 'submitted') onSubmitted()
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
      const response = await api.plans(project.id, resource.id).catch(() => null)
      const latest = response?.plans.find((item) => item.id === selected.id)
      if (latest) setSelected(latest)
    } finally {
      setLoading(false)
      setSubmittingAction(null)
    }
  }

  if (!open) return null

  return (
    <div className="plan-overlay" role="presentation">
      <section
        ref={panelRef}
        className="plan-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Simulation execution plan"
      >
        <header className="plan-header">
          <span className="plan-header-icon"><GitPullRequestDraft size={18} /></span>
          <div><strong>Simulation plan</strong><span>{resource.type} · {resource.name}</span></div>
          <button className="icon-button" onClick={onClose} aria-label="Close plan"><X size={18} /></button>
        </header>

        <div className="plan-layout">
          <aside className="plan-history">
            <button className={showForm ? 'active' : ''} onClick={() => { setShowForm(true); setSelected(null) }}>
              <span><CircleDot size={13} /> New plan</span><ArrowRight size={12} />
            </button>
            <p>LOCAL PLANS</p>
            {plans.map((plan) => (
              <button
                className={!showForm && selected?.id === plan.id ? 'active' : ''}
                key={plan.id}
                onClick={() => { setSelected(plan); setShowForm(false); setReviewed(false); setExecuteConfirmed(false); setError('') }}
              >
                <span><strong>{plan.name}</strong><small>{statusLabel(plan.status)} · {new Date(plan.created_at).toLocaleString()}</small></span>
                <span className={`plan-status-dot status-${plan.status}`} />
              </button>
            ))}
            {!plans.length && <div className="plan-history-empty">No plans for this resource.</div>}
          </aside>

          <main className="plan-main">
            {showForm ? (
              <form className="plan-form" onSubmit={createPlan}>
                <div className="plan-step-heading"><span>1</span><div><strong>Define an auditable change</strong><small>Nothing is sent to Flow360 in this step.</small></div></div>
                <label>
                  <span>Plan / run name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
                </label>
                <label>
                  <span>Run up to</span>
                  <select value={target} onChange={(event) => setTarget(event.target.value as SimulationPlan['target'])}>
                    {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Engineering intent</span>
                  <textarea value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="What decision should this run support?" required />
                </label>
                <label>
                  <span>SimulationParams JSON merge patch</span>
                  <textarea className="plan-code-input" value={patch} onChange={(event) => setPatch(event.target.value)} spellCheck={false} />
                  <small>Use {'{}'} to reuse the current parameters unchanged. Small changes such as angle of attack or velocity are safest here.</small>
                </label>
                {error && <div className="plan-error"><AlertCircle size={14} />{error}</div>}
                <div className="plan-form-actions">
                  <button type="button" onClick={onClose} disabled={loading || !!submittingAction}>Cancel</button>
                  <button
                    className="primary"
                    disabled={loading || !!submittingAction || !name.trim() || !intent.trim()}
                    type="submit"
                  >
                    {loading && submittingAction === 'compile'
                      ? <RefreshCw size={14} className="spin" />
                      : <ShieldCheck size={14} />} Compile & validate
                  </button>
                </div>
              </form>
            ) : selected ? (
              <div className="plan-review">
                <button className="plan-back" onClick={() => setShowForm(true)}><ChevronLeft size={13} /> New plan</button>
                <div className="plan-review-title">
                  <div><p className="eyebrow">PLAN {selected.id}</p><h2>{selected.name}</h2><p>{selected.intent}</p></div>
                  <span className={`plan-status status-${selected.status}`}>{statusLabel(selected.status)}</span>
                </div>

                <div className="plan-route">
                  <span><small>Source</small><strong>{selected.source_type}</strong><em>{selected.source_name}</em></span>
                  <ArrowRight size={16} />
                  <span><small>Run up to</small><strong>{selected.target.replace('-', ' ')}</strong><em>new branch</em></span>
                </div>

                <section className="plan-review-section">
                  <h3><ShieldCheck size={15} /> Deterministic validation</h3>
                  <div className="validation-list">
                    {selected.validations.map((validation, index) => (
                      <div className={`validation-${validation.level}`} key={`${validation.field}-${index}`}>
                        {validation.level === 'success' ? <CheckCircle2 size={14} /> : validation.level === 'warning' ? <TriangleAlert size={14} /> : <AlertCircle size={14} />}
                        <span><strong>{validation.field || validation.level}</strong><small>{validation.message}</small></span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="plan-review-section">
                  <h3><Code2 size={15} /> Semantic parameter diff <span>{selected.differences.length}</span></h3>
                  {selected.differences.length ? (
                    <div className="diff-list">
                      {selected.differences.map((difference) => (
                        <div key={difference.path}>
                          <code>{difference.path}</code><span className={`diff-kind ${difference.kind}`}>{difference.kind}</span>
                          <small className="diff-before">{compactValue(difference.before)}</small>
                          <ArrowRight size={11} />
                          <small className="diff-after">{compactValue(difference.after)}</small>
                        </div>
                      ))}
                    </div>
                  ) : <div className="plan-neutral">No parameter values change; the current SimulationParams will be reused.</div>}
                </section>

                <section className="plan-review-section">
                  <h3><Code2 size={15} /> Command preview</h3>
                  <pre className="command-preview">{selected.command_preview.map((part) => part.includes(' ') ? `"${part}"` : part).join(' ')}</pre>
                  <p className="plan-command-note">The generated temporary patch path and credentials are intentionally not shown.</p>
                </section>

                {selected.error && (
                  <div className="plan-error">
                    <AlertCircle size={14} />
                    <span>
                      <strong>{selected.error_category ? errorCategoryLabels[selected.error_category] ?? selected.error_category : 'Execution failed'}</strong>
                      <small>{selected.error}</small>
                    </span>
                  </div>
                )}
                {selected.status === 'reconciling' && (
                  <div className="plan-progress"><RefreshCw size={15} className="spin" /> Reconciling with Flow360 remote state after restart…</div>
                )}
                {selected.status === 'submitted' && selected.remote_ids && (
                  <section className="plan-review-section">
                    <h3><CheckCircle2 size={15} /> Flow360 remote IDs</h3>
                    <div className="remote-ids">
                      {Object.entries(selected.remote_ids).map(([key, value]) => value ? (
                        <span key={key} className="remote-id-chip"><code>{key}</code><strong>{value}</strong></span>
                      ) : null)}
                    </div>
                  </section>
                )}
                {error && <div className="plan-error"><AlertCircle size={14} />{error}</div>}

                {selected.status === 'draft' && (
                  <div className="approval-card">
                    <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>I reviewed the target, validation, and exact parameter diff.</span></label>
                    <button
                      className="primary"
                      disabled={!reviewed || hasValidationError || loading || !!submittingAction}
                      onClick={() => void approve()}
                    >
                      {loading && submittingAction === 'approve'
                        ? <RefreshCw size={14} className="spin" />
                        : <Check size={14} />} Approve this exact plan
                    </button>
                  </div>
                )}

                {(selected.status === 'approved' || selected.status === 'failed') && (
                  <div className="execution-card">
                    <div><Play size={17} /><span><strong>Remote execution</strong><small>This calls Flow360 and may create billable cloud resources.</small></span></div>
                    <label><input type="checkbox" checked={executeConfirmed} onChange={(event) => setExecuteConfirmed(event.target.checked)} /><span>I understand this will submit the approved plan.</span></label>
                    <button
                      className="execute"
                      disabled={!executeConfirmed || loading || !!submittingAction}
                      onClick={() => void run()}
                    >
                      {loading && submittingAction === 'run'
                        ? <RefreshCw size={14} className="spin" />
                        : <Play size={14} />} Submit to Flow360
                    </button>
                  </div>
                )}

                {selected.status === 'running' && <div className="plan-progress"><RefreshCw size={15} className="spin" /> Submitting the approved plan to Flow360…</div>}
                {selected.status === 'submitted' && (
                  <div className="plan-success"><CheckCircle2 size={17} /><span><strong>Flow360 accepted the plan</strong><small>The Project tree is refreshing for newly created resources.</small></span></div>
                )}
                <div className="plan-timestamps"><Clock3 size={12} /> Last updated {new Date(selected.updated_at).toLocaleString()}</div>
              </div>
            ) : null}
          </main>
        </div>
      </section>
    </div>
  )
}
