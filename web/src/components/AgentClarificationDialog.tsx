import { ArrowRight, CircleHelp, Loader2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { AgentQuestion } from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'

export type ClarificationAnswers = Record<string, unknown>

export function agentClarificationPortalTarget(
  ownerDocument: Pick<Document, 'body'> | undefined = typeof document === 'undefined' ? undefined : document,
) {
  return ownerDocument?.body ?? null
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

  useEffect(() => {
    if (open) setAnswers(initialClarificationAnswers(questions))
  }, [open, questions])

  useEffect(() => {
    const target = agentClarificationPortalTarget()
    if (!open || !target) return
    const previousOverflow = target.style.overflow
    target.style.overflow = 'hidden'
    return () => { target.style.overflow = previousOverflow }
  }, [open])

  const normalized = useMemo(
    () => serializedClarificationAnswers(questions, answers),
    [answers, questions],
  )

  if (!open) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(normalized, clarificationAnswerSummary(questions, normalized))
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
          <div className="agent-clarification-fields">
            {questions.map((question) => {
              const type = question.type ?? 'text'
              const required = question.urgency === 'required'
              return (
                <label key={question.field}>
                  <span>{question.message}{required && <em>*</em>}</span>
                  {question.reason && <small>{question.reason}</small>}
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
                    <textarea rows={2} value={String(answers[question.field] ?? '')} placeholder={question.placeholder} required={required} disabled={busy} onChange={(event) => setAnswers((current) => ({ ...current, [question.field]: event.target.value }))} />
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
              {busy ? 'Continuing…' : 'Continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  const portalTarget = agentClarificationPortalTarget()
  return portalTarget ? createPortal(modal, portalTarget) : modal
}
