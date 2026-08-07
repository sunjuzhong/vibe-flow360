import { ArrowRight, CircleHelp, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AgentQuestion } from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'

export type ClarificationAnswers = Record<string, unknown>
type ClarificationQuestionType = NonNullable<AgentQuestion['type']>
type ResolvedAgentQuestion = AgentQuestion & { type: ClarificationQuestionType }

export function agentClarificationPortalTarget(
  ownerDocument: Pick<Document, 'body'> | undefined = typeof document === 'undefined' ? undefined : document,
) {
  return ownerDocument?.body ?? null
}

function confirmationQuestion(question: AgentQuestion) {
  return /\b(confirm|whether|may i|should i|can i|allow|approve)\b|确认|是否|允许|同意/i.test(`${question.message} ${question.reason ?? ''}`)
}

function derivationConfirmation(question: AgentQuestion) {
  return /\bmay (?:i|we) derive\b|\bderive .* (?:from|using)\b|是否.*推导|允许.*推导/i.test(`${question.message} ${question.reason ?? ''}`)
}

export function inferredClarificationQuestionType(question: AgentQuestion): ClarificationQuestionType {
  if (question.type) return question.type
  if (question.options?.length) return 'select'
  if (typeof question.default === 'boolean') return 'boolean'
  if (typeof question.default === 'number' || question.unit || question.min !== undefined || question.max !== undefined) return 'number'
  if (derivationConfirmation(question)) return 'boolean'
  if (/(?:^|\.)(?:velocity(?:_magnitude)?|mach|reynolds|temperature|pressure|density|alpha|beta|angle|diameter|radius|length|height|width|max_steps)$/i.test(question.field)) return 'number'
  if (confirmationQuestion(question)) return 'boolean'
  return 'text'
}

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function inferredClarificationDefault(question: AgentQuestion, type = inferredClarificationQuestionType(question)) {
  if (question.default !== undefined) return question.default
  if (type === 'boolean' && confirmationQuestion(question)) return true
  if (type === 'number') {
    const inferredUnit = question.unit || (/(?:^|\.)velocity(?:_magnitude)?$/i.test(question.field) ? 'm/s' : '')
    if (!inferredUnit) return undefined
    const match = `${question.message} ${question.reason ?? ''}`.match(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*${escapedRegExp(inferredUnit)}`, 'i'))
    if (match) return Number(match[1])
  }
  return undefined
}

export function resolvedClarificationQuestions(questions: AgentQuestion[]): ResolvedAgentQuestion[] {
  return questions.map((question) => {
    const type = inferredClarificationQuestionType(question)
    const defaultValue = inferredClarificationDefault(question, type)
    return {
      ...question,
      type,
      ...(!question.unit && type === 'number' && /(?:^|\.)velocity(?:_magnitude)?$/i.test(question.field) ? { unit: 'm/s' } : {}),
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
    }
  })
}

// Polling returns a new questions array every few seconds. Key initialization
// to the actual form contract so an unchanged refresh cannot erase a user's
// in-progress answer.
export function clarificationQuestionsSignature(questions: AgentQuestion[]): string {
  return JSON.stringify(questions)
}

export function initialClarificationAnswers(questions: AgentQuestion[]): ClarificationAnswers {
  return Object.fromEntries(questions.map((question) => {
    if (question.default !== undefined) return [question.field, question.default]
    if (question.type === 'boolean') return [question.field, false]
    return [question.field, '']
  }))
}

export function serializedClarificationAnswers(
  questions: AgentQuestion[],
  answers: ClarificationAnswers,
): ClarificationAnswers {
  return Object.fromEntries(questions.map((question) => {
    const value = answers[question.field]
    if (question.type === 'number' && value !== '') return [question.field, Number(value)]
    return [question.field, value]
  }))
}

export function clarificationAnswerSummary(
  questions: AgentQuestion[],
  answers: ClarificationAnswers,
): string {
  const lines = questions.map((question) => {
    const value = answers[question.field]
    const option = question.options?.find((candidate) => candidate.value === value)
    const display = question.type === 'boolean'
      ? Boolean(value) ? 'Yes' : 'No'
      : option?.label ?? String(value)
    return `- ${question.message} (${question.field}): ${display}${question.unit ? ` ${question.unit}` : ''}`
  })
  return `Clarification answers\n${lines.join('\n')}`
}

export default function AgentClarificationDialog({
  open,
  title = 'Engineering details required',
  message,
  questions,
  busy = false,
  onClose,
  onSubmit,
}: {
  open: boolean
  title?: string
  message?: string
  questions: AgentQuestion[]
  busy?: boolean
  onClose: () => void
  onSubmit: (answers: ClarificationAnswers, summary: string) => void
}) {
  const [answers, setAnswers] = useState<ClarificationAnswers>({})
  const dialogRef = useFocusTrap<HTMLDivElement>(open, onClose, 'input,select,textarea,button[type="submit"]')
  const resolvedQuestions = useMemo(() => resolvedClarificationQuestions(questions), [questions])
  const questionsSignature = clarificationQuestionsSignature(questions)

  useEffect(() => {
    if (open) setAnswers(initialClarificationAnswers(resolvedQuestions))
  }, [open, questionsSignature])

  useEffect(() => {
    const target = agentClarificationPortalTarget()
    if (!open || !target) return
    const previousOverflow = target.style.overflow
    target.style.overflow = 'hidden'
    return () => { target.style.overflow = previousOverflow }
  }, [open])

  const normalized = useMemo(
    () => serializedClarificationAnswers(resolvedQuestions, answers),
    [answers, resolvedQuestions],
  )

  const recommendedCount = resolvedQuestions.filter((question) => question.default !== undefined).length
  const requiredQuestions = resolvedQuestions.filter((question) => question.urgency === 'required')
  const allRequiredAnswered = requiredQuestions.every((question) => {
    const value = normalized[question.field]
    return value !== undefined && value !== null && (typeof value !== 'string' || value.trim() !== '')
  })
  const confirmOnly = recommendedCount > 0 && allRequiredAnswered

  if (!open) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(normalized, clarificationAnswerSummary(resolvedQuestions, normalized))
  }

  const modal = (
    <div className="agent-clarification-overlay" role="presentation">
      <div ref={dialogRef} className="agent-clarification-dialog" role="dialog" aria-modal="true" aria-labelledby="agent-clarification-title" tabIndex={-1}>
        <div className="agent-clarification-header">
          <span><CircleHelp size={18} /></span>
          <div><strong id="agent-clarification-title">{title}</strong>{message && <small>{message}</small>}</div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close clarification form"><X size={17} /></button>
        </div>
        <form onSubmit={submit}>
          {recommendedCount > 0 && (
            <div className="agent-clarification-recommendation-summary">
              <strong>{`${recommendedCount} Agent ${recommendedCount === 1 ? 'recommendation' : 'recommendations'} prefilled`}</strong>
              <span>Review the highlighted values, then confirm or change only what is necessary.</span>
            </div>
          )}
          <div className="agent-clarification-fields">
            {resolvedQuestions.map((question) => {
              const type = question.type
              const required = question.urgency === 'required'
              return (
                <label className={question.default !== undefined ? 'recommended' : ''} key={question.field}>
                  <span>{question.message}{required && <em>*</em>}{question.default !== undefined && <b>Agent recommendation</b>}</span>
                  {question.reason && <small>{question.reason}</small>}
                  {question.recommendation && <small className="agent-clarification-reason">Why this default · {question.recommendation}</small>}
                  {type === 'select' && (
                    <select value={String(answers[question.field] ?? '')} required={required} disabled={busy} onChange={(event) => setAnswers((current) => ({ ...current, [question.field]: event.target.value }))}>
                      {question.default === undefined && <option value="" disabled>Select an option</option>}
                      {question.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  )}
                  {type === 'number' && (
                    <span className="agent-clarification-number">
                      <input type="number" step="any" min={question.min} max={question.max} value={String(answers[question.field] ?? '')} placeholder={question.placeholder} required={required} disabled={busy} onChange={(event) => setAnswers((current) => ({ ...current, [question.field]: event.target.value }))} />
                      {question.unit && <b>{question.unit}</b>}
                    </span>
                  )}
                  {type === 'text' && (
                    <input type="text" value={String(answers[question.field] ?? '')} placeholder={question.placeholder} required={required} disabled={busy} onChange={(event) => setAnswers((current) => ({ ...current, [question.field]: event.target.value }))} />
                  )}
                  {type === 'boolean' && (
                    <span className="agent-clarification-boolean">
                      <input type="checkbox" checked={Boolean(answers[question.field])} disabled={busy} onChange={(event) => setAnswers((current) => ({ ...current, [question.field]: event.target.checked }))} />
                      <b>{Boolean(answers[question.field]) ? 'Yes' : 'No'}</b>
                    </span>
                  )}
                  <code>{question.field}</code>
                </label>
              )
            })}
          </div>
          <div className="agent-clarification-footer">
            <span>Your answers will be added to this Agent session.</span>
            <button type="submit" disabled={busy}>
              {busy ? <Loader2 className="spin" size={14} /> : <ArrowRight size={14} />}
              {busy ? 'Continuing…' : confirmOnly ? 'Confirm recommended values & continue' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  const portalTarget = agentClarificationPortalTarget()
  return portalTarget ? createPortal(modal, portalTarget) : modal
}
