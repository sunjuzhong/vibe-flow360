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

export type ManifestMemberGroupVisibility = 'empty' | 'hidden' | 'visible'

export function manifestMemberGroupVisibility(
  total: number,
  visibleCount: number,
): ManifestMemberGroupVisibility {
  if (total <= 0) return 'empty'
  return visibleCount > 0 ? 'visible' : 'hidden'
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
  showVisibilityControl = true,
}: {
  label: string
  memberLabel: string
  icon: ReactNode
  total: number
  visibleCount: number
  onShowAll?: () => void
  onHideAll?: () => void
  children: ReactNode
  defaultExpanded?: boolean
  showVisibilityControl?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const contentId = useId()
  const visibilityState = manifestMemberGroupVisibility(total, visibleCount)
  const hasVisibleMembers = visibilityState === 'visible'
  const bulkAction = hasVisibleMembers ? 'Hide' : 'Show'
  // The icon communicates the current aggregate state; the accessible label
  // communicates the action that clicking it will perform.
  const VisibilityIcon = hasVisibleMembers ? Eye : EyeOff

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
          {showVisibilityControl
            ? <span title={`${visibleCount}/${total} visible`}>{visibleCount}/{total}</span>
            : <span>{total}</span>}
        </button>
        {showVisibilityControl && (
          <button
            type="button"
            className="manifest-member-group__visibility"
            aria-label={`${bulkAction} all ${memberLabel}`}
            title={`${bulkAction} all ${memberLabel}`}
            aria-pressed={hasVisibleMembers}
            data-visibility-state={visibilityState}
            disabled={visibilityState === 'empty'}
            onClick={hasVisibleMembers ? onHideAll : onShowAll}
          >
            <VisibilityIcon size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      <div id={contentId} className="manifest-member-group__content" hidden={!expanded}>
        {children}
      </div>
    </section>
  )
}
