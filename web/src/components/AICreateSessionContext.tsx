import { Check, Circle, CircleHelp, MessageSquare, PauseCircle, Sparkles } from 'lucide-react'
import type { AICreateClarificationField, AICreateSession } from '../api/client'
import { useI18n } from '../i18n'
import './AICreateSessionContext.css'

function answerLabel(field: AICreateClarificationField, value: unknown) {
  const option = field.options?.find((candidate) => candidate.value === value)
  if (option) return option.label
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (value === undefined || value === null || value === '') return 'Not provided'
  return `${String(value)}${field.unit ? ` ${field.unit}` : ''}`
}

function isStoredAnswerPayload(content: string) {
  const trimmed = content.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
  try { return typeof JSON.parse(trimmed) === 'object' } catch { return false }
}

export function sessionNextStep(session: AICreateSession) {
  if (session.phase === 'needs_input' && (session.pending ?? []).length === 0) return 'The saved session needs to reconstruct its pending questions. Resume it to continue from the last complete checkpoint.'
  if (session.phase === 'needs_input') return 'Answer the engineering questions below so the Agent can continue from this checkpoint.'
  if (session.phase === 'failed') return 'Review what was preserved, then resume the checkpoint or send a correction.'
  if (session.phase === 'completed') return 'The Project is ready. You can open it or ask for another parameter or Case design change.'
  return 'Resume the session to continue from the latest saved checkpoint.'
}

export default function AICreateSessionContext({ session, compact = false }: { session: AICreateSession; compact?: boolean }) {
  const { t } = useI18n()
  const originalRequest = session.original_request || session.messages?.[0]?.content || session.intent
  const notes = (session.messages ?? []).filter((message, index) => {
    if (index === 0 && message.role === 'user') return false
    return !(message.role === 'user' && isStoredAnswerPayload(message.content))
  })
  const checkpoints = [
    ['Exact CAD', session.checkpoints?.cad_validated],
    ['Flow360 Project', session.checkpoints?.project_created],
    ['Validated parameters', session.checkpoints?.parameters_validated],
    ['Configured Draft', session.checkpoints?.draft_configured],
  ] as const

  return <section className={`ai-session-context${compact ? ' compact' : ''}`} aria-label={t('Saved session context')}>
    <header>
      <div><p className="eyebrow">{t('WHERE THIS SESSION LEFT OFF')}</p><h3>{t('Continue with full context')}</h3></div>
      <p>{t(sessionNextStep(session))}</p>
    </header>
    <div className="ai-session-checkpoints" aria-label={t('Saved progress')}>
      {checkpoints.map(([label, complete]) => <div className={complete ? 'complete' : ''} key={label}>
        <span>{complete ? <Check size={12} /> : <Circle size={12} />}</span><small>{t(label)}</small>
      </div>)}
    </div>
    <div className="ai-session-history-heading"><MessageSquare size={14} /><strong>{t('Conversation history')}</strong><span>{t('{count} saved turns').replace('{count}', String(1 + (session.history?.length ?? 0) * 2 + notes.length))}</span></div>
    <div className="ai-session-history-timeline">
      <article className="user original"><span>{t('Original request')}</span><p>{originalRequest}</p></article>
      {(session.history ?? []).map((round) => <div className="ai-session-round" key={round.round}>
        <article className="assistant"><span><CircleHelp size={12} /> {t('Agent questions · round {round}').replace('{round}', String(round.round))}</span><ul>{round.fields.map((field) => <li key={field.id}><strong>{t(field.label)}</strong>{field.description && <small>{t(field.description)}</small>}</li>)}</ul></article>
        <article className="user"><span>{t('Your answers')}</span><dl>{round.fields.map((field) => <div key={field.id}><dt>{t(field.label)}</dt><dd>{t(answerLabel(field, round.answers?.[field.id]))}</dd></div>)}</dl></article>
      </div>)}
      {notes.map((message, index) => <article className={message.role} key={`${message.created_at}-${index}`}><span>{message.role === 'user' ? t('You added') : <><Sparkles size={12} /> {t('Agent')}</>}</span><p>{t(message.content)}</p></article>)}
      {(session.pending ?? []).length > 0 && <article className="pending"><span><PauseCircle size={12} /> {t('Waiting for your input')}</span><p>{t('These questions are still unanswered:')}</p><ul>{session.pending?.map((field) => <li key={field.id}>{t(field.label)}</li>)}</ul></article>}
      {session.phase === 'needs_input' && (session.pending ?? []).length === 0 && <article className="pending"><span><PauseCircle size={12} /> {t('Pending questions need recovery')}</span><p>{t('This older session stopped before its current questions were saved. Resume it to reconstruct them from the original request and saved answers.')}</p></article>}
    </div>
  </section>
}
