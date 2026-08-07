import { AlertCircle, Check, Copy, FilePlus2, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import { forwardRef, useEffect, useState, type FormEvent } from 'react'
import type { DraftRecord, ProjectItem } from '../api/client'
import { useI18n } from '../i18n'

type Props = {
  drafts: DraftRecord[]
  selectedId: string
  resource: ProjectItem
  onClose: () => void
  onSelect: (draftId: string) => void
  onCreate: (name: string) => Promise<void>
  onCopy: (draft: DraftRecord, name: string) => Promise<void>
  onRename: (draftId: string, name: string) => Promise<void>
  onDelete: (draftId: string) => Promise<void>
}

const DraftManagerPanel = forwardRef<HTMLElement, Props>(function DraftManagerPanel({
  drafts,
  selectedId,
  resource,
  onClose,
  onSelect,
  onCreate,
  onCopy,
  onRename,
  onDelete,
}, ref) {
  const { t } = useI18n()
  const [createName, setCreateName] = useState('')
  const [copySource, setCopySource] = useState<DraftRecord | null>(null)
  const [editingId, setEditingId] = useState('')
  const [editingName, setEditingName] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setCreateName(copySource ? `${copySource.name || t('Untitled Draft')} copy` : `${resource.name} Draft`)
  }, [copySource, resource.id, resource.name, t])

  const run = async (key: string, operation: () => Promise<void>) => {
    setBusy(key)
    setError('')
    try {
      await operation()
      setCopySource(null)
      setEditingId('')
      setDeletingId('')
    } catch (cause) {
      setError(String(cause).replace(/^Error:\s*/, ''))
    } finally {
      setBusy('')
    }
  }

  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    const name = createName.trim()
    if (!name || busy) return
    void run('create', () => copySource ? onCopy(copySource, name) : onCreate(name))
  }

  return (
    <aside ref={ref} className="resource-inspector project-drawer project-drawer-right draft-manager" role="dialog" aria-modal="true" aria-label={t('Manage Drafts')} tabIndex={-1}>
      <div className="workbench-panel-title">
        <FilePlus2 size={15} /><span>{t('Manage Drafts')}</span>
        <button type="button" onClick={onClose} aria-label={t('Close Draft manager')}><X size={15} /></button>
      </div>

      <form className="draft-manager-create" onSubmit={submitCreate}>
        <div>
          <strong>{copySource ? t('Copy Draft') : t('Create Draft from this Resource')}</strong>
          <span>{copySource ? copySource.name : `${resource.type} · ${resource.name}`}</span>
        </div>
        <label>
          <span>{t('Draft name')}</span>
          <input value={createName} maxLength={128} disabled={Boolean(busy)} onChange={(event) => setCreateName(event.target.value)} />
        </label>
        <div className="draft-manager-create-actions">
          {copySource && <button type="button" disabled={Boolean(busy)} onClick={() => setCopySource(null)}>{t('Cancel')}</button>}
          <button type="submit" className="primary" disabled={!createName.trim() || Boolean(busy)}>
            {busy === 'create' ? <RefreshCw size={14} className="spin" /> : copySource ? <Copy size={14} /> : <FilePlus2 size={14} />}
            {copySource ? t('Create copy') : t('Create Draft')}
          </button>
        </div>
        <small>{t('Creates an editable Draft without running Flow360.')}</small>
      </form>

      {error && <div className="draft-manager-error" role="alert"><AlertCircle size={14} />{error}</div>}

      <div className="draft-manager-list" aria-label={t('Project drafts')}>
        {drafts.map((draft) => {
          const active = draft.id === selectedId
          const editing = draft.id === editingId
          const confirmingDelete = draft.id === deletingId
          return (
            <article key={draft.id} className={active ? 'active' : ''}>
              {editing ? (
                <form onSubmit={(event) => {
                  event.preventDefault()
                  const name = editingName.trim()
                  if (name) void run(`rename:${draft.id}`, () => onRename(draft.id, name))
                }}>
                  <input aria-label={t('Draft name')} value={editingName} maxLength={128} autoFocus onChange={(event) => setEditingName(event.target.value)} />
                  <button type="submit" disabled={!editingName.trim() || Boolean(busy)} aria-label={t('Save Draft name')}><Check size={13} /></button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => setEditingId('')} aria-label={t('Cancel renaming Draft')}><X size={13} /></button>
                </form>
              ) : (
                <div className="draft-manager-row">
                  <button type="button" className="draft-manager-select" onClick={() => onSelect(draft.id)}>
                    <strong>{draft.name || t('Untitled Draft')}</strong>
                    <span>{draft.source_type || t('Resource')} · {draft.source_id || '—'}</span>
                  </button>
                  {active && <em>{t('Active')}</em>}
                </div>
              )}

              {confirmingDelete ? (
                <div className="draft-manager-confirm">
                  <span>{t('Delete this Draft permanently?')}</span>
                  <button type="button" disabled={Boolean(busy)} onClick={() => setDeletingId('')}>{t('Cancel')}</button>
                  <button type="button" className="danger" disabled={Boolean(busy)} onClick={() => void run(`delete:${draft.id}`, () => onDelete(draft.id))}>
                    {busy === `delete:${draft.id}` ? <RefreshCw size={13} className="spin" /> : <Trash2 size={13} />}{t('Delete')}
                  </button>
                </div>
              ) : (
                <div className="draft-manager-actions">
                  <button type="button" disabled={Boolean(busy)} onClick={() => setCopySource(draft)}><Copy size={13} />{t('Copy')}</button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => { setEditingId(draft.id); setEditingName(draft.name || '') }}><Pencil size={13} />{t('Rename')}</button>
                  <button type="button" disabled={Boolean(busy)} onClick={() => setDeletingId(draft.id)}><Trash2 size={13} />{t('Delete')}</button>
                </div>
              )}
            </article>
          )
        })}
        {!drafts.length && <p className="detail-empty">{t('This Project has no Drafts.')}</p>}
      </div>
    </aside>
  )
})

export default DraftManagerPanel
