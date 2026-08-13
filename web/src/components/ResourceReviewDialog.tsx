import type { ReactNode } from 'react'
import { useId } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, X } from 'lucide-react'
import { useFocusTrap } from '../lib/useFocusTrap'
import { useI18n } from '../i18n'

export type ResourceReviewDialogKey = string

export function ResourceReviewDialog({
  title,
  subtitle,
  icon,
  children,
  onClose,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  children: ReactNode
  onClose: () => void
}) {
  const { t } = useI18n()
  const titleId = useId()
  const subtitleId = useId()
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose, '.resource-review-dialog-close')

  const content = (
    <div
      className="resource-review-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="resource-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
      >
        <header>
          <span className="resource-review-dialog-icon">{icon}</span>
          <div>
            <strong id={titleId}>{title}</strong>
            <small id={subtitleId}>{subtitle}</small>
          </div>
          <button
            type="button"
            className="resource-review-dialog-close"
            onClick={onClose}
            aria-label={t('Close review details')}
          >
            <X size={17} />
          </button>
        </header>
        <div className="resource-review-dialog-body">{children}</div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

export function ResourceReviewLaunchers({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  return (
    <section className="resource-review-launchers" aria-label={t('Review details')}>
      <div className="resource-review-launchers-heading">{t('Review details')}</div>
      <div>{children}</div>
    </section>
  )
}

export function ResourceReviewLauncher({
  icon,
  label,
  summary,
  onClick,
}: {
  icon: ReactNode
  label: string
  summary: string
  onClick: () => void
}) {
  return (
    <button type="button" className="resource-review-launcher" onClick={onClick}>
      <span className="resource-review-launcher-icon">{icon}</span>
      <span><strong>{label}</strong><small>{summary}</small></span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
  )
}

export function ResourceReviewToggle({
  label,
  summary,
  checked,
  onChange,
}: {
  label: string
  summary: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      className={`resource-review-toggle ${checked ? 'checked' : ''}`}
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="resource-review-toggle-box">{checked && <Check size={12} aria-hidden="true" />}</span>
      <strong>{label}</strong>
      <small>{summary}</small>
    </button>
  )
}
