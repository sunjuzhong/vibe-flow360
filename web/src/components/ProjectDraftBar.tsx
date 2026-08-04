import { Braces, GitPullRequestDraft, RefreshCw } from 'lucide-react'
import type { DraftRecord, ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'

type Props = {
  drafts: DraftRecord[]
  selectedId: string
  selectedDetail: ResourceDetail | null
  loading: boolean
  detailLoading: boolean
  error: string
  onSelect: (draftId: string) => void
  onInspect: () => void
  onRefresh: () => void
}

export function draftRecords(payload: { records?: DraftRecord[]; drafts?: DraftRecord[]; items?: DraftRecord[] } | null): DraftRecord[] {
  if (!payload) return []
  const records = payload.records ?? payload.drafts ?? payload.items ?? []
  return records.filter((draft) => typeof draft.id === 'string' && draft.id.length > 0)
}

function draftStatus(draft: DraftRecord, detail: ResourceDetail | null, selected: boolean) {
  if (selected && detail) return resourceStatus(detail)
  if (typeof draft.status === 'string') return draft.status
  if (typeof draft.state === 'string') return draft.state
  if (draft.case_id) return 'submitted'
  return 'draft'
}

export default function ProjectDraftBar({
  drafts,
  selectedId,
  selectedDetail,
  loading,
  detailLoading,
  error,
  onSelect,
  onInspect,
  onRefresh,
}: Props) {
  return (
    <section className="project-draft-bar" aria-label="Project drafts" aria-busy={loading}>
      <div className="project-draft-heading">
        <span><GitPullRequestDraft size={15} /></span>
        <div>
          <strong>Drafts</strong>
          <small>{loading ? 'Loading…' : `${drafts.length} configuration${drafts.length === 1 ? '' : 's'}`}</small>
        </div>
      </div>

      <div className="project-draft-list" role="listbox" aria-label="Switch active Draft">
        {!loading && drafts.map((draft) => {
          const active = draft.id === selectedId
          const status = draftStatus(draft, selectedDetail, active)
          return (
            <button
              type="button"
              role="option"
              aria-selected={active}
              className={active ? 'active' : ''}
              key={draft.id}
              onClick={() => onSelect(draft.id)}
              title={`${draft.name || draft.id} · ${status}`}
            >
              <span className={`draft-state-dot status-${status.toLowerCase()}`} />
              <span>
                <strong>{draft.name || 'Untitled Draft'}</strong>
                <small>{status}</small>
              </span>
            </button>
          )
        })}
        {!loading && !drafts.length && (
          <div className="project-draft-empty">
            {error || 'No remote Drafts yet. New configurations appear here before they are run.'}
          </div>
        )}
      </div>

      <div className="project-draft-actions">
        <button
          type="button"
          onClick={onInspect}
          disabled={!selectedId || detailLoading}
          title="Inspect active Draft parameters"
        >
          <Braces size={14} />
          <span>{detailLoading ? 'Reading…' : 'Parameters'}</span>
        </button>
        <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh Drafts" title="Refresh Drafts">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>
    </section>
  )
}
