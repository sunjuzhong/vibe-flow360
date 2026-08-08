import { AlertCircle, Braces, RefreshCw, X } from 'lucide-react'
import { forwardRef } from 'react'
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
  onReviewRun,
}, ref) {
  const { t } = useI18n()
  return (
    <section
      ref={ref}
      className="project-parameters-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={t('Configure Draft')}
      tabIndex={-1}
    >
      <header className="project-parameters-header">
        <Braces size={16} />
        <div>
          <strong>{t('Configure Draft')}</strong>
          <span>{draftName || t('Untitled Draft')}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t('Close Draft configuration')}><X size={16} /></button>
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
            ? <DraftParameterEditor draftId={draftId} parameters={detail.simulation_params} project={project} resource={resource} onSaved={onRetry} onReviewRun={onReviewRun} />
            : <div className="detail-empty">{t('Flow360 did not return simulation parameters.')}</div>
        )}
      </div>
    </section>
  )
})

export default DraftParametersDialog
