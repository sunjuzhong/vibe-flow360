import { useMemo, useState } from 'react'
import { Search, Volume2 } from 'lucide-react'
import type { VolumeZoneRow, VolumeZoneType } from '../../lib/volumeMeshReview'
import { useI18n } from '../../i18n'
import { ManifestMemberGroup } from '../ManifestMemberGroup'

export type VolumeZoneFilter = 'all' | VolumeZoneType

export function filterVolumeZones(inventory: VolumeZoneRow[], query: string, filter: VolumeZoneFilter) {
  const normalized = query.trim().toLocaleLowerCase()
  return inventory.filter((row) => {
    if (filter !== 'all' && row.zoneType !== filter) return false
    return !normalized || `${(row.path ?? []).join(' ')} ${row.id} ${row.name} ${row.zoneType}`.toLocaleLowerCase().includes(normalized)
  })
}

export function volumeManifestGroup(zone: VolumeZoneRow): string {
  return zone.path?.[0]?.trim() || 'Other'
}

export function volumeManifestGroupLabel(group: string): string {
  if (group === 'Other') return group
  return group
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
}

export function groupVolumeZones(inventory: VolumeZoneRow[]): Array<{ group: string; zones: VolumeZoneRow[] }> {
  const grouped = new Map<string, VolumeZoneRow[]>()
  for (const zone of inventory) {
    const group = volumeManifestGroup(zone)
    const zones = grouped.get(group)
    if (zones) zones.push(zone)
    else grouped.set(group, [zone])
  }
  return [...grouped].map(([group, zones]) => ({ group, zones }))
}

export function VolumeZoneInspector({
  inventory,
  selectedId,
  visibility,
  onSelect,
  onSetVisibility,
  contextOnly = false,
}: {
  inventory: VolumeZoneRow[]
  selectedId: string | null
  visibility: Record<string, boolean>
  onSelect: (groupId: string) => void
  onSetVisibility: (groupIds: string[], visible: boolean) => void
  contextOnly?: boolean
}) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => filterVolumeZones(inventory, query, 'all'), [inventory, query])
  const grouped = useMemo(() => contextOnly
    ? [{ group: 'geometry-context', zones: filtered }]
    : groupVolumeZones(filtered), [contextOnly, filtered])

  return (
    <div className="volume-zone-inspector">
      {inventory.length > 0 && (
        <div className="volume-zone-tools">
          <label className="volume-zone-search">
            <Search size={12} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={t('Find zone or region')}
              aria-label={t('Search VolumeMesh zones')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {query && <span>{t('{count} matching regions').replace('{count}', String(filtered.length))}</span>}
        </div>
      )}
      <div className="volume-zone-groups">
        {grouped.map(({ group, zones }) => {
          const visibleCount = zones.filter((zone) => visibility[zone.id] !== false).length
          const ids = zones.map((zone) => zone.id)
          return (
            <ManifestMemberGroup
              label={contextOnly ? t('Geometry context surfaces') : t(volumeManifestGroupLabel(group))}
              memberLabel={contextOnly ? t('surfaces') : t('regions')}
              icon={<Volume2 size={13} aria-hidden="true" />}
              total={zones.length}
              visibleCount={visibleCount}
              onShowAll={() => onSetVisibility(ids, true)}
              onHideAll={() => onSetVisibility(ids, false)}
              defaultExpanded={grouped.length === 1}
              key={group}
            >
              <div className="volume-zone-list">
                {zones.map((zone) => {
                  const visible = visibility[zone.id] !== false
                  return (
                    <div
                      className={`volume-zone-row ${selectedId === zone.id ? 'selected' : ''} ${visible ? '' : 'hidden'}`}
                      key={zone.id}
                    >
                      <button
                        type="button"
                        className="volume-zone-select"
                        aria-pressed={selectedId === zone.id}
                        title={zone.name}
                        onClick={() => onSelect(zone.id)}
                      >
                        <span className="viewer-color-swatch" style={{ background: zone.color }} />
                        <strong>{zone.name}</strong>
                        <small>{zone.triangles?.toLocaleString() ?? '—'} {t('rendered elements')}</small>
                      </button>
                    </div>
                  )
                })}
              </div>
            </ManifestMemberGroup>
          )
        })}
        {filtered.length === 0 && <p className="volume-zone-empty">{t(inventory.length ? 'No zones match the current filters.' : 'No VolumeMesh zones were reported.')}</p>}
      </div>
    </div>
  )
}
