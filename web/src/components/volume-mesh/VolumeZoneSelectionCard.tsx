import { Eye, EyeOff, Info, LocateFixed, ScanLine, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { VolumeZoneRow } from '../../lib/volumeMeshReview'

export function VolumeZoneSelectionCard({
  zone,
  visible,
  contextOnly,
  onFocus,
  onIsolate,
  onToggleVisibility,
  onShowAll,
  onClear,
}: {
  zone?: VolumeZoneRow
  visible: boolean
  contextOnly: boolean
  onFocus: () => void
  onIsolate: () => void
  onToggleVisibility: () => void
  onShowAll: () => void
  onClear: () => void
}) {
  const { t } = useI18n()

  return (
    <section className="geometry-selection-card volume-selection-card">
      <div className="geometry-section-title"><Info size={13} /> {t('Selection properties')}</div>
      {zone ? (
        <>
          <dl>
            <div className="volume-selection-name"><dt>{t('Name')}</dt><dd title={zone.name}>{zone.name}</dd></div>
            <div><dt>{t('Type')}</dt><dd>{contextOnly ? t('Context surface') : t(zone.zoneType)}</dd></div>
            <div><dt>{t('Type evidence')}</dt><dd>{t(zone.typeProvenance)}</dd></div>
            <div><dt>{t('Rendered elements')}</dt><dd>{zone.triangles?.toLocaleString() ?? t('Not reported')}</dd></div>
            <div><dt>{t('Vertices')}</dt><dd>{zone.vertices?.toLocaleString() ?? t('Not reported')}</dd></div>
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
