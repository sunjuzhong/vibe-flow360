import { AlertCircle, Check, Copy, FileJson2, RefreshCw, X } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import type { ProjectInfo, ResourceDetail, ResourceNode } from '../api/client'
import { useI18n } from '../i18n'
import DraftParameterEditor from './DraftParameterEditor'

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
}, ref) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  useEffect(() => setCopied(false), [draftId])
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
          <span className="project-parameters-sync"><i />{t('Changes save automatically to Flow360.')}</span>
          <button type="button" className="project-parameters-copy" onClick={() => void copyDraftID()} title={draftId} aria-label={t('Copy Draft ID')}>
            {copied ? <Check size={13} /> : <Copy size={13} />}<code>{draftId}</code>
          </button>
        </div>
        <button type="button" className="project-parameters-close" onClick={onClose} aria-label={t('Close Draft configuration')}><X size={17} /></button>
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
            ? <DraftParameterEditor draftId={draftId} parameters={detail.simulation_params} project={project} resource={resource} onSaved={onParametersSynced} onReviewRun={onReviewRun} />
            : <div className="detail-empty">{t('Flow360 did not return simulation parameters.')}</div>
        )}
      </div>
    </section>
  )
})

export default DraftParametersDialog
