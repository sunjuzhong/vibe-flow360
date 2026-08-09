import { CheckCircle2, RefreshCw, Sparkles, X } from 'lucide-react'
import { useId } from 'react'
import { createPortal } from 'react-dom'
import type { AgentProposal } from '../api/client'
import { useI18n } from '../i18n'
import { useFocusTrap } from '../lib/useFocusTrap'

export type DraftParameterChange = {
  path: string
  before: unknown
  after: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function applyDraftMergePatch(target: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return patch
  const result: Record<string, unknown> = isRecord(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key]
    else result[key] = applyDraftMergePatch(result[key], value)
  }
  return result
}

export function draftParameterChanges(before: unknown, patch: Record<string, unknown>): DraftParameterChange[] {
  const after = applyDraftMergePatch(before, patch)
  const changes: DraftParameterChange[] = []
  const visit = (left: unknown, right: unknown, path: string) => {
    if (isRecord(left) && isRecord(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)])
      for (const key of keys) visit(left[key], right[key], path ? `${path}.${key}` : key)
      return
    }
    if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ path, before: left, after: right })
  }
  visit(before, after, '')
  return changes
}

function displayValue(value: unknown, removed: string) {
  if (value === undefined) return '—'
  if (value === null) return removed
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export default function AgentDraftUpdateDialog({
  proposal,
  parameters,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  proposal: AgentProposal | null
  parameters: Record<string, unknown>
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useI18n()
  const titleId = useId()
  const dialogRef = useFocusTrap<HTMLDivElement>(Boolean(proposal), onCancel, '.agent-draft-update-cancel')
  if (!proposal) return null
  const changes = draftParameterChanges(parameters, proposal.patch)

  const dialog = (
    <div className="flow360-confirm-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel()
    }}>
      <div ref={dialogRef} className="flow360-confirm-dialog agent-draft-update-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header>
          <span className="flow360-confirm-mark"><Sparkles size={21} /></span>
          <div><small>{t('ASK AI · DRAFT EDIT')}</small><h2 id={titleId}>{t('Confirm Draft parameter changes')}</h2></div>
          <button type="button" className="icon-button agent-draft-update-cancel" disabled={busy} onClick={onCancel} aria-label={t('Close confirmation')}><X size={18} /></button>
        </header>
        <div className="flow360-confirm-body">
          <p className="flow360-confirm-description">{proposal.intent}</p>
          <div className="agent-draft-change-list">
            <div className="agent-draft-change-head"><span>{t('Parameter')}</span><span>{t('Current value')}</span><span>{t('New value')}</span></div>
            {changes.map((change) => (
              <div key={change.path}>
                <code>{change.path || t('SimulationParams')}</code>
                <span>{displayValue(change.before, t('Removed'))}</span>
                <strong>{displayValue(change.after, t('Removed'))}</strong>
              </div>
            ))}
            {!changes.length && <p>{t('This patch does not change the current Draft.')}</p>}
          </div>
          {proposal.fields.length > 0 && (
            <ul className="agent-draft-change-reasons">
              {proposal.fields.map((field) => <li key={field.key}><code>{field.key}</code><span>{field.description || field.provenance}</span></li>)}
            </ul>
          )}
          <div className="agent-draft-no-run"><CheckCircle2 size={16} /><span><strong>{t('Draft edit only')}</strong><small>{t('Saving these changes will not start meshing or a solver run.')}</small></span></div>
          {error && <div className="draft-manager-error" role="alert">{error}</div>}
        </div>
        <footer>
          <button type="button" className="flow360-confirm-secondary agent-draft-update-cancel" disabled={busy} onClick={onCancel}>{t('Cancel')}</button>
          <button type="button" className="flow360-confirm-primary" disabled={busy || !changes.length} onClick={onConfirm}>
            {busy ? <RefreshCw size={16} className="spin" /> : <CheckCircle2 size={16} />}
            {busy ? t('Saving…') : t('Confirm and save Draft')}
          </button>
        </footer>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
