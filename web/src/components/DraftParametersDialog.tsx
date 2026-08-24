import { AlertCircle, Check, Copy, FileJson2, RefreshCw, Save, X } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectInfo, ResourceDetail, ResourceNode } from '../api/client'
import { useI18n } from '../i18n'
import DraftParameterEditor, { type DraftParameterEditorHandle } from './DraftParameterEditor'

type Props = {
  draftId: string
  draftName: string
  detail: ResourceDetail | null
  loading: boolean
  error: string
  project?: ProjectInfo
  resource?: ResourceNode
  onClose: () => void
  onRetry: () => void
  onParametersSynced?: (parameters: Record<string, unknown>) => void
  onReviewRun?: () => void
  externalPatch?: { id: number; draftId: string; patch: Record<string, unknown> } | null
  onExternalPatchApplied?: (id: number) => void
  onCandidateChange?: (parameters: Record<string, unknown>) => void
  onDirtyChange?: (dirty: boolean) => void
  onRunReadinessChange?: (ready: boolean) => void
  registerCloseRequest?: (requestClose: (() => void) | null) => void
  onCloseCancelled?: () => void
}

const DraftParametersDialog = forwardRef<HTMLElement, Props>(function DraftParametersDialog({
  draftId,
  draftName,
  detail,
  loading,
  error,
  project,
  resource,
  onClose,
  onRetry,
  onParametersSynced,
  onReviewRun,
  externalPatch,
  onExternalPatchApplied,
  onCandidateChange,
  onDirtyChange,
  onRunReadinessChange,
  registerCloseRequest,
  onCloseCancelled,
}, ref) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [closeGuardOpen, setCloseGuardOpen] = useState(false)
  const [saveClosing, setSaveClosing] = useState(false)
  const editorRef = useRef<DraftParameterEditorHandle>(null)
  useEffect(() => setCopied(false), [draftId])
  const requestClose = useCallback(() => {
    if (dirty) setCloseGuardOpen(true)
    else onClose()
  }, [dirty, onClose])
  useEffect(() => {
    registerCloseRequest?.(requestClose)
    return () => registerCloseRequest?.(null)
  }, [registerCloseRequest, requestClose])
  const handleDirtyChange = useCallback((next: boolean) => {
    setDirty(next)
    onDirtyChange?.(next)
  }, [onDirtyChange])
  const discardAndClose = () => {
    editorRef.current?.discard()
    setCloseGuardOpen(false)
    onClose()
  }
  const saveAndClose = async () => {
    if (saveClosing) return
    setSaveClosing(true)
    const saved = await editorRef.current?.save()
    setSaveClosing(false)
    if (!saved) return
    setCloseGuardOpen(false)
    onClose()
  }
  const copyDraftID = async () => {
    await navigator.clipboard.writeText(draftId)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }
  return (
    <section
      ref={ref}
      className="project-parameters-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={t('Current Draft')}
      tabIndex={-1}
    >
      <header className="project-parameters-header">
        <span className="project-parameters-icon"><FileJson2 size={18} /></span>
        <div className="project-parameters-identity">
          <small>{t('Current Draft')}</small>
          <strong>{draftName || t('Untitled Draft')}</strong>
          <span>{resource ? `${resource.type} · ${resource.name}` : project?.name || t('Flow360 resource')}</span>
        </div>
        <div className="project-parameters-meta">
          <span className="project-parameters-sync"><i />{dirty ? t('Unsaved changes stay on this device.') : t('Draft matches the saved Flow360 version.')}</span>
          <button type="button" className="project-parameters-copy" onClick={() => void copyDraftID()} title={draftId} aria-label={t('Copy Draft ID')}>
            {copied ? <Check size={13} /> : <Copy size={13} />}<code>{draftId}</code>
          </button>
        </div>
        <button type="button" className="project-parameters-close" onClick={requestClose} aria-label={t('Close Draft configuration')}><X size={17} /></button>
      </header>

      <div className="project-parameters-body">
        {loading && (
          <div className="detail-empty"><RefreshCw size={16} className="spin" /> {t('Reading Draft parameters…')}</div>
        )}
        {!loading && (error || !detail) && (
          <div className="detail-state error">
            <AlertCircle size={18} />
            <strong>{t('Could not read Draft parameters')}</strong>
            <span>{error || t('No Draft parameters were returned.')}</span>
            <button type="button" onClick={onRetry}>{t('Retry')}</button>
          </div>
        )}
        {!loading && !error && detail && (
          detail.simulation_params
            ? <DraftParameterEditor
                ref={editorRef}
                draftId={draftId}
                parameters={detail.simulation_params}
                project={project}
                resource={resource}
                externalPatch={externalPatch}
                onExternalPatchApplied={onExternalPatchApplied}
                onCandidateChange={onCandidateChange}
                onDirtyChange={handleDirtyChange}
                onRunReadinessChange={onRunReadinessChange}
                onSaved={onParametersSynced}
                onReviewRun={onReviewRun}
              />
            : <div className="detail-empty">{t('Flow360 did not return simulation parameters.')}</div>
        )}
      </div>
      {closeGuardOpen && <div className="draft-close-guard-backdrop">
        <section className="draft-close-guard" role="alertdialog" aria-modal="true" aria-labelledby="draft-close-guard-title">
          <AlertCircle size={20} />
          <div>
            <strong id="draft-close-guard-title">{t('Save changes before closing?')}</strong>
            <p>{t('Your current candidate has not been saved to Flow360.')}</p>
          </div>
          <div className="draft-close-guard-actions">
            <button type="button" disabled={saveClosing} onClick={() => { setCloseGuardOpen(false); onCloseCancelled?.() }}>{t('Continue editing')}</button>
            <button type="button" disabled={saveClosing} onClick={discardAndClose}>{t('Discard changes')}</button>
            <button type="button" className="primary" disabled={saveClosing} onClick={() => void saveAndClose()}>
              {saveClosing ? <RefreshCw size={13} className="spin" /> : <Save size={13} />}{saveClosing ? t('Saving…') : t('Save and close')}
            </button>
          </div>
        </section>
      </div>}
    </section>
  )
})

export default DraftParametersDialog
