export type ViewerMaterialAppearance = { color: string; opacity: number }

export function resolveViewerMaterialStyle(
  defaultColor: string,
  appearance: ViewerMaterialAppearance | undefined,
  selected: boolean,
  visible: boolean,
) {
  return {
    color: appearance?.color ?? defaultColor,
    opacity: visible ? (appearance?.opacity ?? 0.9) : 0.15,
    emissive: selected ? '#d59a2d' : '#000000',
    emissiveIntensity: selected ? 0.16 : 0,
  }
}
