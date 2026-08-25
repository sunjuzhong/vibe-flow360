import { AlertCircle, Layers3, Save, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../i18n'

export function DraftSelectionGroupDialog({
  faceCount,
  edgeCount,
  onSave,
  onClose,
}: {
  faceCount: number
  edgeCount: number
  onSave: (name: string) => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const selectionCount = faceCount + edgeCount

  useEffect(() => {
    inputRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, saving])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const nextName = name.trim()
    if (!selectionCount) {
      setError(t('Select at least one face or edge before saving a selection group.'))
      return
    }
    if (!nextName) {
      setError(t('Selection group name is required.'))
      inputRef.current?.focus()
      return
    }
    setSaving(true)
    setError('')
    try {
      await onSave(nextName)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('The selection group could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const dialog = (
    <div className="geometry-capability-overlay" role="presentation">
      <section
        className="geometry-capability-dialog draft-selection-group-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header>
          <span className="geometry-capability-dialog-icon"><Layers3 size={17} /></span>
          <div>
            <div className="geometry-capability-dialog-title"><strong id={titleId}>{t('Save selection group')}</strong></div>
            <small id={descriptionId}>{t('Save the current 3D selection into the active Draft SimulationParams.')}</small>
          </div>
          <button type="button" disabled={saving} onClick={onClose} aria-label={t('Close selection group form')}><X size={17} /></button>
        </header>
        <form className="draft-selection-group-form" onSubmit={submit}>
          <div className="draft-selection-group-summary">
            <span>{t('{count} faces').replace('{count}', String(faceCount))}</span>
            <span>{t('{count} edges').replace('{count}', String(edgeCount))}</span>
          </div>
          {!selectionCount && (
            <div className="draft-selection-group-error" role="alert">
              <AlertCircle size={15} /> {t('Select at least one face or edge before saving a selection group.')}
            </div>
          )}
          <label>
            <span>{t('Selection group name')}</span>
            <input
              ref={inputRef}
              value={name}
              maxLength={128}
              disabled={saving}
              required
              onChange={(event) => setName(event.target.value)}
              placeholder={t('For example: wing surfaces')}
            />
          </label>
          {error && <div className="draft-selection-group-error" role="alert"><AlertCircle size={15} /> {error}</div>}
          <div className="draft-selection-group-actions">
            <button type="button" disabled={saving} onClick={onClose}>{t('Cancel')}</button>
            <button type="submit" className="primary" disabled={saving || !selectionCount}>
              <Save size={14} /> {saving ? t('Saving…') : t('Save to Draft')}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
