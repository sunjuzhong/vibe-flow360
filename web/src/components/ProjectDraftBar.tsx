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
    <section className="project-draft-inline" aria-label="Project drafts" aria-busy={loading}>
      <div className="project-draft-heading">
        <span><GitPullRequestDraft size={15} /></span>
        <strong>Draft</strong>
      </div>

      <label className="project-draft-select">
        <span>Active Draft</span>
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
