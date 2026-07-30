import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  CircleDot,
  Clock3,
  Code2,
  GitPullRequestDraft,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { api, type ProjectInfo, type ResourceDetail, type ResourceNode, type SimulationPlan } from '../api/client'
import {
  compactParameterValue,
  downstreamStages,
  hasPath,
  mergeStagePatches,
  stageDefinitions,
  stageForPath,
  unwrapSimulationParams,
  valueAtPath,
  type SimulationStage,
} from '../lib/planStages'
import { errorMessage } from '../lib/errors'
import { useFocusTrap } from '../lib/useFocusTrap'
import SchemaFormDialog from './SchemaForm'

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

function parsePatch(label: string, value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} patch must be a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function safePatch(value: string): Record<string, unknown> {
  try {
    return parsePatch('Stage', value)
  } catch {
    return {}
  }
}

function parameterLabel(path: string) {
  return path
    .split('.')
    .slice(-2)
    .join(' · ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function PlanPanel({
  open,
  onClose,
  project,
  resource,
  detail,
  onSubmitted,
}: {
  open: boolean
  onClose: () => void
  project: ProjectInfo
  resource: ResourceNode
  detail: ResourceDetail | null
  onSubmitted: () => void
}) {
  const options = targetOptions[resource.type] ?? []
  const [plans, setPlans] = useState<SimulationPlan[]>([])
  const [selected, setSelected] = useState<SimulationPlan | null>(null)
  const [showForm, setShowForm] = useState(true)
  const [name, setName] = useState('')
  const [intent, setIntent] = useState('')
  const [target, setTarget] = useState<SimulationPlan['target']>(options[0]?.value ?? 'case')
  const [stagePatches, setStagePatches] = useState<Record<SimulationStage, string>>({
    SurfaceMesh: '{}',
    VolumeMesh: '{}',
    Case: '{}',
  })
  const [advancedPatch, setAdvancedPatch] = useState('{}')
  const [reviewed, setReviewed] = useState(false)
  const [executeConfirmed, setExecuteConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<'approve' | 'run' | 'compile' | null>(null)
  const [schemaFormOpen, setSchemaFormOpen] = useState(false)
  const [preflightLoading, setPreflightLoading] = useState(false)
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
    setStagePatches({ SurfaceMesh: '{}', VolumeMesh: '{}', Case: '{}' })
    setAdvancedPatch('{}')
    setReviewed(false)
    setExecuteConfirmed(false)
    setSchemaFormOpen(false)
    setError('')
    void loadPlans()
  }, [loadPlans, open, options, resource.name])

  useEffect(() => {
    const refresh = () => void loadPlans()
    window.addEventListener('vibesim:plans-refresh', refresh)
    return () => window.removeEventListener('vibesim:plans-refresh', refresh)
  }, [loadPlans])

  const hasValidationError = useMemo(
    () => (selected?.validations.some((item) => item.level === 'error') ?? false)
      || (selected?.preflight?.issues.some((item) => item.level === 'error') ?? true),
    [selected],
  )
  const preflightErrors = selected?.preflight?.issues.filter((issue) => issue.level === 'error') ?? []
  const preflightReady = Boolean(
    selected?.preflight?.valid
    && selected.preflight.validated_revision === selected.revision,
  )
  const activeStages = useMemo(
    () => downstreamStages(resource.type, target),
    [resource.type, target],
  )
  const baselineParams = useMemo(
    () => unwrapSimulationParams(detail?.simulation_params),
    [detail?.simulation_params],
  )

  const createPlan = async (event: FormEvent) => {
    event.preventDefault()
    if (loading || submittingAction) return
    setError('')
    let parsedPatch: Record<string, unknown>
    try {
      const parsedStages = Object.fromEntries(activeStages.map((stage) => [
        stage,
        parsePatch(`${stageDefinitions[stage].label} step`, stagePatches[stage]),
      ])) as Partial<Record<SimulationStage, Record<string, unknown>>>
      const parsedAdvanced = parsePatch('Advanced', advancedPatch)
      parsedPatch = mergeStagePatches(activeStages, parsedStages, parsedAdvanced)
      if (!parsedPatch || Array.isArray(parsedPatch) || typeof parsedPatch !== 'object') {
        throw new Error('The combined patch must be a JSON object')
      }
    } catch (cause) {
      setError(`Invalid SimulationParams patch: ${errorMessage(cause)}`)
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
      setSchemaFormOpen(Boolean(
        !plan.preflight?.valid
        && Object.keys(plan.preflight?.form_schema.properties ?? {}).length,
      ))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setSubmittingAction(null)
    }
  }

  const refreshPreflight = async () => {
    if (!selected || preflightLoading) return
    setPreflightLoading(true)
    setError('')
    try {
      const plan = await api.preflightPlan(selected.id)
      setSelected(plan)
      setPlans((current) => current.map((item) => item.id === plan.id ? plan : item))
      setSchemaFormOpen(Boolean(
        !plan.preflight?.valid
        && Object.keys(plan.preflight?.form_schema.properties ?? {}).length,
      ))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setPreflightLoading(false)
    }
  }

  const recoverWithAgent = async () => {
    if (!selected || preflightLoading) return
    setPreflightLoading(true)
    setError('')
    try {
      await api.recoverPlan(selected.id)
      window.dispatchEvent(new CustomEvent('vibesim:open-intervention', {
        detail: { planId: selected.id },
      }))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setPreflightLoading(false)
    }
  }

  const applySchemaInputs = async (values: Record<string, unknown>) => {
    if (!selected || preflightLoading) return
    setPreflightLoading(true)
    setError('')
    try {
      const plan = await api.applyPlanInputs(selected.id, selected.revision, values)
      setSelected(plan)
      setPlans((current) => current.map((item) => item.id === plan.id ? plan : item))
      setReviewed(false)
      setExecuteConfirmed(false)
      setSchemaFormOpen(Boolean(
        !plan.preflight?.valid
        && Object.keys(plan.preflight?.form_schema.properties ?? {}).length,
      ))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setPreflightLoading(false)
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
                onClick={() => {
                  setSelected(plan)
                  setShowForm(false)
                  setReviewed(false)
                  setExecuteConfirmed(false)
                  setSchemaFormOpen(false)
                  setError('')
                }}
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
                <div className="plan-stage-workflow">
                  <div className="plan-stage-workflow-heading">
                    <span>Parameters by execution step</span>
                    <small>Generated from Flow360 SimulationParams stage relevance. Existing values remain inherited until changed.</small>
                  </div>
                  <div className="plan-source-context">
                    <span className="plan-stage-number">0</span>
                    <div>
                      <small>READ-ONLY SOURCE</small>
                      <strong>{resource.type.replace('Mesh', ' Mesh')} · {resource.name}</strong>
                      <em>{Object.keys(baselineParams).length ? 'SimulationParams baseline loaded' : 'Baseline will be loaded during compile'}</em>
                    </div>
                  </div>
                  {activeStages.map((stage, index) => {
                    const definition = stageDefinitions[stage]
                    const stagePatch = safePatch(stagePatches[stage])
                    return (
                      <section className="plan-stage-card" key={stage}>
                        <header>
                          <span className="plan-stage-number">{index + 1}</span>
                          <div>
                            <small>RUN STEP {index + 1}</small>
                            <strong>{definition.label}</strong>
                            <em>{definition.purpose}</em>
                          </div>
                        </header>
                        <div className="plan-stage-groups">
                          {definition.groups.map((group) => {
                            const modifiedPath = group.paths.find((path) => hasPath(stagePatch, path))
                            const inheritedPath = group.paths.find((path) => hasPath(baselineParams, path))
                            const status = modifiedPath ? 'modified' : inheritedPath ? 'inherited' : 'unset'
                            const configuredCount = group.paths.filter((path) =>
                              hasPath(stagePatch, path) || hasPath(baselineParams, path),
                            ).length
                            return (
                              <div key={group.label}>
                                <span>
                                  <strong>{group.label}</strong>
                                  <small>{group.description}</small>
                                </span>
                                <span className={`plan-parameter-state ${status}`}>
                                  {status === 'modified' ? 'Changed' : status === 'inherited' ? 'Inherited' : 'Not set'}
                                </span>
                                <code>{configuredCount}/{group.paths.length} set</code>
                                <div className="plan-stage-field-list">
                                  {group.paths.map((path) => {
                                    const modified = hasPath(stagePatch, path)
                                    const inherited = hasPath(baselineParams, path)
                                    const value = modified
                                      ? valueAtPath(stagePatch, path)
                                      : valueAtPath(baselineParams, path)
                                    return (
                                      <span key={path}>
                                        <code title={path}>{parameterLabel(path)}</code>
                                        <em className={modified ? 'modified' : inherited ? 'inherited' : 'unset'}>
                                          {compactParameterValue(value)}
                                        </em>
                                      </span>
                                    )
                                  })}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <details className="plan-stage-editor">
                          <summary><ChevronDown size={13} /> Change {definition.label} parameters</summary>
                          <label>
                            <span>{definition.label} merge patch</span>
                            <textarea
                              className="plan-code-input"
                              value={stagePatches[stage]}
                              onChange={(event) => setStagePatches((current) => ({
                                ...current,
                                [stage]: event.target.value,
                              }))}
                              placeholder={JSON.stringify(definition.example, null, 2)}
                              spellCheck={false}
                            />
                            <small>Only parameters for this execution step belong here. Flow360 schema preflight remains authoritative.</small>
                          </label>
                        </details>
                      </section>
                    )
                  })}
                  <details className="plan-stage-editor plan-advanced-editor">
                    <summary><Code2 size={13} /> Advanced SimulationParams patch</summary>
                    <label>
                      <span>Additional JSON merge patch</span>
                      <textarea className="plan-code-input" value={advancedPatch} onChange={(event) => setAdvancedPatch(event.target.value)} spellCheck={false} />
                      <small>Advanced values override step patches. Private Flow360 attributes remain blocked.</small>
                    </label>
                  </details>
                </div>
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

                <div className="plan-route plan-stage-route">
                  <span><small>Read-only source</small><strong>{selected.source_type}</strong><em>{selected.source_name}</em></span>
                  {downstreamStages(selected.source_type, selected.target).map((stage) => {
                    const issueCount = selected.preflight?.issues.filter((issue) =>
                      issue.stages?.includes(stage) || (issue.path && stageForPath(issue.path) === stage),
                    ).length ?? 0
                    const changeCount = selected.differences.filter((difference) => stageForPath(difference.path) === stage).length
                    return (
                      <div className="plan-route-step" key={stage}>
                        <ArrowRight size={16} />
                        <span>
                          <small>Run step</small>
                          <strong>{stageDefinitions[stage].label}</strong>
                          <em>{issueCount ? `${issueCount} required` : `${changeCount} change${changeCount === 1 ? '' : 's'}`}</em>
                        </span>
                      </div>
                    )
                  })}
                </div>

                <section className="plan-review-section">
                  <h3>
                    <ShieldCheck size={15} /> Flow360 schema preflight
                    <span>{preflightReady ? 'Ready' : `${preflightErrors.length} required`}</span>
                  </h3>
                  {selected.preflight ? (
                    <>
                      <div className={`preflight-summary ${preflightReady ? 'ready' : 'needs-input'}`}>
                        <span>
                          <strong>
                            {preflightReady
                              ? 'SimulationParams are ready for this target'
                              : 'Additional simulation inputs are required'}
                          </strong>
                          <small>
                            Flow360 schema {selected.preflight.validator_version || 'installed'}
                            {' · '}plan revision {selected.revision}
                          </small>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (preflightReady) {
                              void refreshPreflight()
                              return
                            }
                            void recoverWithAgent()
                          }}
                          disabled={preflightLoading}
                        >
                          {preflightLoading
                            ? <RefreshCw size={14} className="spin" />
                            : preflightReady ? <RefreshCw size={14} /> : <Sparkles size={14} />}
                          {preflightReady ? 'Validate again' : 'Let Agent resolve'}
                        </button>
                      </div>
                      {!preflightReady && Object.keys(selected.preflight.form_schema.properties ?? {}).length > 0 && (
                        <button
                          type="button"
                          className="preflight-manual-input"
                          onClick={() => setSchemaFormOpen(true)}
                        >
                          <GitPullRequestDraft size={13} /> Enter structured inputs manually
                        </button>
                      )}
                      {selected.preflight.issues.length > 0 && (
                        <div className="preflight-issues">
                          {selected.preflight.issues.map((issue, index) => (
                            <div className={`validation-${issue.level}`} key={`${issue.path}-${index}`}>
                              {issue.level === 'warning'
                                ? <TriangleAlert size={14} />
                                : <AlertCircle size={14} />}
                              <span>
                                <strong>{issue.stages?.join(' → ') || issue.code}</strong>
                                <code>{issue.path || 'schema'}</code>
                                <small>{issue.message}</small>
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="plan-neutral preflight-not-run">
                      <span>Preflight has not run for this plan.</span>
                      <button type="button" onClick={() => void refreshPreflight()} disabled={preflightLoading}>
                        Run preflight
                      </button>
                    </div>
                  )}
                </section>

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
                    {selected.status === 'failed' && (
                      <button
                        className="agent-recovery-btn"
                        onClick={() => window.dispatchEvent(new CustomEvent('vibesim:open-intervention', {
                          detail: { planId: selected.id, error: selected.error, errorCategory: selected.error_category }
                        }))}
                      >
                        <Sparkles size={13} /> Agent Recovery
                      </button>
                    )}
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
                      disabled={!reviewed || !preflightReady || hasValidationError || loading || !!submittingAction}
                      onClick={() => void approve()}
                    >
                      {loading && submittingAction === 'approve'
                        ? <RefreshCw size={14} className="spin" />
                        : <Check size={14} />} Approve this exact plan
                    </button>
                  </div>
                )}

                {(selected.status === 'approved' || selected.status === 'failed') && preflightReady && (
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
                {schemaFormOpen && selected.preflight && (
                  <SchemaFormDialog
                    schema={selected.preflight.form_schema}
                    issues={preflightErrors}
                    submitting={preflightLoading}
                    onCancel={() => setSchemaFormOpen(false)}
                    onSubmit={(values) => void applySchemaInputs(values)}
                  />
                )}
              </div>
            ) : null}
          </main>
        </div>
      </section>
    </div>
  )
}
