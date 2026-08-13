export type ManifestVisibilityItem = {
  id: string
  path?: string[]
}

/**
 * Build an isolation map without breaking manifest hierarchy. A selected leaf
 * needs its ancestors visible, while a selected parent represents its visible
 * descendants as well.
 */
export function isolatedManifestVisibility(
  items: readonly ManifestVisibilityItem[],
  selectedItemIds: readonly string[],
): Record<string, boolean> {
  const availableIds = new Set(items.map((item) => item.id))
  const selectedIds = new Set(selectedItemIds.filter((id) => availableIds.has(id)))
  const selectedItems = items.filter((item) => selectedIds.has(item.id))

  return Object.fromEntries(items.map((item) => {
    const isSelected = selectedIds.has(item.id)
    const isAncestorOfSelection = selectedItems.some((selected) => selected.path?.includes(item.id))
    const isDescendantOfSelection = item.path?.some((ancestorId) => selectedIds.has(ancestorId)) ?? false
    return [item.id, isSelected || isAncestorOfSelection || isDescendantOfSelection]
  }))
}
