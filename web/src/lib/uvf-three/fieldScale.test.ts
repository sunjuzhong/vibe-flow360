import { describe, expect, it } from 'vitest'
import { canUseLogFieldScale, formatFieldRange, formatFieldValue, normalizeFieldValue, resolveFieldScale } from './fieldScale'

describe('field scale', () => {
  it('uses log automatically for a large positive dynamic range', () => {
    expect(resolveFieldScale('auto', 1e-8, 1e-3)).toBe('log')
    expect(resolveFieldScale('auto', 1, 100)).toBe('linear')
  })

  it('falls back to linear when log is undefined', () => {
    expect(canUseLogFieldScale(0, 10)).toBe(false)
    expect(resolveFieldScale('log', 0, 10)).toBe('linear')
  })

  it('normalizes logarithmic decades evenly', () => {
    expect(normalizeFieldValue(10, 1, 1_000, 'log')).toBeCloseTo(1 / 3)
    expect(normalizeFieldValue(100, 1, 1_000, 'log')).toBeCloseTo(2 / 3)
  })

  it('preserves distinguishable small engineering values', () => {
    expect(formatFieldValue(0)).toBe('0')
    expect(formatFieldValue(1.23456e-8)).toBe('1.23456e-8')
    expect(formatFieldValue(1.23456e-8)).not.toBe(formatFieldValue(1.33456e-8))
    const closeRange = formatFieldRange(4.343214e-7, 4.343242e-7)
    expect(closeRange[0]).not.toBe(closeRange[1])
  })
})
