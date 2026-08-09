import { Check, ChevronRight, GitPullRequestDraft, Pencil, Play, Plus, RefreshCw, Settings2, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import type { DraftRecord, ResourceDetail } from '../api/client'
import { useI18n } from '../i18n'
import HelpTooltip from './HelpTooltip'
import { resourceStatus } from './ResourceDetailPanel'

type Props = {
  mode: 'resource' | 'draft'
  drafts: DraftRecord[]
  selectedId: string
  selectedDetail: ResourceDetail | null
  loading: boolean
  detailLoading: boolean
  error: string
  onSelect: (draftId: string) => void
  onEnter: (draftId: string) => void
  onCreate: () => void
  onConfigure: () => void
  onReviewRun: () => void
  onRename: (draftId: string, name: string) => Promise<void>
  onManage: () => void
  onRefresh: () => void
}

export function draftRecords(payload: { records?: DraftRecord[]; drafts?: DraftRecord[]; items?: DraftRecord[] } | null): DraftRecord[] {
  if (!payload) return []
  const records = payload.records ?? payload.drafts ?? payload.items ?? []
  return records
    .filter((draft) => typeof draft.id === 'string' && draft.id.length > 0)
    .map((draft) => ({
      ...draft,
      source_id: draft.source_id || draft.source_item_id,
      source_type: draft.source_type || draft.source_item_type,
    }))
}

function draftStatus(draft: DraftRecord, detail: ResourceDetail | null, selected: boolean) {
  if (selected && detail) return resourceStatus(detail)
  if (typeof draft.status === 'string') return draft.status
  if (typeof draft.state === 'string') return draft.state
  if (draft.case_id) return 'submitted'
  return 'draft'
}

export default function ProjectDraftBar({
  mode,
  drafts,
  selectedId,
  selectedDetail,
  loading,
  detailLoading,
  error,
  onSelect,
  onEnter,
  onCreate,
  onConfigure,
  onReviewRun,
  onRename,
  onManage,
  onRefresh,
}: Props) {
  const { t } = useI18n()
  const activeDraft = drafts.find((draft) => draft.id === selectedId) ?? null
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')
  const [renameBusy, setRenameBusy] = useState(false)
  const [renameError, setRenameError] = useState('')

  useEffect(() => {
    setEditingName(false)
    setName(activeDraft?.name ?? '')
    setRenameError('')
  }, [activeDraft?.id, activeDraft?.name])

  const startRename = () => {
    setName(activeDraft?.name ?? '')
    setRenameError('')
    setEditingName(true)
  }

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    const nextName = name.trim()
    if (!activeDraft || !nextName || renameBusy) return
    setRenameBusy(true)
    setRenameError('')
    try {
      await onRename(activeDraft.id, nextName)
      setEditingName(false)
    } catch (cause) {
      setRenameError(String(cause).replace('Error: ', '') || t('Could not rename this Draft.'))
    } finally {
      setRenameBusy(false)
    }
  }

  if (mode === 'resource') {
    const projectDraft = drafts.find((draft) => draft.id === selectedId) ?? drafts[0]
    const unavailable = !loading && Boolean(error)
    const hasDrafts = drafts.length > 0
    const label = loading
      ? 'Loading Drafts…'
      : unavailable
        ? 'Drafts unavailable'
        : hasDrafts
          ? `Drafts ${drafts.length}`
          : 'Create Draft'

    return (
      <section className="project-draft-entry" aria-label="Draft workspace" aria-busy={loading}>
        <button
          type="button"
          className="project-draft-entry__primary"
          aria-label={hasDrafts ? `Open ${drafts.length} Drafts in this Project` : 'Create Draft from this Resource'}
          disabled={loading || unavailable}
          onClick={() => hasDrafts && projectDraft ? onEnter(projectDraft.id) : onCreate()}
        >
          <span className="project-draft-entry__icon">
            {hasDrafts ? <GitPullRequestDraft size={15} /> : <Plus size={15} />}
          </span>
          <span className="project-draft-entry__copy">
            <strong>{label}</strong>
          </span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <HelpTooltip label="About Project Drafts" placement="bottom" align="end">
          {hasDrafts
            ? 'Drafts are editable configurations. Open one to inspect parameters, review changes, or run it.'
            : 'A Draft is an editable configuration created from this Resource. Creating one does not start a remote run.'}
        </HelpTooltip>
        <button type="button" className="project-draft-entry__refresh" onClick={onManage} aria-label={t('Manage Drafts')} title={t('Manage Drafts')}>
          <Settings2 size={14} />
        </button>
        {unavailable && (
          <button type="button" className="project-draft-entry__refresh" onClick={onRefresh} aria-label="Retry loading Drafts" title="Retry loading Drafts">
            <RefreshCw size={14} />
          </button>
        )}
      </section>
    )
  }

  return (
    <section className="project-draft-inline" aria-label="Project drafts" aria-busy={loading}>
      <div className="project-draft-heading" aria-label="Draft mode">
        <span className="project-draft-heading__icon"><GitPullRequestDraft size={15} /></span>
        <strong>Draft</strong>
        <HelpTooltip label="About Draft mode" placement="bottom">
          Draft mode lets you edit parameters and review changes before any Flow360 execution.
        </HelpTooltip>
      </div>

      <div className="project-draft-select">
        {editingName ? (
          <form className="project-draft-rename" onSubmit={submitRename}>
            <input
              aria-label={t('Draft name')}
              value={name}
              maxLength={128}
              autoFocus
              disabled={renameBusy}
              onChange={(event) => setName(event.target.value)}
            />
            <button type="submit" disabled={!name.trim() || renameBusy} aria-label={t('Save Draft name')} title={t('Save Draft name')}>
              {renameBusy ? <RefreshCw size={13} className="spin" /> : <Check size={13} />}
            </button>
            <button
              type="button"
              disabled={renameBusy}
              aria-label={t('Cancel renaming Draft')}
              title={t('Cancel renaming Draft')}
              onClick={() => setEditingName(false)}
            >
              <X size={13} />
            </button>
            {renameError && <span role="alert">{renameError}</span>}
          </form>
        ) : (
        <select
          aria-label="Switch active Draft"
          value={selectedId}
          disabled={loading || drafts.length === 0}
          onChange={(event) => onSelect(event.target.value)}
        >
          {loading && <option value="">Loading Drafts…</option>}
          {!loading && drafts.length === 0 && <option value="">{error || 'No Drafts'}</option>}
          {!loading && drafts.map((draft) => {
            const active = draft.id === selectedId
            const status = draftStatus(draft, selectedDetail, active)
            return (
              <option key={draft.id} value={draft.id}>
                {draft.name || 'Untitled Draft'} · {status}
              </option>
            )
          })}
        </select>
        )}
      </div>

      <div className="project-draft-actions">
        <button type="button" className="project-draft-utility" onClick={onManage} title={t('Manage Drafts')} aria-label={t('Manage Drafts')}>
          <Settings2 size={14} />
          <span>{t('Manage')}</span>
        </button>
        <button
          type="button"
          className="project-draft-utility"
          onClick={startRename}
          disabled={!activeDraft || detailLoading || editingName}
          title={t('Rename Draft')}
          aria-label={t('Rename Draft')}
        >
          <Pencil size={14} />
          <span>{t('Rename')}</span>
        </button>
        <button
          type="button"
          onClick={onConfigure}
          disabled={!selectedId || detailLoading}
          title={t('Edit, validate, save, and optionally run this Draft')}
          className="project-draft-configure"
        >
          <SlidersHorizontal size={14} />
          <span>{detailLoading ? t('Reading…') : t('Configure Draft')}</span>
        </button>
        <button
          type="button"
          onClick={onReviewRun}
          disabled={!selectedId || detailLoading}
          title={t('Review and run this Draft')}
          aria-label={t('Run this Draft')}
          className="project-draft-run"
        >
          <Play size={14} />
          <span>{t('Run')}</span>
        </button>
      </div>
    </section>
  )
}
