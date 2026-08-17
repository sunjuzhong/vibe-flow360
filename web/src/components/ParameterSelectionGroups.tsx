import { CheckSquare2, Eye, EyeOff, Layers3, MinusSquare } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../i18n'
import type { ParameterSelectionPreset } from '../lib/parameterSelectionGroups'
import { ManifestMemberGroup } from './ManifestMemberGroup'
import { mergeSelectedResourceIds, removeSelectedResourceIds } from './ResourceSelectionToolbar'

export function nextParameterPresetSelection(
  selectedIds: readonly string[],
  memberIds: readonly string[],
  additive: boolean,
): string[] {
  const uniqueMembers = [...new Set(memberIds)]
  if (!additive) return uniqueMembers
  const selected = new Set(selectedIds)
  return uniqueMembers.every((id) => selected.has(id))
    ? removeSelectedResourceIds(selectedIds, uniqueMembers)
    : mergeSelectedResourceIds(selectedIds, uniqueMembers)
}

export function ParameterSelectionGroups({
  presets,
  selectedIds,
  visibility,
  onSelectionChange,
  onSetVisibility,
}: {
  presets: ParameterSelectionPreset[]
  selectedIds: readonly string[]
  visibility: Record<string, boolean>
  onSelectionChange: (ids: string[]) => void
  onSetVisibility: (ids: string[], visible: boolean) => void
}) {
  const { t } = useI18n()
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  if (presets.length === 0) return null

  return (
    <ManifestMemberGroup
      label={t('Selection groups')}
      memberLabel={t('selection groups')}
      icon={<Layers3 size={13} aria-hidden="true" />}
      total={presets.length}
      visibleCount={presets.length}
      defaultExpanded
      showVisibilityControl={false}
    >
      <div className="parameter-selection-groups">
        {presets.map((preset) => {
          const selectedCount = preset.memberIds.filter((id) => selectedSet.has(id)).length
          const selectionState = selectedCount === 0 ? 'false' : selectedCount === preset.memberIds.length ? 'true' : 'mixed'
          const anyVisible = preset.memberIds.some((id) => visibility[id] !== false)
          const SelectionIcon = selectionState === 'true' ? CheckSquare2 : selectionState === 'mixed' ? MinusSquare : Layers3
          return (
            <div className={`parameter-selection-group ${selectionState === 'true' ? 'selected' : selectionState === 'mixed' ? 'partial' : ''}`} key={preset.id}>
              <button
                type="button"
                className="parameter-selection-group__select"
                aria-pressed={selectionState}
                title={t('Select {name} · Ctrl, Cmd, or Shift-click to combine groups').replace('{name}', preset.label)}
                onClick={(event) => onSelectionChange(nextParameterPresetSelection(
                  selectedIds,
                  preset.memberIds,
                  event.ctrlKey || event.metaKey || event.shiftKey,
                ))}
              >
                <SelectionIcon size={13} aria-hidden="true" />
                <span><strong>{preset.label}</strong><small>{t('{count} items · {tag}').replace('{count}', String(preset.memberIds.length)).replace('{tag}', preset.tag)}</small></span>
              </button>
              <button
                type="button"
                className="parameter-selection-group__visibility"
                aria-label={t(anyVisible ? 'Hide group {name}' : 'Show group {name}').replace('{name}', preset.label)}
                aria-pressed={anyVisible}
                title={t(anyVisible ? 'Hide group {name}' : 'Show group {name}').replace('{name}', preset.label)}
                onClick={() => onSetVisibility(preset.memberIds, !anyVisible)}
              >
                {anyVisible ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
              </button>
            </div>
          )
        })}
      </div>
    </ManifestMemberGroup>
  )
}
