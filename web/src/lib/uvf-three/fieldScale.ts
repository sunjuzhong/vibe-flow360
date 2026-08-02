import type { UVFFieldScale, UVFResolvedFieldScale } from './types'

const AUTO_LOG_DYNAMIC_RANGE = 1_000

export function canUseLogFieldScale(min: number, max: number): boolean {
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > min
}

export function resolveFieldScale(
  scale: UVFFieldScale,
  min: number,
  max: number,
): UVFResolvedFieldScale {
  if (scale === 'log') return canUseLogFieldScale(min, max) ? 'log' : 'linear'
  if (scale === 'linear') return 'linear'
  return canUseLogFieldScale(min, max) && max / min >= AUTO_LOG_DYNAMIC_RANGE
    ? 'log'
    : 'linear'
}

export function normalizeFieldValue(
  value: number,
  min: number,
  max: number,
  scale: UVFResolvedFieldScale = 'linear',
): number {
  if (scale === 'log' && canUseLogFieldScale(min, max) && value > 0) {
    return (Math.log10(value) - Math.log10(min)) / (Math.log10(max) - Math.log10(min))
  }
  return (value - min) / (max - min || 1)
}

/** Keeps engineering-scale values compact without rounding distinct small values to zero. */
export function formatFieldValue(value: number, significantDigits = 6): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'

  const magnitude = Math.abs(value)
  if (magnitude < 0.001 || magnitude >= 100_000) {
    return value.toExponential(significantDigits - 1).replace(/\.0+(?=e)/, '').replace(/(\.\d*?)0+(?=e)/, '$1')
  }

  return new Intl.NumberFormat('en-US', {
    maximumSignificantDigits: significantDigits,
    useGrouping: magnitude >= 1_000,
  }).format(value)
}

export function formatFieldRange(min: number, max: number): [string, string] {
  for (let significantDigits = 4; significantDigits <= 9; significantDigits++) {
    const formattedMin = formatFieldValue(min, significantDigits)
    const formattedMax = formatFieldValue(max, significantDigits)
    if (min === max || formattedMin !== formattedMax) return [formattedMin, formattedMax]
  }
  return [formatFieldValue(min, 10), formatFieldValue(max, 10)]
}
