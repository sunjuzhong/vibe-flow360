import { ArrowRight, CheckCircle2, Loader2, Minus, RotateCcw, Sparkles, WandSparkles, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { api, type AICreateClarificationField, type AICreateProgress, type STEPAIJob } from '../api/client'
import { useI18n } from '../i18n'
import { useFocusTrap } from '../lib/useFocusTrap'
import {
  AICreateClarificationForm,
  AICreateProgressView,
  aiCreateIntentLimit,
  appendSubmittedAICreateTurn,
  errorMessage,
} from './AICreateModal'

type TranscriptItem = { role: 'user' | 'agent'; text: string }

function initialAnswers(fields: AICreateClarificationField[]) {
  return Object.fromEntries(fields.map((field) => [field.id, field.default ?? (field.type === 'boolean' ? false : '')]))
}

function serializedAnswers(fields: AICreateClarificationField[], values: Record<string, unknown>) {
  return Object.fromEntries(fields.map((field) => {
    const value = values[field.id]
    return [field.id, field.type === 'number' && value !== '' ? Number(value) : value]
  }))
}

export function stepJobProgress(job: STEPAIJob): AICreateProgress {
  const stages = ['Understanding geometry', 'Designing exact CAD', 'Generating and validating STEP', 'Saving version']
  const stageByName: Record<string, number> = { queued: 0, designing: 1, generating: 2, storing: 3, completed: 3, failed: Math.min(3, Math.floor(job.progress / 25)), needs_input: 0, cancelled: Math.min(3, Math.floor(job.progress / 25)) }
  return {
    request_id: job.id,
    status: job.status === 'cancelled' ? 'failed' : job.status === 'queued' ? 'running' : job.status,
    stage: stageByName[job.stage] ?? stageByName[job.status] ?? 0,
    stages,
    detail: job.detail || job.error,
    started_at: job.created_at,
    updated_at: job.updated_at,
  }
}

export default function STEPDesignModal({ mode, assetName, assetId, parentVersionId, folderId, folderName, onClose, onCompleted }: {
  mode: 'new' | 'revise' | 'reconstruct'
  assetName?: string
  assetId?: string
  parentVersionId?: string
  folderId?: string
  folderName?: string
  onClose: () => void
  onCompleted: (job: STEPAIJob) => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [intent, setIntent] = useState('')
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<STEPAIJob | null>(null)
  const [error, setError] = useState('')
  const [fields, setFields] = useState<AICreateClarificationField[]>([])
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [transcript, setTranscript] = useState<TranscriptItem[]>([])
  const [minimized, setMinimized] = useState(false)
  const limit = useMemo(() => aiCreateIntentLimit(intent), [intent])
  const progress = job ? stepJobProgress(job) : null
  const active = job && ['queued', 'running', 'recovering'].includes(job.status)
  const completed = job?.status === 'completed'
  const closeWhenIdle = useCallback(() => { if (!busy && !active) onClose() }, [active, busy, onClose])
  const modalRef = useFocusTrap<HTMLDivElement>(!minimized, closeWhenIdle, 'textarea,input,select,button')

  const start = async (continuation?: Record<string, unknown>) => {
    if (!intent.trim() || busy || limit.overLimit) return
    const answerSummary = continuation ? fields.map((field) => `${field.label}: ${String(continuation[field.id])}`).join(' · ') : ''
    setTranscript((current) => appendSubmittedAICreateTurn(current, intent, answerSummary))
    setBusy(true); setError(''); setFields([])
    try {
      const prompt = continuation
        ? `${intent.trim()}\n\nAdditional engineering details:\n${Object.entries(continuation).map(([key, value]) => `${key}: ${String(value)}`).join('\n')}`
        : intent.trim()
      setJob(await api.aiDesignSTEPAsset({ prompt, name: mode === 'new' ? name.trim() || undefined : undefined, asset_id: assetId, parent_version_id: parentVersionId, folder_id: mode === 'new' ? folderId : undefined }))
    } catch (cause) { setError(errorMessage(cause))
    } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!active || !job) return
    const timer = window.setInterval(async () => {
      try {
        const current = await api.stepAIJob(job.id)
        setJob(current)
        if (current.status === 'needs_input') {
          setFields(current.fields || [])
          setAnswers(initialAnswers(current.fields || []))
          setTranscript((items) => [...items, { role: 'agent', text: current.error || current.detail || 'The geometry Agent needs more defining information.' }])
        }
        if (current.status === 'completed') onCompleted(current)
        if (current.status === 'failed') setError(current.error || current.detail || 'AI STEP generation stopped before creating a version.')
      } catch (cause) { setError(errorMessage(cause)) }
    }, 800)
    return () => window.clearInterval(timer)
  }, [active, job?.id, onCompleted])

  const submit = (event: FormEvent) => { event.preventDefault(); void start() }
  const submitClarification = (event: FormEvent) => { event.preventDefault(); void start(serializedAnswers(fields, answers)) }
  const cancel = async () => { if (job) setJob(await api.cancelStepAIJob(job.id)) }

  if (minimized) return <aside className={`ai-create-session-dock${completed ? ' ready' : ''}`} aria-live="polite"><span className="ai-create-session-dock-icon">{completed ? <CheckCircle2 size={16} /> : <Sparkles size={16} />}</span><span><strong>{t(completed ? 'AI Design is ready' : 'AI Design session')}</strong><small>{t(completed ? 'A validated STEP version is ready to review.' : job?.detail || 'Working in the background…')}</small></span><button type="button" onClick={() => setMinimized(false)}>{t(completed ? 'Review' : 'Open')}</button></aside>

  const hasStarted = Boolean(job || transcript.length)
  return <div className="ai-create-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeWhenIdle() }}>
    <div ref={modalRef} className="ai-create-modal" role="dialog" aria-modal="true" aria-labelledby="step-ai-design-title" tabIndex={-1}>
      <button className="icon-button ai-create-minimize" type="button" onClick={() => setMinimized(true)} aria-label={t('Minimize AI Design session')}><Minus size={18} /></button>
      <button className="icon-button ai-create-close" type="button" onClick={closeWhenIdle} disabled={busy || Boolean(active)} aria-label={t('Close AI Design dialog')}><X size={18} /></button>
      <div className="ai-create-copy"><span className="ai-create-icon"><WandSparkles size={19} /></span><div><p className="eyebrow">{t('AI DESIGN')}</p><h2 id="step-ai-design-title">{t(hasStarted ? 'Let’s define the geometry' : mode === 'new' ? 'Describe the STEP geometry you want' : 'Describe the change to this STEP asset')}</h2><p>{t('The Agent creates a reviewable exact-CAD version, validates it with OpenCascade, and preserves every existing version.')}</p></div></div>
      {!hasStarted && <form onSubmit={submit}>
        {mode === 'new' && <div className="step-ai-design-name"><input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('Asset name (optional)')} aria-label={t('STEP asset name')} /></div>}
        <div className={`ai-create-intent-input${limit.overLimit ? ' over-limit' : limit.nearLimit ? ' near-limit' : ''}`}><textarea value={intent} onChange={(event) => setIntent(event.target.value)} placeholder={t(mode === 'new' ? 'Describe the geometry, dimensions, features, and design intent.' : 'Describe only the required geometry change and any defining dimensions.')} rows={3} disabled={busy} aria-label={t('Geometry requirement')} /><div className="ai-create-intent-limit"><span>{t(`${limit.characters.toLocaleString()} / 4,000 characters`)}</span><small>{t('Include exact dimensions whenever they matter.')}</small></div></div>
        <div className="ai-create-form-footer"><span>{t(mode === 'new' ? `Destination · ${folderName || 'STEP Library'}` : `New version · ${assetName}`)}</span><button type="submit" disabled={!intent.trim() || busy || limit.overLimit}>{busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}{t(busy ? 'Thinking…' : 'Start with AI')} {!busy && <ArrowRight size={14} />}</button></div>
      </form>}
      {transcript.length > 0 && <div className="ai-create-conversation" aria-live="polite">{transcript.map((item, index) => <div className={`ai-create-message ${item.role}`} key={`${item.role}-${index}`}><span>{item.role === 'agent' ? <Sparkles size={13} /> : t('You')}</span><p>{t(item.text)}</p></div>)}</div>}
      {fields.length > 0 && <AICreateClarificationForm fields={fields} values={answers} busy={busy} round={1} onChange={(id, value) => setAnswers((current) => ({ ...current, [id]: value }))} onSubmit={submitClarification} />}
      {progress && <AICreateProgressView progress={progress} />}
      {active && <button className="ai-create-retry step-ai-cancel" type="button" onClick={() => void cancel()}>{t('Cancel generation')}</button>}
      {error && <div className="ai-create-error" role="alert">{t(error)}</div>}
      {error && !active && <button className="ai-create-retry" type="button" onClick={() => { setJob(null); setFields([]); setTranscript([]); setError('') }}><RotateCcw size={14} /> {t('Retry current step')}</button>}
      {completed && <section className="ai-create-session-complete"><CheckCircle2 size={20} /><div><strong>{t('STEP version is ready')}</strong><p>{t('The new exact-CAD version passed OpenCascade validation and is stored in this asset.')}</p></div><button type="button" onClick={onClose}>{t('Review version')}</button></section>}
      <p className="ai-create-safety">{t('AI Design never overwrites an existing STEP version. Every result remains reviewable and downloadable.')}</p>
    </div>
  </div>
}
