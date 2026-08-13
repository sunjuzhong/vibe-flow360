export type SurfaceAppearance = { color: string; opacity: number }

const fallbackSurfaceColor = '#a9b7bc'

export function brightenSurfaceColor(color: string | undefined, amount = 0.4): string {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return fallbackSurfaceColor
  const value = Number.parseInt(color.slice(1), 16)
  const mix = Math.max(0, Math.min(1, amount))
  const channel = (shift: number) => {
    const original = value >> shift & 0xff
    return Math.round(original + (255 - original) * mix)
  }
  return `#${[channel(16), channel(8), channel(0)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')}`
}

export function buildSurfaceAppearances(
  boundaryIds: string[],
  colors: Record<string, string | undefined>,
  opacityOverrides: Record<string, number>,
): Record<string, SurfaceAppearance> {
  return Object.fromEntries(boundaryIds.map((id) => [id, {
    color: brightenSurfaceColor(colors[id]),
    opacity: opacityOverrides[id] ?? 1,
  }]))
}

export function applySurfaceOpacity(
  current: Record<string, number>,
  targetIds: string[],
  opacity: number,
): Record<string, number> {
  const normalized = Math.max(0.05, Math.min(1, opacity))
  return {
    ...current,
    ...Object.fromEntries(targetIds.map((id) => [id, normalized])),
  }
}
