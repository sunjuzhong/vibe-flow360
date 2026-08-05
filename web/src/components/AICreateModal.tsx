import { AlertCircle, ArrowRight, CheckCircle2, CircleHelp, Loader2, PauseCircle, Sparkles, WandSparkles, X } from 'lucide-react'
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  api,
  type AICreateClarificationField,
  type AICreateProgress,
  type AICreateResult,
  type FolderNode,
} from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'

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
  if (progress.status === 'needs_input' || progress.status === 'needs_attention') return 'paused'
  return 'active'
}

export function AICreateProgressView({ progress }: { progress: AICreateProgress }) {
  return (
    <section className={`ai-create-progress-panel status-${progress.status}`} aria-live="polite">
      <div className="ai-create-progress-heading">
        <strong>Live backend status</strong>
        <span>{progress.status === 'running' ? 'In progress' : progress.status.replace('_', ' ')}</span>
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
              {stage}
            </li>
          )
        })}
      </ol>
      {progress.detail && <p className="ai-create-progress-detail">{progress.detail}</p>}
      {(progress.project_id || progress.resource_id) && (
        <small className="ai-create-progress-resource">
          {progress.project_id && `Project · ${progress.project_id}`}
          {progress.project_id && progress.resource_id && ' · '}
          {progress.resource_id && `Geometry · ${progress.resource_id}`}
        </small>
      )}
    </section>
  )
}

function newAICreateProgressID() {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `aip-${random}`
}

type TranscriptItem = { role: 'user' | 'agent'; text: string }

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
  return (
    <form className="ai-create-clarification" onSubmit={onSubmit}>
      <div className="ai-create-clarification-heading">
        <span><CircleHelp size={16} /></span>
        <div><strong>Engineering details</strong><small>Clarification round {round}</small></div>
      </div>
      <div className="ai-create-fields">
        {fields.map((field) => (
          <label className={`ai-create-field field-${field.type}`} key={field.id}>
            <span>{field.label}{field.required && <em>*</em>}</span>
            {field.description && <small>{field.description}</small>}
            {field.type === 'select' && (
              <select
                value={String(values[field.id] ?? '')}
                onChange={(event) => onChange(field.id, event.target.value)}
                disabled={busy}
                required={field.required}
              >
                {field.default === undefined && <option value="" disabled>Select an option</option>}
                {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
                <b>{Boolean(values[field.id]) ? 'Yes' : 'No'}</b>
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="ai-create-clarification-footer">
        <span>The Agent will continue from these answers.</span>
        <button type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
          {busy ? 'Continuing…' : 'Continue with answers'}
          {!busy && <ArrowRight size={14} />}
        </button>
      </div>
    </form>
  )
}

export default function AICreateModal({
  folder,
  onClose,
  onCreated,
}: {
  folder: FolderNode | null
  onClose: () => void
  onCreated: (result: AICreateResult) => void
}) {
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<AICreateProgress | null>(null)
  const [sessionId, setSessionId] = useState('')
  const [round, setRound] = useState(0)
  const [fields, setFields] = useState<AICreateClarificationField[]>([])
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
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
    setBusy(true)
    setError('')
    setProgress(null)
    const progressID = newAICreateProgressID()
    let polling = true
    const refreshProgress = async () => {
      try {
        const current = await api.aiCreateProgress(progressID)
        if (polling) setProgress(current)
      } catch {
        // The POST registers the request ID; a 404 before that point is expected.
      }
    }
    const timer = window.setInterval(() => { void refreshProgress() }, 800)
    try {
      const result = await api.aiCreate(intent.trim(), folder.id, sessionId || undefined, submittedAnswers, progressID)
      await refreshProgress()
      if ('status' in result) {
        setSessionId(result.session_id)
        setRound(result.round)
        setFields(result.fields)
        setAnswers(initialAnswers(result.fields))
        setTranscript((current) => [
          ...(current.length ? current : [{ role: 'user' as const, text: intent.trim() }]),
          ...(submittedAnswers ? [{ role: 'user' as const, text: answerSummary }] : []),
          { role: 'agent', text: result.message },
        ])
        return
      }
      onCreated(result)
    } catch (cause) {
      await refreshProgress()
      setError(String(cause).replace('Error: ', ''))
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

  return (
    <div className="ai-create-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWhenIdle() }}>
      <div ref={modalRef} className="ai-create-modal" role="dialog" aria-modal="true" aria-labelledby="ai-create-title" tabIndex={-1}>
        <button className="icon-button ai-create-close" type="button" onClick={closeWhenIdle} disabled={busy} aria-label="Close AI Create dialog"><X size={18} /></button>
        <div className="ai-create-copy">
          <span className="ai-create-icon"><WandSparkles size={19} /></span>
          <div>
            <p className="eyebrow">AI CREATE</p>
            <h2 id="ai-create-title">{sessionId ? 'Let’s define the simulation' : 'Describe the simulation you want'}</h2>
            <p>The Agent builds the goal over multiple steps, asks only for blocking engineering decisions, then creates exact CAD and a reviewable Flow360 setup.</p>
          </div>
        </div>

        {!sessionId && (
          <form onSubmit={submit}>
            <div className={`ai-create-intent-input${intentLimit.overLimit ? ' over-limit' : intentLimit.nearLimit ? ' near-limit' : ''}`}>
              <textarea
                ref={inputRef}
                value={intent}
                onChange={(event) => {
                  setIntent(event.target.value)
                  if (error) setError('')
                }}
                placeholder="Describe the geometry, dimensions, flow conditions, and engineering objective."
                rows={3}
                disabled={busy}
                aria-label="Simulation requirement"
                aria-describedby="ai-create-intent-limit"
                aria-invalid={intentLimit.overLimit}
              />
              <div id="ai-create-intent-limit" className="ai-create-intent-limit" aria-live="polite">
                <span>{intentLimit.characters.toLocaleString()} / {AI_CREATE_INTENT_MAX_CHARACTERS.toLocaleString()} characters</span>
                {intentLimit.overLimit
                  ? <strong>{Math.abs(intentLimit.remaining).toLocaleString()} over the limit — shorten the description to continue.</strong>
                  : intentLimit.nearLimit
                    ? <strong>{intentLimit.remaining.toLocaleString()} characters remaining.</strong>
                    : <small>Include the geometry, flow conditions, and engineering objective.</small>}
              </div>
            </div>
            <div className="ai-create-form-footer">
              <span>{folder ? `Destination · ${folder.name}` : 'Select a destination folder first'}</span>
              <button type="submit" disabled={!folder || !intent.trim() || busy || intentLimit.overLimit}>
                {busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
                {busy ? 'Thinking…' : 'Start with AI'}
                {!busy && <ArrowRight size={14} />}
              </button>
            </div>
          </form>
        )}

        {sessionId && (
          <div className="ai-create-conversation" aria-live="polite">
            {transcript.map((item, index) => (
              <div className={`ai-create-message ${item.role}`} key={`${item.role}-${index}`}>
                <span>{item.role === 'agent' ? <Sparkles size={13} /> : 'You'}</span>
                <p>{item.text}</p>
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

        {!busy && !intent && <p className="ai-create-example">Start with the engineering goal. The Agent will collect missing dimensions and operating decisions step by step.</p>}
        {busy && !progress && <div className="ai-create-progress-starting"><Loader2 className="spin" size={14} />Connecting to the AI Create backend…</div>}
        {progress && (busy || progress.status !== 'completed') && <AICreateProgressView progress={progress} />}
        {error && <div className="ai-create-error" role="alert">{error}</div>}
        <p className="ai-create-safety">The session creates a reviewable configuration only. Paid remote meshing and solving still require approval.</p>
      </div>
    </div>
  )
}
