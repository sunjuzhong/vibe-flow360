import { useMemo, useState } from 'react'
import { Eye, EyeOff, Focus, Layers3, Search, Square, SquareCheckBig } from 'lucide-react'
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
  selectedBoundary,
  conflictCount,
  visibility,
  onSelect,
  onIsolate,
  onToggleVisibility,
  onShowAll,
  onHideAll,
  onClearSelection,
}: {
  inventory: SurfaceBoundaryRow[]
  selectedId: string | null
  selectedBoundary?: SurfaceBoundaryRow
  conflictCount: number
  visibility: Record<string, boolean>
  onSelect: (groupId: string) => void
  onIsolate: (groupId: string) => void
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
      {inventory.length > 0 && (
        <div className="surface-boundary-tools">
          <label className="surface-boundary-search">
            <Search size={12} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Find face, model, or type"
              aria-label="Search SurfaceMesh boundaries"
              onChange={(event) => updateQuery(event.target.value)}
            />
          </label>
          <select
            value={filter}
            aria-label="Filter SurfaceMesh boundaries by assignment status"
            onChange={(event) => updateFilter(event.target.value as SurfaceBoundaryFilter)}
          >
            <option value="all">All · {inventory.length}</option>
            <option value="assigned">Assigned · {counts.assigned}</option>
            <option value="unassigned">Unassigned · {counts.unassigned}</option>
            <option value="conflict">Conflicts · {counts.conflict}</option>
          </select>
          <span>{displayed.length} of {filtered.length} matching faces</span>
        </div>
      )}
      {inventory.length > 0 && (
        <div className="geometry-selection-tools surface-boundary-selection-tools">
          <strong>{t(selectedBoundary ? '1 face selected' : '0 faces selected')}</strong>
          <button type="button" disabled={!selectedBoundary} onClick={onClearSelection}>
            {t('Clear')}
          </button>
        </div>
      )}
      <ManifestMemberGroup
        label="Surface boundaries"
        memberLabel="boundaries"
        icon={<Layers3 size={13} aria-hidden="true" />}
        total={inventory.length}
        visibleCount={visibleBoundaryCount}
        onShowAll={onShowAll}
        onHideAll={onHideAll}
        defaultExpanded={false}
      >
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
                    : 'Unassigned'}
                </small>
                <em>{row.status} · {row.triangles?.toLocaleString() ?? '—'} triangles</em>
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
                <button
                  type="button"
                  aria-label={t(`Isolate ${row.name}`)}
                  title={t(`Isolate ${row.name}`)}
                  onClick={() => onIsolate(row.id)}
                >
                  <Focus size={12} />
                </button>
              </div>
            </div>
            )
          }) : (
            <p>{inventory.length > 0 ? 'No faces match the current search and status filter.' : 'No Face entities are present in the current render asset.'}</p>
          )}
        </div>
        {visibleCount < filtered.length && (
          <button
            type="button"
            className="surface-boundary-more"
            onClick={() => setVisibleCount((current) => current + initialVisibleCount)}
          >
            Show {Math.min(initialVisibleCount, filtered.length - visibleCount)} more faces
          </button>
        )}
      </ManifestMemberGroup>
      {conflictCount > 0 && filter !== 'conflict' && (
        <p className="surface-review-warning">{conflictCount} face group(s) have multiple model assignments.</p>
      )}
    </div>
  )
}
