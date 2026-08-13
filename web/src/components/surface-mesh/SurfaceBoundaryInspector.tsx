import { useMemo, useState } from 'react'
import { ChevronDown, Eye, EyeOff, Layers3, Search, Square, SquareCheckBig } from 'lucide-react'
import type { SurfaceBoundaryRow } from '../../lib/surfaceMeshReview'
import { ManifestMemberGroup } from '../ManifestMemberGroup'
import { useI18n } from '../../i18n'

export type SurfaceBoundaryFilter = 'all' | SurfaceBoundaryRow['status']

const initialVisibleCount = 20

export function filterSurfaceBoundaries(
  inventory: SurfaceBoundaryRow[],
  query: string,
  filter: SurfaceBoundaryFilter,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return inventory.filter((row) => {
    if (filter !== 'all' && row.status !== filter) return false
    if (!normalizedQuery) return true
    const searchable = [
      row.id,
      row.name,
      ...row.assignments.flatMap((assignment) => [assignment.modelName, assignment.modelType]),
    ].join(' ').toLocaleLowerCase()
    return searchable.includes(normalizedQuery)
  })
}

export function SurfaceBoundaryInspector({
  inventory,
  selectedId,
  conflictCount,
  visibility,
  onSelect,
  onToggleVisibility,
  onShowAll,
  onHideAll,
  onClearSelection,
}: {
  inventory: SurfaceBoundaryRow[]
  selectedId: string | null
  conflictCount: number
  visibility: Record<string, boolean>
  onSelect: (groupId: string) => void
  onToggleVisibility: (groupId: string) => void
  onShowAll: () => void
  onHideAll: () => void
  onClearSelection: () => void
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SurfaceBoundaryFilter>('all')
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount)
  const filtered = useMemo(
    () => filterSurfaceBoundaries(inventory, query, filter),
    [filter, inventory, query],
  )
  const displayed = filtered.slice(0, visibleCount)
  const visibleBoundaryCount = inventory.filter((row) => visibility[row.id] !== false).length
  const counts = useMemo(() => ({
    assigned: inventory.filter((row) => row.status === 'assigned').length,
    unassigned: inventory.filter((row) => row.status === 'unassigned').length,
    conflict: inventory.filter((row) => row.status === 'conflict').length,
  }), [inventory])
  const filterSummary = filter === 'all'
    ? t('All · {count}').replace('{count}', String(inventory.length))
    : filter === 'assigned'
      ? t('Assigned · {count}').replace('{count}', String(counts.assigned))
      : filter === 'unassigned'
        ? t('Unassigned · {count}').replace('{count}', String(counts.unassigned))
        : t('Conflicts · {count}').replace('{count}', String(counts.conflict))

  const updateQuery = (value: string) => {
    setQuery(value)
    setVisibleCount(initialVisibleCount)
  }
  const updateFilter = (value: SurfaceBoundaryFilter) => {
    setFilter(value)
    setVisibleCount(initialVisibleCount)
  }

  return (
    <div className="surface-boundary-inspector">
      <ManifestMemberGroup
        label={t('Surface boundaries')}
        memberLabel={t('boundaries')}
        icon={<Layers3 size={13} aria-hidden="true" />}
        total={inventory.length}
        visibleCount={visibleBoundaryCount}
        onShowAll={onShowAll}
        onHideAll={onHideAll}
        defaultExpanded={false}
      >
        {inventory.length > 0 && (
          <details className="surface-boundary-filter-disclosure">
            <summary>
              <Search size={12} aria-hidden="true" />
              <span>{t('Search and filter')}</span>
              <small>{filterSummary}</small>
              <ChevronDown size={12} aria-hidden="true" />
            </summary>
            <div className="surface-boundary-tools">
              <label className="surface-boundary-search">
                <Search size={12} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  placeholder={t('Find face, model, or type')}
                  aria-label={t('Search SurfaceMesh boundaries')}
                  onChange={(event) => updateQuery(event.target.value)}
                />
              </label>
              <select
                value={filter}
                aria-label={t('Filter SurfaceMesh boundaries by assignment status')}
                onChange={(event) => updateFilter(event.target.value as SurfaceBoundaryFilter)}
              >
                <option value="all">{t('All · {count}').replace('{count}', String(inventory.length))}</option>
                <option value="assigned">{t('Assigned · {count}').replace('{count}', String(counts.assigned))}</option>
                <option value="unassigned">{t('Unassigned · {count}').replace('{count}', String(counts.unassigned))}</option>
                <option value="conflict">{t('Conflicts · {count}').replace('{count}', String(counts.conflict))}</option>
              </select>
              <span>{t('{shown} of {total} matching faces')
                .replace('{shown}', String(displayed.length))
                .replace('{total}', String(filtered.length))}</span>
            </div>
          </details>
        )}
        <div className="surface-boundary-list">
          {displayed.length > 0 ? displayed.map((row) => {
            const visible = visibility[row.id] !== false
            return (
            <div
              key={row.id}
              className={`geometry-entity-row surface-boundary-row ${row.status} ${selectedId === row.id ? 'selected' : ''} ${visible ? '' : 'hidden'}`}
            >
              <button
                type="button"
                className="surface-boundary-selection-toggle"
                role="checkbox"
                aria-checked={selectedId === row.id}
                aria-label={t(selectedId === row.id ? 'Clear selection' : 'Select {name}').replace('{name}', row.name)}
                onClick={() => selectedId === row.id ? onClearSelection() : onSelect(row.id)}
              >
                {selectedId === row.id ? <SquareCheckBig size={12} /> : <Square size={12} />}
              </button>
              <button
                type="button"
                className="geometry-entity-select surface-boundary-select"
                aria-pressed={selectedId === row.id}
                title={row.name}
                onClick={() => onSelect(row.id)}
              >
                <span title={row.name}>{row.name}</span>
                <small>
                  {row.assignments.length > 0
                    ? row.assignments.map((assignment) => `${assignment.modelName} · ${assignment.modelType}`).join(', ')
                    : t('Unassigned')}
                </small>
              </button>
              <div className="surface-boundary-row-actions">
                <button
                  type="button"
                  aria-label={t(`${visible ? 'Hide' : 'Show'} ${row.name}`)}
                  aria-pressed={!visible}
                  title={t(`${visible ? 'Hide' : 'Show'} ${row.name}`)}
                  onClick={() => onToggleVisibility(row.id)}
                >
                  {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </div>
            </div>
            )
          }) : (
            <p>{t(inventory.length > 0 ? 'No faces match the current search and status filter.' : 'No Face entities are present in the current render asset.')}</p>
          )}
        </div>
        {visibleCount < filtered.length && (
          <button
            type="button"
            className="surface-boundary-more"
            onClick={() => setVisibleCount((current) => current + initialVisibleCount)}
          >
            {t('Show {count} more faces').replace('{count}', String(Math.min(initialVisibleCount, filtered.length - visibleCount)))}
          </button>
        )}
      </ManifestMemberGroup>
      {conflictCount > 0 && filter !== 'conflict' && (
        <p className="surface-review-warning">{t('{count} face group(s) have multiple model assignments.').replace('{count}', String(conflictCount))}</p>
      )}
    </div>
  )
}
