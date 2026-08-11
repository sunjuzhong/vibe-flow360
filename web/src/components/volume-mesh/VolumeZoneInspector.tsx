import { useMemo, useState } from 'react'
import { Search, Volume2 } from 'lucide-react'
import type { VolumeZoneRow, VolumeZoneType } from '../../lib/volumeMeshReview'
import { useI18n } from '../../i18n'
import { ManifestMemberGroup } from '../ManifestMemberGroup'

export type VolumeZoneFilter = 'all' | VolumeZoneType

const zoneTypeOrder: VolumeZoneType[] = ['fluid', 'rotation', 'porous', 'solid', 'farfield', 'unknown']

export function filterVolumeZones(inventory: VolumeZoneRow[], query: string, filter: VolumeZoneFilter) {
  const normalized = query.trim().toLocaleLowerCase()
  return inventory.filter((row) => {
    if (filter !== 'all' && row.zoneType !== filter) return false
    return !normalized || `${(row.path ?? []).join(' ')} ${row.id} ${row.name} ${row.zoneType}`.toLocaleLowerCase().includes(normalized)
  })
}

export function groupVolumeZones(inventory: VolumeZoneRow[]): Array<{ type: VolumeZoneType; zones: VolumeZoneRow[] }> {
  return zoneTypeOrder.flatMap((type) => {
    const zones = inventory.filter((zone) => zone.zoneType === type)
    return zones.length ? [{ type, zones }] : []
  })
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
  const grouped = useMemo(() => groupVolumeZones(filtered), [filtered])

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
        {grouped.map(({ type, zones }) => {
          const visibleCount = zones.filter((zone) => visibility[zone.id] !== false).length
          const ids = zones.map((zone) => zone.id)
          return (
            <ManifestMemberGroup
              label={contextOnly ? t('Geometry context surfaces') : t(type)}
              memberLabel={contextOnly ? t('surfaces') : t('regions')}
              icon={<Volume2 size={13} aria-hidden="true" />}
              total={zones.length}
              visibleCount={visibleCount}
              onShowAll={() => onSetVisibility(ids, true)}
              onHideAll={() => onSetVisibility(ids, false)}
              defaultExpanded={grouped.length === 1 || type === 'fluid'}
              key={type}
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
                        {zone.typeProvenance !== 'provided' && <em>{t(zone.typeProvenance === 'name-inferred' ? 'type inferred from name' : 'type not reported')}</em>}
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
