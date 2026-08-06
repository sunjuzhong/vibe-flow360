import { useMemo, useState } from 'react'
import { Eye, EyeOff, Focus, Search, Volume2 } from 'lucide-react'
import type { VolumeZoneRow, VolumeZoneType } from '../../lib/volumeMeshReview'
import { ManifestMemberGroup } from '../ManifestMemberGroup'

export type VolumeZoneFilter = 'all' | VolumeZoneType

export function filterVolumeZones(inventory: VolumeZoneRow[], query: string, filter: VolumeZoneFilter) {
  const normalized = query.trim().toLocaleLowerCase()
  return inventory.filter((row) => {
    if (filter !== 'all' && row.zoneType !== filter) return false
    return !normalized || `${row.id} ${row.name} ${row.zoneType}`.toLocaleLowerCase().includes(normalized)
  })
}

export function VolumeZoneInspector({
  inventory,
  selectedId,
  visibility,
  onSelect,
  onIsolate,
  onToggleVisibility,
  onShowAll,
  onHideAll,
  contextOnly = false,
}: {
  inventory: VolumeZoneRow[]
  selectedId: string | null
  visibility: Record<string, boolean>
  onSelect: (groupId: string) => void
  onIsolate: (groupId: string) => void
  onToggleVisibility: (groupId: string) => void
  onShowAll: () => void
  onHideAll: () => void
  contextOnly?: boolean
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<VolumeZoneFilter>('all')
  const filtered = useMemo(() => filterVolumeZones(inventory, query, filter), [filter, inventory, query])
  const visibleCount = inventory.filter((zone) => visibility[zone.id] !== false).length
  const counts = useMemo(() => Object.fromEntries(
    ['fluid', 'solid', 'rotation', 'porous', 'farfield', 'unknown'].map((type) => [
      type,
      inventory.filter((zone) => zone.zoneType === type).length,
    ]),
  ), [inventory])

  return (
    <div className="volume-zone-inspector">
      {inventory.length > 0 && (
        <div className="volume-zone-tools">
          <label className="volume-zone-search">
            <Search size={12} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder="Find zone or region"
              aria-label="Search VolumeMesh zones"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            value={filter}
            aria-label="Filter VolumeMesh zones by type"
            onChange={(event) => setFilter(event.target.value as VolumeZoneFilter)}
          >
            <option value="all">All · {inventory.length}</option>
            {(['fluid', 'solid', 'rotation', 'porous', 'farfield', 'unknown'] as const).map((type) => (
              <option value={type} key={type}>{type} · {counts[type]}</option>
            ))}
          </select>
          <span>{filtered.length} matching region{filtered.length === 1 ? '' : 's'}</span>
        </div>
      )}
      <ManifestMemberGroup
        label={contextOnly ? 'Geometry context surfaces' : 'Cell zones and regions'}
        memberLabel={contextOnly ? 'surfaces' : 'regions'}
        icon={<Volume2 size={13} aria-hidden="true" />}
        total={inventory.length}
        visibleCount={visibleCount}
        onShowAll={onShowAll}
        onHideAll={onHideAll}
      >
        <div className="volume-zone-list">
          {filtered.map((zone) => {
            const visible = visibility[zone.id] !== false
            return (
              <div
                className={`volume-zone-row ${selectedId === zone.id ? 'selected' : ''} ${visible ? '' : 'hidden'}`}
                key={zone.id}
              >
                <button type="button" className="volume-zone-select" onClick={() => onSelect(zone.id)}>
                  <span className="viewer-color-swatch" style={{ background: zone.color }} />
                  <strong>{zone.name}</strong>
                  <small>{contextOnly ? 'context surface' : zone.zoneType} · {zone.triangles?.toLocaleString() ?? '—'} rendered elements</small>
                  {zone.typeProvenance !== 'provided' && <em>{zone.typeProvenance === 'name-inferred' ? 'type inferred from name' : 'type not reported'}</em>}
                </button>
                <div className="volume-zone-actions">
                  <button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${zone.name}`} onClick={() => onToggleVisibility(zone.id)}>
                    {visible ? <Eye size={12} /> : <EyeOff size={12} />}
                  </button>
                  <button type="button" aria-label={`Isolate ${zone.name}`} onClick={() => onIsolate(zone.id)}>
                    <Focus size={12} />
                  </button>
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && <p>{inventory.length ? 'No zones match the current filters.' : 'No VolumeMesh zones were reported.'}</p>}
        </div>
      </ManifestMemberGroup>
    </div>
  )
}
