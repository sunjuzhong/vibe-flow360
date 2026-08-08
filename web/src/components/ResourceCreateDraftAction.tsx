import { AlertCircle, FilePlus2, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useI18n } from '../i18n'

export default function ResourceCreateDraftAction({
  onCreate,
}: {
  onCreate: () => Promise<void>
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onCreate()
    } catch (cause) {
      setError(t(String(cause).replace(/^Error:\s*/, '')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="resource-create-draft-action">
      <button className="geometry-plan-action" type="button" disabled={busy} onClick={() => void create()}>
        {busy ? <LoaderCircle size={15} className="spin" /> : <FilePlus2 size={15} />}
        {busy ? t('Creating Draft…') : t('Create Draft')}
      </button>
      <small>{t("Copies this Resource's current SimulationParams into an editable Draft.")}</small>
      {error && <p role="alert"><AlertCircle size={13} />{error}</p>}
    </div>
  )
}
