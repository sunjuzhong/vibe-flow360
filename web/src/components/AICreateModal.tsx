import { AlertCircle, ArrowRight, CheckCircle2, CircleHelp, ExternalLink, Loader2, Minus, PauseCircle, RotateCcw, Sparkles, WandSparkles, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  api,
  type AICreateClarification,
  type AICreateClarificationField,
  type AICreateProgress,
  type AICreateResult,
  type FolderNode,
} from '../api/client'
import { useI18n } from '../i18n'
import { useFocusTrap } from '../lib/useFocusTrap'
import Flow360IdLink from './Flow360IdLink'
import './AICreateSession.css'

export const AI_CREATE_INTENT_MAX_CHARACTERS = 4000
const AI_CREATE_INTENT_WARNING_CHARACTERS = Math.floor(AI_CREATE_INTENT_MAX_CHARACTERS * 0.85)

export function aiCreateIntentCharacterCount(value: string) {
  return Array.from(value).length
}

export function aiCreateIntentLimit(value: string) {
  const characters = aiCreateIntentCharacterCount(value)
  return {
    characters,
    remaining: AI_CREATE_INTENT_MAX_CHARACTERS - characters,
    nearLimit: characters >= AI_CREATE_INTENT_WARNING_CHARACTERS && characters <= AI_CREATE_INTENT_MAX_CHARACTERS,
    overLimit: characters > AI_CREATE_INTENT_MAX_CHARACTERS,
  }
}

export function aiCreateProgressStageState(progress: AICreateProgress, index: number) {
  if (progress.status === 'completed' || index < progress.stage) return 'complete'
  if (index > progress.stage) return 'pending'
  if (progress.status === 'failed') return 'failed'
  if (progress.status === 'recovering' || progress.status === 'needs_input' || progress.status === 'needs_attention') return 'paused'
  return 'active'
}

export function AICreateProgressView({ progress, environment }: { progress: AICreateProgress; environment?: string }) {
  const { t } = useI18n()
  return (
    <section className={`ai-create-progress-panel status-${progress.status}`} aria-live="polite">
      <div className="ai-create-progress-heading">
        <strong>{t('Live backend status')}</strong>
        <span>{t(progress.status === 'running' ? 'In progress' : progress.status.replaceAll('_', ' '))}</span>
      </div>
      <ol className="ai-create-progress">
        {progress.stages.map((stage, index) => {
          const state = aiCreateProgressStageState(progress, index)
          return (
            <li key={stage} className={state}>
              {state === 'complete' && <CheckCircle2 size={14} />}
              {state === 'failed' && <AlertCircle size={14} />}
              {state === 'paused' && <PauseCircle size={14} />}
              {(state === 'active' || state === 'pending') && <span />}
              {t(stage)}
            </li>
          )
        })}
      </ol>
      {progress.detail && <p className="ai-create-progress-detail">{t(progress.detail)}</p>}
      {(progress.project_id || progress.resource_id) && (
        <small className="ai-create-progress-resource">
          {progress.project_id && <>Project · <Flow360IdLink environment={environment} projectId={progress.project_id} /></>}
          {progress.project_id && progress.resource_id && ' · '}
          {progress.project_id && progress.resource_id && <Flow360IdLink environment={environment} projectId={progress.project_id} resourceId={progress.resource_id} resourceType="Geometry">Geometry · {progress.resource_id}</Flow360IdLink>}
        </small>
      )}
    </section>
  )
}

function newAICreateProgressID() {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `aip-${random}`
}

const AI_CREATE_RECONNECT_ATTEMPTS = 900

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

export function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

type TranscriptItem = { role: 'user' | 'agent'; text: string }

export function appendSubmittedAICreateTurn(
  current: TranscriptItem[],
  intent: string,
  answerSummary = '',
): TranscriptItem[] {
  const text = answerSummary.trim() || intent.trim()
  if (!text || current.at(-1)?.role === 'user' && current.at(-1)?.text === text) return current
  return [...current, { role: 'user', text }]
}

function initialAnswers(fields: AICreateClarificationField[]) {
  return Object.fromEntries(fields.map((field) => {
    if (field.default !== undefined) return [field.id, field.default]
    if (field.type === 'boolean') return [field.id, false]
    return [field.id, '']
  }))
}

function serializedAnswers(fields: AICreateClarificationField[], values: Record<string, unknown>) {
  return Object.fromEntries(fields.map((field) => {
    const value = values[field.id]
    if (field.type === 'number' && value !== '') return [field.id, Number(value)]
    return [field.id, value]
  }))
}

export function AICreateClarificationForm({
  fields,
  values,
  busy,
  round,
  onChange,
  onSubmit,
}: {
  fields: AICreateClarificationField[]
  values: Record<string, unknown>
  busy: boolean
  round: number
  onChange: (id: string, value: unknown) => void
  onSubmit: (event: FormEvent) => void
}) {
  const { t } = useI18n()
  return (
    <form className="ai-create-clarification" onSubmit={onSubmit}>
      <div className="ai-create-clarification-heading">
        <span><CircleHelp size={16} /></span>
        <div><strong>{t('Engineering details')}</strong><small>{t(`Clarification round ${round}`)}</small></div>
      </div>
      <div className="ai-create-fields">
        {fields.map((field) => (
          <label className={`ai-create-field field-${field.type}`} key={field.id}>
            <span>{t(field.label)}{field.required && <em>*</em>}</span>
            {field.description && <small>{t(field.description)}</small>}
            {field.type === 'select' && (
              <select
                value={String(values[field.id] ?? '')}
                onChange={(event) => onChange(field.id, event.target.value)}
                disabled={busy}
                required={field.required}
              >
                {field.default === undefined && <option value="" disabled>{t('Select an option')}</option>}
                {field.options?.map((option) => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
              </select>
            )}
            {field.type === 'number' && (
              <span className="ai-create-number-input">
                <input
                  type="number"
                  value={String(values[field.id] ?? '')}
                  min={field.min}
                  max={field.max}
                  step="any"
                  onChange={(event) => onChange(field.id, event.target.value)}
                  disabled={busy}
                  required={field.required}
                />
                {field.unit && <b>{field.unit}</b>}
              </span>
            )}
            {field.type === 'text' && (
              <textarea
                value={String(values[field.id] ?? '')}
                onChange={(event) => onChange(field.id, event.target.value)}
                rows={2}
                disabled={busy}
                required={field.required}
              />
            )}
            {field.type === 'boolean' && (
              <span className="ai-create-boolean-input">
                <input
                  type="checkbox"
                  checked={Boolean(values[field.id])}
                  onChange={(event) => onChange(field.id, event.target.checked)}
                  disabled={busy}
                />
                <b>{t(Boolean(values[field.id]) ? 'Yes' : 'No')}</b>
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="ai-create-clarification-footer">
        <span>{t('The Agent will continue from these answers.')}</span>
        <button type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
          {t(busy ? 'Continuing…' : 'Continue with answers')}
          {!busy && <ArrowRight size={14} />}
        </button>
      </div>
    </form>
  )
}

export default function AICreateModal({
  folder,
  environment,
  onClose,
  onCreated,
}: {
  folder: FolderNode | null
  environment?: string
  onClose: () => void
  onCreated: (result: AICreateResult) => void
}) {
  const { t } = useI18n()
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<AICreateProgress | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [round, setRound] = useState(0)
  const [fields, setFields] = useState<AICreateClarificationField[]>([])
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [minimized, setMinimized] = useState(false)
  const [completedResult, setCompletedResult] = useState<AICreateResult | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const closeWhenIdle = useCallback(() => { if (!busy) onClose() }, [busy, onClose])
  const modalRef = useFocusTrap<HTMLDivElement>(true, closeWhenIdle, 'textarea,input,select,button')

  const answerSummary = useMemo(() => fields.map((field) => {
    const value = answers[field.id]
    const option = field.options?.find((candidate) => candidate.value === value)
    return `${field.label}: ${option?.label ?? String(value)}`
  }).join(' · '), [answers, fields])

  const intentLimit = useMemo(() => aiCreateIntentLimit(intent), [intent])

  const runCreate = async (submittedAnswers?: Record<string, unknown>) => {
    if (!folder || !intent.trim() || busy || intentLimit.overLimit) return
    setTranscript((current) => appendSubmittedAICreateTurn(
      current,
      intent,
      submittedAnswers ? answerSummary : '',
    ))
    setBusy(true)
    setError('')
    setProgress(null)
    let progressID = newAICreateProgressID()
    let polling = true
    const refreshProgress = async () => {
      try {
        const current = await api.aiCreateProgress(progressID)
        if (polling) {
          setProgress(current)
          if (current.session_id) setSessionId(current.session_id)
        }
      } catch {
        // The POST registers the request ID; a 404 before that point is expected.
      }
    }

    const recoverDisconnectedRequest = async (): Promise<AICreateResult | AICreateClarification> => {
      let resumed = false
      for (let attempt = 0; attempt < AI_CREATE_RECONNECT_ATTEMPTS; attempt += 1) {
        await delay(attempt < 10 ? 500 : 1_000)
        try {
          const current = await api.aiCreateProgress(progressID)
          if (polling) {
            setProgress(current)
            if (current.session_id) setSessionId(current.session_id)
          }
          if (current.response) return current.response
          if (current.status === 'recovering' && current.session_id && !resumed) {
            resumed = true
            const resumedProgressID = newAICreateProgressID()
            progressID = resumedProgressID
            const result = await api.aiCreate(intent.trim(), folder.id, current.session_id, undefined, resumedProgressID)
            return result
          }
          if (current.status === 'failed') throw new Error(current.detail || 'AI Create stopped before it could finish.')
        } catch (recoveryCause) {
          const message = errorMessage(recoveryCause)
          if (!/failed to fetch|progress is not available|network/i.test(message)) throw recoveryCause
        }
      }
      throw new Error('The AI Create backend did not reconnect within 15 minutes. The existing Flow360 Project was preserved; reopen AI Create to resume it.')
    }

    const acceptResult = (result: AICreateResult | AICreateClarification) => {
      if ('status' in result) {
        setSessionId(result.session_id)
        setRound(result.round)
        setFields(result.fields)
        setAnswers(initialAnswers(result.fields))
        setTranscript((current) => [
          ...current,
          { role: 'agent', text: result.message },
        ])
        return
      }
      setFields([])
      setCompletedResult(result)
    }
    const timer = window.setInterval(() => { void refreshProgress() }, 800)
    try {
      const result = await api.aiCreate(intent.trim(), folder.id, sessionId || undefined, submittedAnswers, progressID)
      await refreshProgress()
      acceptResult(result)
    } catch (cause) {
      const message = errorMessage(cause)
      if (/failed to fetch|network/i.test(message)) {
        try {
          const recovered = await recoverDisconnectedRequest()
          acceptResult(recovered)
          return
        } catch (recoveryCause) {
          setError(errorMessage(recoveryCause))
        }
      } else {
        await refreshProgress()
        setError(message)
      }
    } finally {
      polling = false
      window.clearInterval(timer)
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void runCreate()
  }

  const submitClarification = (event: FormEvent) => {
    event.preventDefault()
    void runCreate(serializedAnswers(fields, answers))
  }

  if (minimized) {
    const ready = completedResult !== null
    return (
      <aside className={`ai-create-session-dock${ready ? ' ready' : ''}`} aria-live="polite">
        <span className="ai-create-session-dock-icon">{ready ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}</span>
        <span>
          <strong>{t(ready ? 'AI Create is ready' : 'AI Create session')}</strong>
          <small>{t(ready ? 'Project and Draft are ready to review.' : progress?.detail || 'Working in the background…')}</small>
        </span>
        <button type="button" onClick={() => setMinimized(false)}>{t(ready ? 'Review' : 'Open')}</button>
      </aside>
    )
  }

  const hasStarted = Boolean(sessionId || transcript.length > 0 || progress || completedResult)

  return (
    <div className="ai-create-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWhenIdle() }}>
      <div ref={modalRef} className="ai-create-modal" role="dialog" aria-modal="true" aria-labelledby="ai-create-title" tabIndex={-1}>
        <button className="icon-button ai-create-minimize" type="button" onClick={() => setMinimized(true)} aria-label={t('Minimize AI Create session')}><Minus size={18} /></button>
        <button className="icon-button ai-create-close" type="button" onClick={closeWhenIdle} disabled={busy} aria-label={t('Close AI Create dialog')}><X size={18} /></button>
        <div className="ai-create-copy">
          <span className="ai-create-icon"><WandSparkles size={19} /></span>
          <div>
            <p className="eyebrow">{t('AI CREATE')}</p>
            <h2 id="ai-create-title">{t(hasStarted ? 'Let’s define the simulation' : 'Describe the simulation you want')}</h2>
            <p>{t('This session checkpoints exact CAD, the Flow360 Project, validated parameters, and the Draft independently. You can minimize it and continue working.')}</p>
          </div>
        </div>

        {!hasStarted && (
          <form onSubmit={submit}>
            <div className={`ai-create-intent-input${intentLimit.overLimit ? ' over-limit' : intentLimit.nearLimit ? ' near-limit' : ''}`}>
              <textarea
                ref={inputRef}
                value={intent}
                onChange={(event) => {
                  setIntent(event.target.value)
                  if (error) setError('')
                }}
                placeholder={t('Describe the geometry, dimensions, flow conditions, and engineering objective.')}
                rows={3}
                disabled={busy}
                aria-label={t('Simulation requirement')}
                aria-describedby="ai-create-intent-limit"
                aria-invalid={intentLimit.overLimit}
              />
              <div id="ai-create-intent-limit" className="ai-create-intent-limit" aria-live="polite">
                <span>{t(`${intentLimit.characters.toLocaleString()} / ${AI_CREATE_INTENT_MAX_CHARACTERS.toLocaleString()} characters`)}</span>
                {intentLimit.overLimit
                  ? <strong>{t(`${Math.abs(intentLimit.remaining).toLocaleString()} over the limit — shorten the description to continue.`)}</strong>
                  : intentLimit.nearLimit
                    ? <strong>{t(`${intentLimit.remaining.toLocaleString()} characters remaining.`)}</strong>
                    : <small>{t('Include the geometry, flow conditions, and engineering objective.')}</small>}
              </div>
            </div>
            <div className="ai-create-form-footer">
              <span>{t(folder ? `Destination · ${folder.name}` : 'Select a destination folder first')}</span>
              <button type="submit" disabled={!folder || !intent.trim() || busy || intentLimit.overLimit}>
                {busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
                {t(busy ? 'Thinking…' : 'Start with AI')}
                {!busy && <ArrowRight size={14} />}
              </button>
            </div>
          </form>
        )}

        {transcript.length > 0 && (
          <div className="ai-create-conversation" aria-live="polite">
            {transcript.map((item, index) => (
              <div className={`ai-create-message ${item.role}`} key={`${item.role}-${index}`}>
                <span>{item.role === 'agent' ? <Sparkles size={13} /> : t('You')}</span>
                <p>{t(item.text)}</p>
              </div>
            ))}
          </div>
        )}

        {sessionId && fields.length > 0 && (
          <AICreateClarificationForm
            fields={fields}
            values={answers}
            busy={busy}
            round={round}
            onChange={(id, value) => setAnswers((current) => ({ ...current, [id]: value }))}
            onSubmit={submitClarification}
          />
        )}

        {!busy && !intent && <p className="ai-create-example">{t('Start with the engineering goal. The Agent will collect missing dimensions and operating decisions step by step.')}</p>}
        {busy && !progress && <div className="ai-create-progress-starting"><Loader2 className="spin" size={14} />{t('Connecting to the AI Create backend…')}</div>}
        {progress && <AICreateProgressView progress={progress} environment={environment} />}
        {error && <div className="ai-create-error" role="alert">{t(error)}</div>}
        {error && sessionId && !busy && (
          <button className="ai-create-retry" type="button" onClick={() => { void runCreate() }}>
            <RotateCcw size={14} /> {t('Retry current step')}
          </button>
        )}
        {completedResult && (
          <section className="ai-create-session-complete" aria-live="polite">
            <CheckCircle2 size={20} />
            <div>
              <strong>{t('Project and Draft are ready')}</strong>
              <p>{t('The validated checkpoints remain in this session. Opening the Project is now an explicit action.')}</p>
            </div>
            <button type="button" onClick={() => onCreated(completedResult)}>{t('Open Project')} <ExternalLink size={14} /></button>
          </section>
        )}
        <p className="ai-create-safety">{t('The session creates a reviewable configuration only. Paid remote meshing and solving still require approval.')}</p>
      </div>
    </div>
  )
}
