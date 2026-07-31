import { CloudUpload, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap'

export type ConfirmationDetail = {
  label: string
  value: string
}

export default function Flow360ConfirmationDialog({
  open,
  eyebrow,
  title,
  description,
  targetLabel,
  targetName,
  details,
  risk,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean
  eyebrow: string
  title: string
  description: string
  targetLabel: string
  targetName: string
  details: ConfirmationDetail[]
  risk: string
  confirmLabel: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  const [confirmReady, setConfirmReady] = useState(false)
  const dialogRef = useFocusTrap<HTMLDivElement>(
    open,
    onCancel,
    'button.flow360-confirm-secondary',
  )

  useEffect(() => {
    if (!open) {
      setConfirmReady(false)
      return
    }
    setConfirmReady(false)
    const timer = window.setTimeout(() => setConfirmReady(true), 450)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  return (
    <div
      className="flow360-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className="flow360-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header>
          <span className="flow360-confirm-mark"><CloudUpload size={21} /></span>
          <div>
            <small>{eyebrow}</small>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close confirmation"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flow360-confirm-body">
          <p id={descriptionId} className="flow360-confirm-description">{description}</p>

          <section className="flow360-confirm-target" aria-label="Submission target">
            <span><ShieldCheck size={16} /> {targetLabel}</span>
            <strong>{targetName}</strong>
            <dl>
              {details.map((detail) => (
                <div key={detail.label}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="flow360-confirm-risk">
            <TriangleAlert size={17} />
            <span>
              <strong>Cloud billing boundary</strong>
              <small>{risk}</small>
            </span>
          </div>
        </div>

        <footer>
          <button
            className="flow360-confirm-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Back to review
          </button>
          <button
            className="flow360-confirm-primary"
            onClick={() => {
              if (confirmReady && !busy) onConfirm()
            }}
            disabled={busy || !confirmReady}
          >
            {busy ? <span className="flow360-confirm-spinner" /> : <CloudUpload size={16} />}
            {busy ? 'Submitting…' : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
