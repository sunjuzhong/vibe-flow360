import { Eye, EyeOff, Info, LocateFixed, ScanLine, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { VolumeZoneRow } from '../../lib/volumeMeshReview'

export function VolumeZoneSelectionCard({
  zones,
  visible,
  contextOnly,
  onFocus,
  onIsolate,
  onToggleVisibility,
  onShowAll,
  onClear,
}: {
  zones: VolumeZoneRow[]
  visible: boolean
  contextOnly: boolean
  onFocus: () => void
  onIsolate: () => void
  onToggleVisibility: () => void
  onShowAll: () => void
  onClear: () => void
}) {
  const { t } = useI18n()
  const zone = zones[0]
  const multiple = zones.length > 1
  const zoneTypes = [...new Set(zones.map((item) => contextOnly ? t('Context surface') : t(item.zoneType)))]
  const triangles = zones.every((item) => item.triangles !== undefined)
    ? zones.reduce((total, item) => total + (item.triangles ?? 0), 0)
    : undefined
  const vertices = zones.every((item) => item.vertices !== undefined)
    ? zones.reduce((total, item) => total + (item.vertices ?? 0), 0)
    : undefined

  return (
    <section className="geometry-selection-card volume-selection-card">
      <div className="geometry-section-title"><Info size={13} /> {t('Selection properties')}</div>
      {zone ? (
        <>
          <dl>
            <div className="volume-selection-name"><dt>{multiple ? t('Selection') : t('Name')}</dt><dd title={multiple ? zones.map((item) => item.name).join(', ') : zone.name}>{multiple ? t('{count} items selected').replace('{count}', String(zones.length)) : zone.name}</dd></div>
            <div><dt>{t('Type')}</dt><dd>{zoneTypes.join(', ')}</dd></div>
            {!multiple && <div><dt>{t('Type evidence')}</dt><dd>{t(zone.typeProvenance)}</dd></div>}
            <div><dt>{t('Rendered elements')}</dt><dd>{triangles?.toLocaleString() ?? t('Not reported')}</dd></div>
            <div><dt>{t('Vertices')}</dt><dd>{vertices?.toLocaleString() ?? t('Not reported')}</dd></div>
          </dl>
          <div className="volume-selection-actions" aria-label={t('Selection actions')}>
            <button type="button" onClick={onFocus}><LocateFixed size={12} /> {t('Focus')}</button>
            <button type="button" onClick={onIsolate}><ScanLine size={12} /> {t('Isolate')}</button>
            <button type="button" onClick={onToggleVisibility}>
              {visible ? <EyeOff size={12} /> : <Eye size={12} />}
              {visible ? t('Hide') : t('Show')}
            </button>
            <button type="button" onClick={onShowAll}><Eye size={12} /> {t('Show all')}</button>
            <button type="button" onClick={onClear}><X size={12} /> {t('Clear selection')}</button>
          </div>
        </>
      ) : (
        <p>{t('Select a cell zone or region in the inventory or 3D viewer.')}</p>
      )}
    </section>
  )
}
