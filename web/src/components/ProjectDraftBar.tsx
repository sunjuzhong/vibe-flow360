import { Braces, ChevronDown, GitPullRequestDraft, RefreshCw } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
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
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const activeDraft = drafts.find((draft) => draft.id === selectedId) ?? null
  const activeName = activeDraft?.name || (loading ? 'Loading…' : 'No Draft')
  const activeStatus = activeDraft
    ? draftStatus(activeDraft, selectedDetail, true)
    : error || 'Unavailable'

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const selectDraft = (draftId: string) => {
    onSelect(draftId)
    setOpen(false)
  }

  const inspectDraft = () => {
    setOpen(false)
    onInspect()
  }

  return (
    <section ref={rootRef} className="project-draft-menu" aria-label="Project drafts" aria-busy={loading}>
      <button
        ref={triggerRef}
        type="button"
        className="project-draft-trigger"
        aria-label={`Open Draft menu, active Draft ${activeName}`}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="project-draft-trigger-icon"><GitPullRequestDraft size={15} /></span>
        <span className="project-draft-trigger-copy">
          <strong>Draft · {activeName}</strong>
          <small>{activeStatus}</small>
        </span>
        <ChevronDown className="project-draft-trigger-chevron" size={14} aria-hidden="true" />
      </button>

      <div id={menuId} className="project-draft-popover" role="group" aria-label="Draft menu" hidden={!open}>
        <div className="project-draft-active">
          <span>Active Draft</span>
          <strong>{activeName}</strong>
          <small><i aria-hidden="true" /> {activeStatus}</small>
        </div>

        <label className="project-draft-select">
          <span>Switch Draft</span>
          <select
            aria-label="Switch active Draft"
            value={selectedId}
            disabled={loading || drafts.length === 0}
            onChange={(event) => selectDraft(event.target.value)}
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
            onClick={inspectDraft}
            disabled={!selectedId || detailLoading}
            title="Inspect active Draft parameters"
          >
            <Braces size={14} />
            <span>{detailLoading ? 'Reading…' : 'Parameters'}</span>
          </button>
          <button type="button" onClick={onRefresh} disabled={loading} aria-label="Refresh Drafts" title="Reload the Draft list and active Draft parameters">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            <span>Refresh Drafts</span>
          </button>
        </div>
      </div>
    </section>
  )
}
