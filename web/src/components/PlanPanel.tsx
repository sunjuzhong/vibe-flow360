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
import { api, type AgentAction, type PlanAssistResponse, type PlanFormSchemaResponse, type ProjectInfo, type ResourceDetail, type ResourceNode, type SimulationPlan } from '../api/client'
import {
  compactParameterValue,
  downstreamStages,
  hasPath,
  mergeStagePatches,
  partitionPatchByStages,
  planCompileBlockers,
  stageDefinitions,
  stageForPath,
  unwrapSimulationParams,
  valueAtPath,
  type SimulationStage,
} from '../lib/planStages'
import { errorMessage } from '../lib/errors'
import { executionTemplate, preflightPrimaryAction, schemaContainsRecommendation, schemaRequiresUserInput } from '../lib/planPresentation'
import { useFocusTrap } from '../lib/useFocusTrap'
import Flow360ConfirmationDialog from './Flow360ConfirmationDialog'
import ExecutionMonitor from './ExecutionMonitor'
import SchemaFormDialog, { SchemaFormFields, serializeValue } from './SchemaForm'

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

function evidenceSummary(value: unknown) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (value && typeof value === 'object') return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`
  return compactValue(value)
}

function statusLabel(status: SimulationPlan['status']) {
  return {
    draft: 'Draft',
    approved: 'Approved',
    running: 'Submitting',
    submitted: 'Submitted',
    failed: 'Failed',
    reconciling: 'Reconciling',
    completed: 'Completed',
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
  initialPlanId,
  onSubmitted,
}: {
  open: boolean
  onClose: () => void
  project: ProjectInfo
  resource: ResourceNode
  detail: ResourceDetail | null
  initialPlanId?: string
  onSubmitted: () => void
}) {
  const options = targetOptions[resource.type] ?? []
  const [plans, setPlans] = useState<SimulationPlan[]>([])
  const [selected, setSelected] = useState<SimulationPlan | null>(null)
  const [showForm, setShowForm] = useState(true)
  const [name, setName] = useState('')
  const [intent, setIntent] = useState('')
  const [target, setTarget] = useState<SimulationPlan['target']>(options[0]?.value ?? 'case')
  const [stageValues, setStageValues] = useState<Record<SimulationStage, Record<string, unknown>>>({
    SurfaceMesh: {},
    VolumeMesh: {},
    Case: {},
  })
  const [advancedPatch, setAdvancedPatch] = useState('{}')
  const [formSchema, setFormSchema] = useState<PlanFormSchemaResponse | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState('')
  const [assistLoading, setAssistLoading] = useState(false)
  const [assistAction, setAssistAction] = useState<AgentAction | null>(null)
  const [assistPreflight, setAssistPreflight] = useState<PlanAssistResponse['preflight'] | null>(null)
  const [assistRepair, setAssistRepair] = useState<{ attempts: number; repaired: boolean } | null>(null)
  const [reviewed, setReviewed] = useState(false)
  const [executeConfirmed, setExecuteConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<'approve' | 'run' | 'compile' | null>(null)
  const [schemaFormOpen, setSchemaFormOpen] = useState(false)
  const [runConfirmationOpen, setRunConfirmationOpen] = useState(false)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useFocusTrap(open, onClose, 'input,textarea,select,button.primary,button.execute,button:not(.icon-button)')

  const loadPlans = useCallback(async () => {
    try {
      const response = await api.plans(project.id, resource.id)
      setPlans(response.plans)
      return response.plans
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
      return []
    }
  }, [project.id, resource.id])

  useEffect(() => {
    if (!open) return
    setSelected(null)
    setShowForm(true)
    setName(`${resource.name} · ${options[0]?.label ?? 'Case'}`)
    setIntent('')
    setTarget(options[0]?.value ?? 'case')
    setStageValues({ SurfaceMesh: {}, VolumeMesh: {}, Case: {} })
    setAdvancedPatch('{}')
    setFormSchema(null)
    setSchemaError('')
    setAssistAction(null)
    setAssistPreflight(null)
    setAssistRepair(null)
    setReviewed(false)
    setExecuteConfirmed(false)
    setSchemaFormOpen(false)
    setRunConfirmationOpen(false)
    setError('')
    void (async () => {
      const loaded = await loadPlans()
      if (!initialPlanId) return
      try {
        const initial = loaded.find((plan) => plan.id === initialPlanId)
          ?? await api.plan(initialPlanId)
        setSelected(initial)
        setPlans((current) => [initial, ...current.filter((plan) => plan.id !== initial.id)])
        setShowForm(false)
        setSchemaFormOpen(Boolean(
          !initial.preflight?.valid
          && Object.keys(initial.preflight?.form_schema.properties ?? {}).length,
        ))
      } catch (cause) {
        setError(String(cause).replace('Error: ', ''))
      }
    })()
  }, [initialPlanId, loadPlans, open, options, resource.name])

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
  const hasStructuredInputs = Boolean(
    selected?.preflight
    && Object.keys(selected.preflight.form_schema.properties ?? {}).length > 0,
  )
  const hasPreflightRecommendation = Boolean(
    selected?.preflight && schemaContainsRecommendation(selected.preflight.form_schema),
  )
  const hasPreflightEngineeringInput = Boolean(
    selected?.preflight && schemaRequiresUserInput(selected.preflight.form_schema),
  )
  const primaryPreflightAction = preflightPrimaryAction(preflightReady, hasStructuredInputs)
  const activeStages = useMemo(
    () => downstreamStages(resource.type, target),
    [resource.type, target],
  )
  const baselineParams = useMemo(
    () => unwrapSimulationParams(detail?.simulation_params),
    [detail?.simulation_params],
  )
  const compileBlockers = useMemo(() => planCompileBlockers({
    schemaLoading,
    hasSchema: Boolean(formSchema),
    name,
  }), [formSchema, name, schemaLoading])

  useEffect(() => {
    if (!open || !showForm || !activeStages.length) return
    let cancelled = false
    setSchemaLoading(true)
    setSchemaError('')
    void api.planFormSchema({
      project_id: project.id,
      project_name: project.name,
      source_id: resource.id,
      source_type: resource.type,
      source_name: resource.name,
      target,
    }).then((response) => {
      if (cancelled) return
      setFormSchema(response)
    }).catch((cause) => {
      if (cancelled) return
      setFormSchema(null)
      setSchemaError(errorMessage(cause))
    }).finally(() => {
      if (!cancelled) setSchemaLoading(false)
    })
    return () => { cancelled = true }
  }, [activeStages, open, project.id, project.name, resource.id, resource.name, resource.type, showForm, target])

  const structuredStagePatches = () => Object.fromEntries(activeStages.map((stage) => {
    const schema = formSchema?.schemas[stage]
    if (!schema) throw new Error(`${stageDefinitions[stage].label} schema is unavailable`)
    const serialized = serializeValue(schema, stageValues[stage], true)
    if (!serialized || Array.isArray(serialized) || typeof serialized !== 'object') {
      throw new Error(`${stageDefinitions[stage].label} form did not produce an object`)
    }
    return [stage, serialized as Record<string, unknown>]
  })) as Partial<Record<SimulationStage, Record<string, unknown>>>

  const createPlan = async (event: FormEvent) => {
    event.preventDefault()
    if (loading || submittingAction) return
    setError('')
    let parsedPatch: Record<string, unknown>
    try {
      const parsedStages = structuredStagePatches()
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

  const fillWithAI = async () => {
    if (assistLoading || schemaLoading || !formSchema || !intent.trim()) return
    setAssistLoading(true)
    setAssistAction(null)
    setAssistPreflight(null)
    setAssistRepair(null)
    setError('')
    try {
      const currentPatch = mergeStagePatches(activeStages, structuredStagePatches(), parsePatch('Advanced', advancedPatch))
      const response = await api.assistPlanForm({
        project_id: project.id,
        project_name: project.name,
        source_id: resource.id,
        source_type: resource.type,
        source_name: resource.name,
        target,
        intent,
        prompt: intent,
        patch: currentPatch,
      })
      setAssistAction(response.action)
      setAssistPreflight(response.preflight ?? null)
      setAssistRepair({ attempts: response.repair_attempts ?? 0, repaired: response.auto_repaired ?? false })
      if (response.proposal) {
        setStageValues(partitionPatchByStages(response.proposal.patch, activeStages))
        if (response.proposal.name.trim()) setName(response.proposal.name)
      }
    } catch (cause) {
      setError(`AI form fill failed: ${errorMessage(cause)}`)
    } finally {
      setAssistLoading(false)
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

  const requestRun = () => {
    if (!selected || !executeConfirmed || loading || submittingAction) return
    if (selected.status !== 'approved' && selected.status !== 'failed') return
    if (selected.submission_id && selected.status !== 'failed') {
      setError('This plan has already been submitted to Flow360 and is protected from double-submit.')
      return
    }
    setRunConfirmationOpen(true)
  }

  const run = async () => {
    if (!selected || loading || submittingAction) return
    setRunConfirmationOpen(false)
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

  const updateExecutionPlan = useCallback((plan: SimulationPlan) => {
    setSelected((current) => {
      if (!current || current.id !== plan.id) return current
      if (current.updated_at === plan.updated_at && current.status === plan.status) return current
      return plan
    })
    setPlans((current) => current.map((item) => (
      item.id === plan.id && (item.updated_at !== plan.updated_at || item.status !== plan.status) ? plan : item
    )))
  }, [])

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
                  <select value={target} onChange={(event) => {
                    setTarget(event.target.value as SimulationPlan['target'])
                    setStageValues({ SurfaceMesh: {}, VolumeMesh: {}, Case: {} })
                    setFormSchema(null)
                    setAssistAction(null)
                    setAssistPreflight(null)
                    setAssistRepair(null)
                  }}>
                    {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <section className="plan-ai-form-fill">
                  <div>
                    <span><Sparkles size={15} /> Optional · ask AI to complete this existing {resource.type.replace('Mesh', ' Mesh')} setup</span>
                    <small>This description is needed only when you want the Agent to fill downstream parameters. Leave it empty to configure the forms yourself and continue with Compile &amp; validate.</small>
                  </div>
                  <div className="plan-ai-form-row">
                    <textarea
                      value={intent}
                      onChange={(event) => setIntent(event.target.value)}
                      placeholder="例如：外流场，Mach 0.8，攻角 3°，先用稳态 RANS，关注升阻力；网格优先控制成本。"
                      aria-label="Optional simulation goal for AI parameter fill"
                    />
                    <button
                      type="button"
                      onClick={() => void fillWithAI()}
                      disabled={assistLoading || schemaLoading || !formSchema || !intent.trim()}
                      title={!intent.trim() ? 'Describe the simulation goal to use AI parameter fill.' : undefined}
                    >
                      {assistLoading ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
                      {assistLoading ? 'Filling…' : 'Fill plan parameters with AI'}
                    </button>
                  </div>
                  {assistAction && (
                    <div className="plan-ai-form-result">
                      <strong>{assistAction.message}</strong>
                      {assistAction.assumptions?.map((item) => <span key={item}>Assumption · {item}</span>)}
                      {assistAction.questions?.map((item) => <span key={item.field}>Needs input · {item.message}</span>)}
                      {assistAction.warnings?.map((item) => <span key={item}>Warning · {item}</span>)}
                      {assistAction.kind === 'request-missing-input' && Boolean(assistAction.questions?.length) && (
                        <em className="needs-input">
                          Add the requested values to the description above and choose Fill parameters with AI again. You can also compile the current values to inspect the complete Flow360 preflight.
                        </em>
                      )}
                      {assistPreflight && (
                        <em className={assistPreflight.valid ? 'ready' : 'needs-input'}>
                          {assistPreflight.valid
                            ? assistRepair?.repaired
                              ? `AI repaired the candidate parameters in ${assistRepair.attempts} validation pass${assistRepair.attempts === 1 ? '' : 'es'}; all values now pass Flow360 preflight.`
                              : 'AI values pass Flow360 preflight.'
                            : `${assistPreflight.issues.filter((issue) => issue.level === 'error').length} Flow360 validation issue${assistPreflight.issues.filter((issue) => issue.level === 'error').length === 1 ? '' : 's'} remain after ${assistRepair?.attempts ?? 0} automatic repair attempt${assistRepair?.attempts === 1 ? '' : 's'}.`}
                        </em>
                      )}
                      {assistPreflight && !assistPreflight.valid && (
                        <ul className="plan-ai-form-issues">
                          {assistPreflight.issues.filter((issue) => issue.level === 'error').map((issue) => (
                            <li key={`${issue.path ?? 'root'}-${issue.code}`}>
                              <code>{issue.path || 'SimulationParams'}</code>
                              <span>{issue.message}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </section>
                <div className="plan-stage-workflow">
                  <div className="plan-stage-workflow-heading">
                    <span>Parameters by execution step</span>
                    <small>{resource.type} → {activeStages.join(' → ')} · generated from Flow360 SimulationParams stage relevance. Existing values remain inherited until changed.</small>
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
                    const stagePatch = stageValues[stage]
                    const schema = formSchema?.schemas[stage]
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
                          <div className="plan-stage-schema-editor">
                            {schemaLoading && !schema && <div className="plan-neutral"><RefreshCw size={13} className="spin" /> Loading the installed Flow360 schema…</div>}
                            {schema && (
                              <SchemaFormFields
                                schema={schema}
                                value={stageValues[stage]}
                                baseline={baselineParams}
                                sparse
                                onChange={(next) => setStageValues((current) => ({
                                  ...current,
                                  [stage]: next && typeof next === 'object' && !Array.isArray(next)
                                    ? next as Record<string, unknown>
                                    : {},
                                }))}
                              />
                            )}
                            {!schemaLoading && !schema && <div className="plan-error"><AlertCircle size={13} />{schemaError || `${definition.label} schema is unavailable.`}</div>}
                            <small>Only explicitly changed fields enter the patch. Every other value remains inherited from the source resource.</small>
                          </div>
                        </details>
                      </section>
                    )
                  })}
                  <details className="plan-stage-editor plan-advanced-editor">
                    <summary><Code2 size={13} /> Expert mode · raw SimulationParams patch</summary>
                    <label>
                      <span>Additional JSON merge patch</span>
                      <textarea className="plan-code-input" value={advancedPatch} onChange={(event) => setAdvancedPatch(event.target.value)} spellCheck={false} />
                      <small>Advanced values override step patches. Private Flow360 attributes remain blocked.</small>
                    </label>
                  </details>
                </div>
                {error && <div className="plan-error"><AlertCircle size={14} />{error}</div>}
                <div className="plan-form-actions">
                  <small className={compileBlockers.length ? 'plan-compile-readiness blocked' : 'plan-compile-readiness ready'} aria-live="polite">
                    {compileBlockers.length
                      ? <><AlertCircle size={13} /> Cannot compile yet · {compileBlockers.join(' ')}</>
                      : <><CheckCircle2 size={13} /> Ready to compile current values for local validation.</>}
                  </small>
                  <button type="button" onClick={onClose} disabled={loading || !!submittingAction}>Cancel</button>
                  <button
                    className="primary"
                    disabled={loading || !!submittingAction || compileBlockers.length > 0}
                    title={compileBlockers.join(' ')}
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

                {selected.evidence && selected.evidence.length > 0 && (
                  <section className="plan-review-section plan-evidence-section">
                    <h3><Sparkles size={15} /> Engineering evidence <span>{selected.evidence.length}</span></h3>
                    <div className="plan-evidence-list">
                      {selected.evidence.map((field) => (
                        <article key={field.key}>
                          <div>
                            <strong>{field.key.replaceAll('_', ' ')}</strong>
                            <span className={`plan-provenance ${field.provenance}`}>{field.provenance}</span>
                          </div>
                          {field.description && <p>{field.description}</p>}
                          <details>
                            <summary>{evidenceSummary(field.value)}</summary>
                            <pre>{JSON.stringify(field.value, null, 2)}</pre>
                          </details>
                        </article>
                      ))}
                    </div>
                    {selected.validation_hints && selected.validation_hints.length > 0 && (
                      <div className="plan-validation-hints">
                        <strong>Validation contract</strong>
                        {selected.validation_hints.map((hint) => <span key={hint}><Check size={11} /> {hint}</span>)}
                      </div>
                    )}
                  </section>
                )}

                <section className="plan-review-section">
                  <h3>
                    <ShieldCheck size={15} /> Flow360 schema preflight
                    <span>{preflightReady ? 'Ready' : hasPreflightRecommendation ? `${preflightErrors.length} to resolve` : `${preflightErrors.length} required`}</span>
                  </h3>
                  {selected.preflight ? (
                    <>
                      <div className={`preflight-summary ${preflightReady ? 'ready' : 'needs-input'}`}>
                        <span>
                          <strong>
                            {preflightReady
                              ? 'SimulationParams are ready for this target'
                              : hasPreflightRecommendation
                                ? 'The Agent found a schema-safe repair'
                                : hasStructuredInputs
                                ? 'The Agent needs an engineering input from you'
                                : 'The Agent found a preflight problem'}
                          </strong>
                          <small>
                            {hasPreflightRecommendation && !preflightReady
                              ? hasPreflightEngineeringInput
                                ? `${preflightErrors.length} preflight issue${preflightErrors.length === 1 ? '' : 's'} · review the repair and remaining inputs`
                                : `${preflightErrors.length} incompatible setting${preflightErrors.length === 1 ? '' : 's'} · no value entry is required`
                              : hasStructuredInputs && !preflightReady
                              ? `${preflightErrors.length} required value${preflightErrors.length === 1 ? '' : 's'} · no safe default will be guessed`
                              : `Flow360 schema ${selected.preflight.validator_version || 'installed'} · plan revision ${selected.revision}`}
                          </small>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            if (primaryPreflightAction === 'validate') {
                              void refreshPreflight()
                              return
                            }
                            if (primaryPreflightAction === 'structured-inputs') {
                              setSchemaFormOpen(true)
                              return
                            }
                            void recoverWithAgent()
                          }}
                          disabled={preflightLoading}
                        >
                          {preflightLoading
                            ? <RefreshCw size={14} className="spin" />
                            : preflightReady
                              ? <RefreshCw size={14} />
                              : hasPreflightRecommendation
                                ? <Sparkles size={14} />
                                : hasStructuredInputs
                                ? <GitPullRequestDraft size={14} />
                                : <Sparkles size={14} />}
                          {preflightReady
                            ? 'Validate again'
                            : hasPreflightRecommendation
                              ? 'Review Agent repair'
                              : hasStructuredInputs
                              ? 'Review required inputs'
                              : 'Open Agent diagnosis'}
                        </button>
                      </div>
                      {!preflightReady && hasStructuredInputs && (
                        <div className="preflight-agent-guidance">
                          <Sparkles size={16} />
                          <span>
                            <strong>{hasPreflightRecommendation ? 'Why the Agent is repairing this' : 'Why the Agent is asking'}</strong>
                            <small>
                              {hasPreflightRecommendation
                                ? hasPreflightEngineeringInput
                                  ? 'Flow360 rejects one setting for the active mesher. The Agent will remove that incompatible field, preserve the remaining requested inputs, and rerun schema validation.'
                                  : 'Flow360 rejects this setting for the active mesher. The Agent will remove only the incompatible field, rerun schema validation, and show the updated parameter diff.'
                                : 'Flow360 requires a value that changes mesh fidelity and cost. Provide only the requested input; the Agent will apply it, rerun schema validation, and return an updated parameter diff before approval.'}
                            </small>
                          </span>
                        </div>
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
                  <h3><Code2 size={15} /> Execution template <span>Not copy-ready</span></h3>
                  <pre className="command-preview">{executionTemplate(selected.command_preview)}</pre>
                  <p className="plan-command-note">
                    This is an audit template, not a command to paste into a shell.
                    On submission Vibe Flow360 writes the reviewed patch to a private temporary file,
                    invokes this Flow360 CLI operation, then deletes the file. Nothing runs from this preview.
                  </p>
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
                      onClick={requestRun}
                    >
                      {loading && submittingAction === 'run'
                        ? <RefreshCw size={14} className="spin" />
                        : <Play size={14} />} Submit to Flow360
                    </button>
                  </div>
                )}

                {['running', 'submitted', 'reconciling', 'completed', 'failed'].includes(selected.status) && (
                  <ExecutionMonitor plan={selected} onPlanUpdate={updateExecutionPlan} />
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
                <Flow360ConfirmationDialog
                  open={runConfirmationOpen}
                  eyebrow="Flow360 · Remote execution"
                  title="Submit the approved plan?"
                  description="This is the final handoff from local review to Flow360. Vibe Flow360 will submit only the validated plan shown behind this dialog."
                  targetLabel="Approved simulation plan"
                  targetName={selected.name}
                  details={[
                    { label: 'Source', value: `${resource.type} · ${resource.name}` },
                    {
                      label: 'Run up to',
                      value: targetOptions[resource.type]?.find((option) => option.value === selected.target)?.label ?? selected.target,
                    },
                  ]}
                  risk="Flow360 may create new mesh or case resources and usage charges may apply. Closing this dialog makes no remote changes."
                  confirmLabel="Submit approved plan"
                  busy={loading && submittingAction === 'run'}
                  onCancel={() => setRunConfirmationOpen(false)}
                  onConfirm={() => void run()}
                />
              </div>
            ) : null}
          </main>
        </div>
      </section>
    </div>
  )
}
