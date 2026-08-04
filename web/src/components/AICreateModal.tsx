import { ArrowRight, CheckCircle2, CircleHelp, Loader2, Sparkles, WandSparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  api,
  type AICreateClarificationField,
  type AICreateResult,
  type FolderNode,
} from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'

const progressStages = [
  'Understanding the engineering goal',
  'Designing a parametric CAD program',
  'Generating and validating exact STEP geometry',
  'Creating the Flow360 Project',
  'Loading complete mesh and Case parameters',
  'Validating all parameters against Flow360',
]

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
  const [progress, setProgress] = useState(0)
  const [sessionId, setSessionId] = useState('')
  const [round, setRound] = useState(0)
  const [fields, setFields] = useState<AICreateClarificationField[]>([])
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const closeWhenIdle = useCallback(() => { if (!busy) onClose() }, [busy, onClose])
  const modalRef = useFocusTrap<HTMLDivElement>(true, closeWhenIdle, 'textarea,input,select,button')

  useEffect(() => {
    if (!busy) return
    const timer = window.setInterval(() => setProgress((current) => Math.min(current + 1, progressStages.length - 1)), 1600)
    return () => window.clearInterval(timer)
  }, [busy])

  const answerSummary = useMemo(() => fields.map((field) => {
    const value = answers[field.id]
    const option = field.options?.find((candidate) => candidate.value === value)
    return `${field.label}: ${option?.label ?? String(value)}`
  }).join(' · '), [answers, fields])

  const runCreate = async (submittedAnswers?: Record<string, unknown>) => {
    if (!folder || !intent.trim() || busy) return
    setBusy(true)
    setError('')
    setProgress(0)
    try {
      const result = await api.aiCreate(intent.trim(), folder.id, sessionId || undefined, submittedAnswers)
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
      setProgress(progressStages.length)
      onCreated(result)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
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
            <textarea ref={inputRef} value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="Describe the geometry, dimensions, flow conditions, and engineering objective." rows={3} disabled={busy} aria-label="Simulation requirement" />
            <div className="ai-create-form-footer">
              <span>{folder ? `Destination · ${folder.name}` : 'Select a destination folder first'}</span>
              <button type="submit" disabled={!folder || !intent.trim() || busy}>
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
        {busy && (
          <ol className="ai-create-progress" aria-live="polite">
            {progressStages.map((stage, index) => (
              <li key={stage} className={index < progress ? 'complete' : index === progress ? 'active' : ''}>
                {index < progress ? <CheckCircle2 size={13} /> : <span />}{stage}
              </li>
            ))}
          </ol>
        )}
        {error && <div className="ai-create-error" role="alert">{error}</div>}
        <p className="ai-create-safety">The session creates a reviewable configuration only. Paid remote meshing and solving still require approval.</p>
      </div>
    </div>
  )
}
