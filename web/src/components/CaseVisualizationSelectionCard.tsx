import { Eye, EyeOff, Info, LocateFixed, ScanLine, X } from 'lucide-react'
import { useI18n } from '../i18n'
import { ResourceReviewLaunchers, ResourceReviewToggle } from './ResourceReviewDialog'

export type CaseVisualizationSelectionCardItem = {
  name: string
  typeLabel: string
  triangles?: number
  vertices?: number
  entityIds: string[]
}

export function CaseVisualizationSelectionCard({
  items,
  visible,
  fieldNames,
  fieldVisualizationEnabled,
  activeField,
  onFocus,
  onIsolate,
  onToggleVisibility,
  onShowAll,
  onClear,
  onFieldVisualizationChange,
}: {
  items: CaseVisualizationSelectionCardItem[]
  visible: boolean
  fieldNames: string[]
  fieldVisualizationEnabled: boolean
  activeField: string | null
  onFocus: () => void
  onIsolate: () => void
  onToggleVisibility: () => void
  onShowAll: () => void
  onClear: () => void
  onFieldVisualizationChange: (enabled: boolean) => void
}) {
  const { t } = useI18n()
  const item = items[0]
  const multiple = items.length > 1
  const typeLabels = [...new Set(items.map((candidate) => candidate.typeLabel))]
  const triangles = items.every((candidate) => candidate.triangles !== undefined)
    ? items.reduce((total, candidate) => total + (candidate.triangles ?? 0), 0)
    : undefined
  const vertices = items.every((candidate) => candidate.vertices !== undefined)
    ? items.reduce((total, candidate) => total + (candidate.vertices ?? 0), 0)
    : undefined
  const entityIds = items.flatMap((candidate) => candidate.entityIds)
  return (
    <section className="volume-context-panel case-selection-context" aria-label={t('Available actions for this selection')}>
      <section className="geometry-selection-card case-selection-card volume-selection-card">
        <div className="geometry-section-title"><Info size={13} /> {t('Selection properties')}</div>
        <dl>
          <div><dt>{multiple ? t('Selection') : t('Name')}</dt><dd title={items.map((candidate) => candidate.name).join(', ')}>{multiple ? t('{count} items selected').replace('{count}', String(items.length)) : item.name}</dd></div>
          <div><dt>{t('Type')}</dt><dd>{typeLabels.join(', ')}</dd></div>
          <div><dt>{t('Rendered elements')}</dt><dd>{triangles?.toLocaleString() ?? t('Not reported')}</dd></div>
          <div><dt>{t('Vertices')}</dt><dd>{vertices?.toLocaleString() ?? t('Not reported')}</dd></div>
          {fieldNames.length > 0 && (
            <div><dt>{t('Selected field')}</dt><dd>{fieldVisualizationEnabled ? activeField ?? t('None selected') : t('Disabled')}</dd></div>
          )}
        </dl>
        {entityIds.length > 0 && (
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
        )}
      </section>
      {fieldNames.length > 0 && (
        <ResourceReviewLaunchers>
          <ResourceReviewToggle
            label={t('Field visualization')}
            summary={t('{count} fields available').replace('{count}', String(fieldNames.length))}
            checked={fieldVisualizationEnabled}
            onChange={onFieldVisualizationChange}
          />
        </ResourceReviewLaunchers>
      )}
    </section>
  )
}
