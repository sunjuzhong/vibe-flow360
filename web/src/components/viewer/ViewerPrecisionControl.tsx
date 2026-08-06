export type ViewerPrecisionSelection = 'default' | number

export function commonPrecisionLevels(
  entityLODs: Record<string, { levels: number }>,
): number {
  const multiLevelCounts = Object.values(entityLODs)
    .map((entity) => entity.levels)
    .filter((levels) => levels > 1)
  return multiLevelCounts.length > 0 ? Math.min(...multiLevelCounts) : 1
}

export function precisionLevelLabel(level: number, levels: number): string {
  if (level === 0) return `Highest detail · L${level}`
  if (level === levels - 1) return `Lowest detail · L${level}`
  return `Detail level ${level + 1} · L${level}`
}

export function ViewerPrecisionControl({
  levels,
  currentLevel,
  selection,
  unavailableLevels = new Set<number>(),
  disabled = false,
  onChange,
}: {
  levels: number
  currentLevel: number
  selection: ViewerPrecisionSelection
  unavailableLevels?: ReadonlySet<number>
  disabled?: boolean
  onChange: (selection: ViewerPrecisionSelection) => void
}) {
  if (levels <= 1) return null

  return (
    <label className="viewer-precision-control" title="Select manifest mesh precision">
      <span>Precision</span>
      <select
        aria-label="Mesh precision"
        disabled={disabled}
        value={selection === 'default' ? 'default' : String(selection)}
        onChange={(event) => onChange(event.target.value === 'default' ? 'default' : Number(event.target.value))}
      >
        <option value="default">Manifest default · L{currentLevel}</option>
        {Array.from({ length: levels }, (_, level) => (
          <option key={level} value={level} disabled={unavailableLevels.has(level)}>
            {precisionLevelLabel(level, levels)}{unavailableLevels.has(level) ? ' · unavailable' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
