import { CheckSquare2, ChevronDown, Eye, EyeOff, Layers3, MinusSquare } from 'lucide-react'
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
  const presetSets = useMemo(() => {
    const grouped = new Map<string, ParameterSelectionPreset[]>()
    for (const preset of presets) grouped.set(preset.tag, [...(grouped.get(preset.tag) ?? []), preset])
    return [...grouped]
  }, [presets])
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
        {presetSets.map(([tag, tagPresets]) => (
          <details className="parameter-selection-set" key={tag} open>
            <summary className="parameter-selection-set__toggle">
              <ChevronDown size={11} aria-hidden="true" />
              <strong>{t(parameterSelectionTagLabel(tag))}</strong>
              <small>{tag}</small>
            </summary>
            <div className="parameter-selection-set__content">
              {tagPresets.map((preset) => {
          const available = preset.available !== false && preset.memberIds.length > 0
          const selectedCount = preset.memberIds.filter((id) => selectedSet.has(id)).length
          const selectionState = selectedCount === 0 ? 'false' : selectedCount === preset.memberIds.length ? 'true' : 'mixed'
          const anyVisible = preset.memberIds.some((id) => visibility[id] !== false)
          const SelectionIcon = selectionState === 'true' ? CheckSquare2 : selectionState === 'mixed' ? MinusSquare : Layers3
          const subsets = [
            { label: t('Faces'), ids: preset.faceIds ?? [] },
            { label: t('Edges'), ids: preset.edgeIds ?? [] },
          ].filter((subset) => subset.ids.length > 0)
          return (
            <div className={`parameter-selection-group ${selectionState === 'true' ? 'selected' : selectionState === 'mixed' ? 'partial' : ''} ${available ? '' : 'unavailable'}`} key={preset.id}>
              <button
                type="button"
                className="parameter-selection-group__select"
                aria-pressed={selectionState}
                disabled={!available}
                title={t('Select {name} · Ctrl, Cmd, or Shift-click to combine groups').replace('{name}', preset.label)}
                onClick={(event) => onSelectionChange(nextParameterPresetSelection(
                  selectedIds,
                  preset.memberIds,
                  event.ctrlKey || event.metaKey || event.shiftKey,
                ))}
              >
                <SelectionIcon size={13} aria-hidden="true" />
                <span><strong>{preset.label}</strong><small>{available
                  ? t('{count} items').replace('{count}', String(preset.memberIds.length))
                  : t('Unavailable')}
                </small></span>
              </button>
              <button
                type="button"
                className="parameter-selection-group__visibility"
                disabled={!available}
                aria-label={t(anyVisible ? 'Hide group {name}' : 'Show group {name}').replace('{name}', preset.label)}
                aria-pressed={anyVisible}
                title={t(anyVisible ? 'Hide group {name}' : 'Show group {name}').replace('{name}', preset.label)}
                onClick={() => onSetVisibility(preset.memberIds, !anyVisible)}
              >
                {anyVisible ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
              </button>
              {subsets.length > 1 && (
                <div className="parameter-selection-group__children">
                  {subsets.map((subset) => {
                    const subsetSelected = subset.ids.filter((id) => selectedSet.has(id)).length
                    const subsetState = subsetSelected === 0 ? 'false' : subsetSelected === subset.ids.length ? 'true' : 'mixed'
                    return (
                      <button
                        type="button"
                        key={subset.label}
                        aria-pressed={subsetState}
                        disabled={!available}
                        onClick={(event) => onSelectionChange(nextParameterPresetSelection(
                          selectedIds,
                          subset.ids,
                          event.ctrlKey || event.metaKey || event.shiftKey,
                        ))}
                      >
                        {subset.label}<small>{subset.ids.length}</small>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
              })}
            </div>
          </details>
        ))}
      </div>
    </ManifestMemberGroup>
  )
}

export function parameterSelectionTagLabel(tag: string): string {
  if (tag === 'builtinName') return 'Named surfaces'
  if (tag === 'groupByBodyId') return 'By body'
  if (tag === 'bodyId') return 'Bodies'
  if (tag === 'groupByFile') return 'By file'
  if (tag === 'groupName') return 'Named groups'
  return tag.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (value) => value.toUpperCase())
}
