import { ChevronDown, Eye, EyeOff } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

export type ManifestMember = {
  id: string
  visible?: boolean
}

export function manifestVisibilityMap<T extends Pick<ManifestMember, 'id'>>(
  members: T[],
  visible: boolean,
): Record<string, boolean> {
  return Object.fromEntries(members.map((member) => [member.id, visible]))
}

export function visibleManifestMemberCount<T extends ManifestMember>(
  members: T[],
  visibility: Record<string, boolean>,
  defaultVisible = true,
): number {
  return members.filter((member) => visibility[member.id] ?? member.visible ?? defaultVisible).length
}

export function ManifestMemberGroup({
  label,
  memberLabel,
  icon,
  total,
  visibleCount,
  onShowAll,
  onHideAll,
  children,
  defaultExpanded = true,
}: {
  label: string
  memberLabel: string
  icon: ReactNode
  total: number
  visibleCount: number
  onShowAll: () => void
  onHideAll: () => void
  children: ReactNode
  defaultExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const contentId = useId()
  const bulkAction = visibleCount > 0 ? 'Hide' : 'Show'
  const BulkIcon = visibleCount > 0 ? EyeOff : Eye

  return (
    <section className="manifest-member-group">
      <div className="manifest-member-group__header">
        <button
          type="button"
          className="manifest-member-group__toggle"
          aria-controls={contentId}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
          onClick={() => setExpanded((current) => !current)}
        >
          <ChevronDown className="manifest-member-group__chevron" size={12} aria-hidden="true" />
          {icon}
          <strong>{label}</strong>
          <span title={`${visibleCount}/${total} visible`}>{visibleCount}/{total}</span>
        </button>
        <button
          type="button"
          className="manifest-member-group__visibility"
          aria-label={`${bulkAction} all ${memberLabel}`}
          title={`${bulkAction} all ${memberLabel}`}
          disabled={total === 0}
          onClick={visibleCount > 0 ? onHideAll : onShowAll}
        >
          <BulkIcon size={14} aria-hidden="true" />
        </button>
      </div>
      <div id={contentId} className="manifest-member-group__content" hidden={!expanded}>
        {children}
      </div>
    </section>
  )
}
