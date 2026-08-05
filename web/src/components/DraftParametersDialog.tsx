import { AlertCircle, Braces, RefreshCw, X } from 'lucide-react'
import { forwardRef } from 'react'
import type { ResourceDetail } from '../api/client'
import DraftParameterEditor from './DraftParameterEditor'

type Props = {
  draftId: string
  draftName: string
  detail: ResourceDetail | null
  loading: boolean
  error: string
  onClose: () => void
  onRetry: () => void
}

const DraftParametersDialog = forwardRef<HTMLElement, Props>(function DraftParametersDialog({
  draftId,
  draftName,
  detail,
  loading,
  error,
  onClose,
  onRetry,
}, ref) {
  return (
    <section
      ref={ref}
      className="project-parameters-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Draft parameters"
      tabIndex={-1}
    >
      <header className="project-parameters-header">
        <Braces size={16} />
        <div>
          <strong>Draft parameters</strong>
          <span>{draftName || 'Untitled Draft'}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Draft parameters"><X size={16} /></button>
      </header>

      <div className="project-parameters-body">
        {loading && (
          <div className="detail-empty"><RefreshCw size={16} className="spin" /> Reading Draft parameters…</div>
        )}
        {!loading && (error || !detail) && (
          <div className="detail-state error">
            <AlertCircle size={18} />
            <strong>Could not read Draft parameters</strong>
            <span>{error || 'No Draft parameters were returned.'}</span>
            <button type="button" onClick={onRetry}>Retry</button>
          </div>
        )}
        {!loading && !error && detail && (
          detail.simulation_params
            ? <DraftParameterEditor draftId={draftId} parameters={detail.simulation_params} onSaved={onRetry} />
            : <div className="detail-empty">Flow360 did not return simulation parameters.</div>
        )}
      </div>
    </section>
  )
})

export default DraftParametersDialog
