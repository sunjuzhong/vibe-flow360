import { Braces, ChevronRight, GitPullRequestDraft, Play, Plus, RefreshCw } from 'lucide-react'
import type { DraftRecord, ResourceDetail } from '../api/client'
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
  onInspect: () => void
  onReview: () => void
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
  onInspect,
  onReview,
  onRefresh,
}: Props) {
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
            <small>{hasDrafts ? 'Editable configurations in this Project' : 'Start an editable configuration'}</small>
          </span>
          <ChevronRight size={14} aria-hidden="true" />
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
        <span><GitPullRequestDraft size={15} /></span>
        <strong>Draft</strong>
      </div>

      <label className="project-draft-select">
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
      </label>

      <div className="project-draft-actions">
        <button
          type="button"
          onClick={onReview}
          disabled={!selectedId || detailLoading}
          title="Validate, review, and run this Draft"
        >
          <Play size={14} />
          <span>Review &amp; Run</span>
        </button>
        <button
          type="button"
          onClick={onInspect}
          disabled={!selectedId || detailLoading}
          title="Inspect active Draft parameters"
        >
          <Braces size={14} />
          <span>{detailLoading ? 'Reading…' : 'Parameters'}</span>
        </button>
        <button
          type="button"
          className="project-draft-refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh Drafts"
          title="Reload the Draft list and active Draft parameters"
        >
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>
    </section>
  )
}
