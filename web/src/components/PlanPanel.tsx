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
  applyProposalToStagePatches,
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
import { useI18n } from '../i18n'
import { executionTemplate } from '../lib/planPresentation'
import { useFocusTrap } from '../lib/useFocusTrap'
import Flow360ConfirmationDialog from './Flow360ConfirmationDialog'
import ExecutionMonitor from './ExecutionMonitor'
import { SchemaFormFields, serializeValue } from './SchemaForm'
import AgentClarificationDialog, { type ClarificationAnswers } from './AgentClarificationDialog'
import PlanParameterReview, { type PlanRepairCandidate } from './PlanParameterReview'

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

export type PlanEntryMode = 'review' | 'run'

export function planEntryPresentation(mode: PlanEntryMode) {
  return mode === 'run'
    ? { title: 'Review & Run', subtitle: 'Validate complete parameters before Flow360', dialogLabel: 'Draft review and execution' }
    : { title: 'Review proposal', subtitle: 'Review proposed parameters without changing the Flow360 Draft', dialogLabel: 'Proposed parameter review' }
}

export function shouldLoadExistingReview(draftId?: string, initialPlanId?: string) {
  return Boolean(draftId || initialPlanId)
}

export function reviewMatchesDraft(currentDraftId?: string, reviewDraftId?: string) {
  return !currentDraftId || currentDraftId === reviewDraftId
}

export default function PlanPanel({
  open,
  onClose,
  project,
  resource,
  detail,
  draftId,
  draftName,
  initialPlanId,
  entryMode = 'run',
  onEnterRun,
  onSubmitted,
}: {
  open: boolean
  onClose: () => void
  project: ProjectInfo
  resource: ResourceNode
  detail: ResourceDetail | null
  draftId?: string
  draftName?: string
  initialPlanId?: string
  entryMode?: PlanEntryMode
  onEnterRun?: () => void
  onSubmitted: () => void
}) {
  const { t } = useI18n()
  const options = targetOptions[resource.type] ?? []
  const [plans, setPlans] = useState<SimulationPlan[]>([])
  const [selected, setSelected] = useState<SimulationPlan | null>(null)
  const [showForm, setShowForm] = useState(true)
  const [reviewLoading, setReviewLoading] = useState(false)
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
  const [clarificationAction, setClarificationAction] = useState<AgentAction | null>(null)
  const [confirmedInputs, setConfirmedInputs] = useState<ClarificationAnswers>({})
  const [assistStalled, setAssistStalled] = useState(false)
  const [assistFailure, setAssistFailure] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [executeConfirmed, setExecuteConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<'approve' | 'run' | 'compile' | null>(null)
  const [runConfirmationOpen, setRunConfirmationOpen] = useState(false)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [aiRepairLoading, setAIRepairLoading] = useState(false)
  const [repairCandidate, setRepairCandidate] = useState<PlanRepairCandidate | null>(null)
  const [error, setError] = useState('')
  const panelRef = useFocusTrap(open, onClose, 'input,textarea,select,button.primary,button.execute,button:not(.icon-button)')

  const loadPlans = useCallback(async () => {
    try {
      const response = await api.plans(project.id, resource.id)
      const matching = draftId
        ? response.plans.filter((plan) => plan.remote_ids?.draft_id === draftId)
        : response.plans
      setPlans(matching)
      return matching
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
      return []
    }
  }, [draftId, project.id, resource.id])

  useEffect(() => {
    if (!open) return
    const openingExistingReview = shouldLoadExistingReview(draftId, initialPlanId)
    setSelected(null)
    setShowForm(!openingExistingReview)
    setReviewLoading(openingExistingReview)
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
    setClarificationAction(null)
    setConfirmedInputs({})
    setAssistStalled(false)
    setAssistFailure('')
    setRepairCandidate(null)
    setReviewed(false)
    setExecuteConfirmed(false)
    setRunConfirmationOpen(false)
    setError('')
    void (async () => {
      try {
        const loaded = await loadPlans()
        if (!initialPlanId) {
          if (draftId) {
            try {
              const reviewPlan = await api.createPlan({
                project_id: project.id,
                project_name: project.name,
                source_id: resource.id,
                source_type: resource.type,
                source_name: resource.name,
                target: 'case',
                name: `${resource.name} · Case`,
                intent: 'Validate and review the current Draft parameters.',
                patch: {},
                draft_id: draftId,
              })
              setSelected(reviewPlan)
              setPlans([reviewPlan, ...loaded.filter((plan) => plan.id !== reviewPlan.id)])
              setShowForm(false)
            } catch (cause) {
              setError(errorMessage(cause))
            }
          }
          return
        }
        try {
          const initial = loaded.find((plan) => plan.id === initialPlanId)
            ?? await api.plan(initialPlanId)
          setSelected(initial)
          setPlans((current) => [initial, ...current.filter((plan) => plan.id !== initial.id)])
          setShowForm(false)
        } catch (cause) {
          setError(String(cause).replace('Error: ', ''))
        }
      } finally {
        setReviewLoading(false)
      }
    })()
  }, [draftId, initialPlanId, loadPlans, open, options, resource.name])

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
  const selectedDraftId = selected?.remote_ids?.draft_id
  const selectedMatchesDraft = reviewMatchesDraft(draftId, selectedDraftId)
  const preflightReady = Boolean(
    selected?.preflight?.valid
    && selected.preflight.validated_revision === selected.revision
    && selectedMatchesDraft
  )
  const runMode = entryMode === 'run'
  const entryPresentation = planEntryPresentation(entryMode)
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
      draft_id: draftId,
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
  }, [activeStages, draftId, open, project.id, project.name, resource.id, resource.name, resource.type, showForm, target])

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
        draft_id: draftId,
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

  const fillWithAI = async (
    promptOverride?: string,
    confirmedOverride: ClarificationAnswers = confirmedInputs,
  ) => {
    if (assistLoading || schemaLoading || !formSchema || !intent.trim()) return
    setAssistLoading(true)
    setAssistAction(null)
    setAssistPreflight(null)
    setAssistRepair(null)
    setAssistStalled(false)
    setAssistFailure('')
    setError('')
    try {
      const currentPatch = mergeStagePatches(activeStages, structuredStagePatches(), parsePatch('Advanced', advancedPatch))
      const response = await api.assistPlanForm({
        project_id: project.id,
        project_name: project.name,
        source_id: resource.id,
        source_type: resource.type,
        source_name: resource.name,
        draft_id: draftId,
        target,
        intent,
        prompt: promptOverride ?? intent,
        patch: currentPatch,
        confirmed_inputs: confirmedOverride,
        autonomous: true,
      })
      setAssistAction(response.action)
      const pendingQuestions = response.action.questions?.filter(
        (question) => !Object.prototype.hasOwnProperty.call(confirmedOverride, question.field),
      ) ?? []
      const repeatedQuestions = response.action.kind === 'request-missing-input'
        && Boolean(response.action.questions?.length)
        && pendingQuestions.length === 0
      setAssistStalled(repeatedQuestions)
      setClarificationAction(
        response.action.kind === 'request-missing-input' && pendingQuestions.length
          ? { ...response.action, questions: pendingQuestions }
          : null,
      )
      setAssistPreflight(response.preflight ?? null)
      setAssistRepair({ attempts: response.repair_attempts ?? 0, repaired: response.auto_repaired ?? false })
      if (response.proposal) {
        setStageValues((current) => applyProposalToStagePatches(activeStages, current, response.proposal!.patch))
        if (response.proposal.name.trim()) setName(response.proposal.name)
      }
    } catch (cause) {
      setAssistFailure(errorMessage(cause))
    } finally {
      setAssistLoading(false)
    }
  }

  const continueAgentRepair = () => {
    const issues = assistPreflight?.issues
      .filter((issue) => issue.level === 'error')
      .map((issue) => `${issue.path || 'SimulationParams'}: ${issue.message}`)
      .join('\n')
    void fillWithAI([
      intent,
      'Repair the current candidate autonomously. Return a concrete schema-valid patch; do not ask me to reconfirm values already supplied.',
      issues ? `Current Flow360 validation errors:\n${issues}` : '',
    ].filter(Boolean).join('\n\n'))
  }

  const editAffectedParameters = () => {
    const firstIssue = assistPreflight?.issues.find((issue) => issue.level === 'error')
    const inferred = firstIssue?.path ? stageForPath(firstIssue.path) : activeStages[activeStages.length - 1]
    const stage = activeStages.includes(inferred) ? inferred : activeStages[activeStages.length - 1]
    const editor = stage ? document.getElementById(`plan-stage-editor-${stage}`) : null
    if (editor instanceof HTMLDetailsElement) {
      editor.open = true
      editor.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      setRepairCandidate(null)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setPreflightLoading(false)
    }
  }

  const generateReviewedRepair = async () => {
    if (!selected || aiRepairLoading) return
    setAIRepairLoading(true)
    setRepairCandidate(null)
    setError('')
    try {
      const issueText = selected.preflight?.issues
        .filter((issue) => issue.level === 'error')
        .map((issue) => `${issue.path || 'SimulationParams'}: ${issue.message}`)
        .join('\n')
      const response = await api.assistPlanForm({
        project_id: project.id,
        project_name: project.name,
        source_id: resource.id,
        source_type: resource.type,
        source_name: resource.name,
        draft_id: selected.remote_ids?.draft_id,
        target: selected.target,
        intent: selected.intent,
        prompt: [
          'Repair every current Flow360 preflight error autonomously. Preserve valid engineering values and return only the smallest schema-safe SimulationParams patch.',
          issueText ? `Current validation errors:\n${issueText}` : '',
        ].filter(Boolean).join('\n\n'),
        patch: selected.patch,
        autonomous: true,
      })
      if (!response.proposal) throw new Error(response.action.message || 'AI did not return a parameter repair.')
      setRepairCandidate({
        action: response.action,
        proposal: response.proposal,
        preflight: response.preflight,
        attempts: response.repair_attempts ?? 0,
        autoRepaired: response.auto_repaired ?? false,
      })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setAIRepairLoading(false)
    }
  }

  const applyReviewedRepair = async () => {
    if (!selected || !repairCandidate || preflightLoading) return
    setPreflightLoading(true)
    setError('')
    try {
      const plan = await api.updatePlanParameters(selected.id, selected.revision, repairCandidate.proposal.patch)
      setSelected(plan)
      setPlans((current) => current.map((item) => item.id === plan.id ? plan : item))
      setRepairCandidate(null)
      setReviewed(false)
      setExecuteConfirmed(false)
      if (!plan.preflight?.valid) {
        setError(`Repair applied, but ${plan.preflight?.issues.filter((issue) => issue.level === 'error').length ?? 0} validation error(s) remain. Run AI Repair again for the new revision.`)
      }
    } catch (cause) {
      setError(errorMessage(cause))
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
    if (!selectedMatchesDraft) {
      setError(t('This review is not bound to the current Draft. Close it and run the current Draft again.'))
      return
    }
    if (selected.status !== 'approved' && selected.status !== 'failed') return
    if (selected.submission_id && selected.status !== 'failed') {
      setError('This Draft revision has already been submitted to Flow360 and is protected from double-submit.')
      return
    }
    setRunConfirmationOpen(true)
  }

  const run = async () => {
    if (!selected || loading || submittingAction) return
    if (!selectedMatchesDraft) {
      setError(t('This review is not bound to the current Draft. Close it and run the current Draft again.'))
      return
    }
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
        aria-label={entryPresentation.dialogLabel}
      >
        <header className="plan-header">
          <span className="plan-header-icon"><GitPullRequestDraft size={18} /></span>
          <div>
            <strong>{entryPresentation.title}</strong>
            <span>{entryPresentation.subtitle}</span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={runMode ? 'Close Review and Run' : 'Close proposed parameter review'}><X size={18} /></button>
        </header>

        <div className={`plan-layout${draftId ? ' current-draft' : ''}`}>
          {!draftId && <aside className="plan-history">
            <button className={showForm ? 'active' : ''} onClick={() => { setShowForm(true); setSelected(null) }}>
              <span><CircleDot size={13} /> New revision</span><ArrowRight size={12} />
            </button>
            <p>REVIEW HISTORY</p>
            {plans.map((plan) => (
              <button
                className={!showForm && selected?.id === plan.id ? 'active' : ''}
                key={plan.id}
                onClick={() => {
                  setSelected(plan)
                  setShowForm(false)
                  setReviewed(false)
                  setExecuteConfirmed(false)
                  setRepairCandidate(null)
                  setError('')
                }}
              >
                <span><strong>{plan.name}</strong><small>{statusLabel(plan.status)} · {new Date(plan.created_at).toLocaleString()}</small></span>
                <span className={`plan-status-dot status-${plan.status}`} />
              </button>
            ))}
            {!plans.length && <div className="plan-history-empty">No reviewed Draft revisions yet.</div>}
          </aside>}

          <main className="plan-main">
            {draftId && <div className="plan-current-draft" aria-label={t('Current Draft')}>
              <span>{t('Current Draft')}</span>
              <strong>{draftName || draftId}</strong>
              <code>{draftId}</code>
            </div>}
            {reviewLoading ? (
              <div className="plan-review-loading" role="status" aria-live="polite">
                <RefreshCw size={18} className="spin" />
                <div><strong>Loading Draft validation…</strong><span>Preparing the current revision, parameter errors, and repair state.</span></div>
                <i /><i /><i />
              </div>
            ) : showForm ? (
              <form className="plan-form" onSubmit={createPlan}>
                <div className="plan-step-heading"><span>1</span><div><strong>Configure this Draft</strong><small>Review and validation do not start meshing or a solver run.</small></div></div>
                <label>
                  <span>Draft / run name</span>
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
                    setClarificationAction(null)
                    setConfirmedInputs({})
                    setAssistStalled(false)
                    setAssistFailure('')
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
                      {assistLoading ? 'Filling…' : 'Fill Draft parameters with AI'}
                    </button>
                  </div>
                  {assistLoading && (
                    <small role="status">Codex is checking the active multi-stage Flow360 schemas. Complex Drafts can take a few minutes.</small>
                  )}
                  {assistAction && (
                    <div className="plan-ai-form-result">
                      <strong>{assistAction.message}</strong>
                      {assistAction.assumptions?.map((item) => <span key={item}>Assumption · {item}</span>)}
                      {assistAction.questions
                        ?.filter((item) => !Object.prototype.hasOwnProperty.call(confirmedInputs, item.field))
                        .map((item) => <span key={item.field}>Needs input · {item.message}</span>)}
                      {assistAction.warnings?.map((item) => <span key={item}>Warning · {item}</span>)}
                      {assistAction.kind === 'request-missing-input'
                        && Boolean(assistAction.questions?.some((item) => !Object.prototype.hasOwnProperty.call(confirmedInputs, item.field)))
                        && !assistStalled && (
                        <button type="button" onClick={() => setClarificationAction({
                          ...assistAction,
                          questions: assistAction.questions?.filter((item) => !Object.prototype.hasOwnProperty.call(confirmedInputs, item.field)),
                        })}>
                          Answer engineering questions
                        </button>
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
                      {(assistStalled || (assistPreflight && !assistPreflight.valid)) && (
                        <div className="plan-ai-resolution-actions">
                          <span>{assistStalled
                            ? 'The Agent repeated a question you already answered. Current parameter edits are preserved.'
                            : 'The generated changes are already shown in the parameter forms. Choose how to resolve the remaining validation errors.'}</span>
                          <div>
                            <button type="button" onClick={continueAgentRepair} disabled={assistLoading}>Continue with AI repair</button>
                            <button type="button" onClick={editAffectedParameters}>Edit dynamic form</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {assistFailure && (
                    <div className="plan-ai-form-result">
                      <strong>AI could not finish this pass</strong>
                      <span>{assistFailure}</span>
                      <div className="plan-ai-resolution-actions">
                        <span>Your current parameter edits were not cleared.</span>
                        <div>
                          <button type="button" onClick={continueAgentRepair} disabled={assistLoading}>Retry with AI</button>
                          <button type="button" onClick={editAffectedParameters}>Edit dynamic form</button>
                        </div>
                      </div>
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
                        <details className="plan-stage-editor" id={`plan-stage-editor-${stage}`}>
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
                {!draftId && <button className="plan-back" onClick={() => setShowForm(true)}><ChevronLeft size={13} /> New revision</button>}
                <div className="plan-review-title">
                  <div><p className="eyebrow">DRAFT REVIEW {selected.id}</p><h2>{draftName || selected.name}</h2><p>{runMode ? selected.intent : 'Review and improve this Draft’s parameter changes. Nothing will run from this panel.'}</p></div>
                  <span className={`plan-status status-${selected.status}`}>{statusLabel(selected.status)}</span>
                </div>

                <div className={`plan-review-preflight-bar ${preflightReady ? 'ready' : 'error'}`}>
                  {preflightReady ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                  <span>
                    <strong>{preflightReady ? (runMode ? 'Ready to run' : 'Parameters valid') : `${preflightErrors.length} parameter error${preflightErrors.length === 1 ? '' : 's'}`}</strong>
                    <small>{selected.source_type} → {targetOptions[resource.type]?.find((option) => option.value === selected.target)?.label ?? selected.target} · revision {selected.revision}</small>
                  </span>
                  <button type="button" onClick={() => void refreshPreflight()} disabled={preflightLoading}>
                    {preflightLoading ? <RefreshCw size={13} className="spin" /> : <RefreshCw size={13} />} Validate again
                  </button>
                </div>

                <PlanParameterReview
                  plan={selected}
                  currentParameters={detail?.simulation_params}
                  candidate={repairCandidate}
                  generating={aiRepairLoading}
                  applying={preflightLoading}
                  onGenerate={() => void generateReviewedRepair()}
                  onApply={() => void applyReviewedRepair()}
                  onDiscard={() => setRepairCandidate(null)}
                />

                <details className="plan-technical-details">
                  <summary><Code2 size={14} /> {runMode ? 'Run details' : 'Change details'} <span>{runMode ? 'validation, changes & execution template' : 'validation and exact parameter diff'}</span><ChevronDown size={14} /></summary>
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

                {runMode && <section className="plan-review-section">
                  <h3><Code2 size={15} /> Execution template <span>Not copy-ready</span></h3>
                  <pre className="command-preview">{executionTemplate(selected.command_preview)}</pre>
                  <p className="plan-command-note">
                    This is an audit template, not a command to paste into a shell.
                    On submission Vibe Flow360 writes the reviewed patch to a private temporary file,
                    invokes this Flow360 CLI operation, then deletes the file. Nothing runs from this preview.
                  </p>
                </section>}
                </details>

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
                        : <Check size={14} />} {runMode ? 'Approve this Draft revision' : 'Approve this proposal'}
                    </button>
                  </div>
                )}

                {!runMode && selected.status === 'approved' && preflightReady && (
                  <div className="draft-review-complete">
                    <CheckCircle2 size={17} />
                    <span><strong>Proposal approved</strong><small>The proposal has not changed the Flow360 Draft or started a run.</small></span>
                    {onEnterRun && <button type="button" onClick={onEnterRun}><Play size={13} /> Continue to Review &amp; Run</button>}
                  </div>
                )}

                {runMode && (selected.status === 'approved' || selected.status === 'failed') && preflightReady && (
                  <div className="execution-card">
                    <div><Play size={17} /><span><strong>Remote execution</strong><small>This calls Flow360 and may create billable cloud resources.</small></span></div>
                    <label><input type="checkbox" checked={executeConfirmed} onChange={(event) => setExecuteConfirmed(event.target.checked)} /><span>I understand this will run the approved Draft revision.</span></label>
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
                {runMode && <Flow360ConfirmationDialog
                  open={runConfirmationOpen}
                  eyebrow="Flow360 · Remote execution"
                  title="Run the approved Draft?"
                  description="This is the final handoff from review to Flow360. Vibe Flow360 will run only the validated Draft revision shown behind this dialog. The Draft remains available after the run."
                  targetLabel="Approved Draft revision"
                  targetName={draftName || selected.name}
                  details={[
                    { label: t('Draft ID'), value: draftId || selectedDraftId || '—' },
                    { label: 'Source', value: `${resource.type} · ${resource.name}` },
                    {
                      label: 'Run up to',
                      value: targetOptions[resource.type]?.find((option) => option.value === selected.target)?.label ?? selected.target,
                    },
                  ]}
                  risk="Flow360 may create new mesh or case resources and usage charges may apply. Closing this dialog makes no remote changes."
                  confirmLabel="Run approved Draft"
                  busy={loading && submittingAction === 'run'}
                  onCancel={() => setRunConfirmationOpen(false)}
                  onConfirm={() => void run()}
                />}
              </div>
            ) : <div className="plan-review-load-error" role="alert"><AlertCircle size={17} /><span><strong>Draft review could not be loaded.</strong><small>{error || 'Close this panel and try again.'}</small></span></div>}
          </main>
        </div>
        <AgentClarificationDialog
          open={Boolean(clarificationAction?.questions?.length)}
          message={clarificationAction?.message}
          questions={clarificationAction?.questions ?? []}
          busy={assistLoading}
          onClose={() => setClarificationAction(null)}
          onSubmit={(answers: ClarificationAnswers) => {
            const nextConfirmed = { ...confirmedInputs, ...answers }
            setConfirmedInputs(nextConfirmed)
            setClarificationAction(null)
            void fillWithAI(intent, nextConfirmed)
          }}
        />
      </section>
    </div>
  )
}
