import { useMemo } from 'react'
import { CheckSquare2, Square, X } from 'lucide-react'
import { useI18n } from '../i18n'

export function mergeSelectedResourceIds(selectedIds: readonly string[], targetIds: readonly string[]) {
  return [...new Set([...selectedIds, ...targetIds])]
}

export function removeSelectedResourceIds(selectedIds: readonly string[], targetIds: readonly string[]) {
  const targets = new Set(targetIds)
  return selectedIds.filter((id) => !targets.has(id))
}

export function ResourceSelectionToolbar({
  allIds,
  resultIds,
  selectedIds,
  filtered,
  onSelectionChange,
}: {
  allIds: readonly string[]
  resultIds: readonly string[]
  selectedIds: readonly string[]
  filtered: boolean
  onSelectionChange: (ids: string[]) => void
}) {
  const { t } = useI18n()
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const allResultsSelected = resultIds.length > 0 && resultIds.every((id) => selectedSet.has(id))
  const allItemsSelected = allIds.length > 0 && allIds.every((id) => selectedSet.has(id))
  const toggleResultLabel = allResultsSelected
    ? t(filtered ? 'Deselect results' : 'Deselect all')
    : t(filtered ? 'Select results' : 'Select all')

  return (
    <div className="resource-selection-toolbar" aria-label={t('Resource selection actions')}>
      <span>
        {t('{selected} selected · {results} results · {total} total')
          .replace('{selected}', String(selectedIds.length))
          .replace('{results}', String(resultIds.length))
          .replace('{total}', String(allIds.length))}
      </span>
      <div>
        <button
          type="button"
          disabled={resultIds.length === 0}
          aria-pressed={allResultsSelected}
          onClick={() => onSelectionChange(allResultsSelected
            ? removeSelectedResourceIds(selectedIds, resultIds)
            : mergeSelectedResourceIds(selectedIds, resultIds))}
        >
          {allResultsSelected ? <CheckSquare2 size={12} aria-hidden="true" /> : <Square size={12} aria-hidden="true" />}
          {toggleResultLabel}
        </button>
        {filtered && (
          <button
            type="button"
            disabled={allItemsSelected || allIds.length === 0}
            onClick={() => onSelectionChange([...allIds])}
          >
            <CheckSquare2 size={12} aria-hidden="true" />
            {t('Select all')}
          </button>
        )}
        <button
          type="button"
          disabled={selectedIds.length === 0}
          aria-label={t('Clear selection')}
          title={t('Clear selection')}
          onClick={() => onSelectionChange([])}
        >
          <X size={12} aria-hidden="true" />
          <span className="resource-selection-clear-label">{t('Clear')}</span>
        </button>
      </div>
    </div>
  )
}
