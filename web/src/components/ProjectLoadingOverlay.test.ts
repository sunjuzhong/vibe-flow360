import { describe, expect, it } from 'vitest'
import { simulatedLoadingProgress } from './ProjectLoadingOverlay'

describe('simulatedLoadingProgress', () => {
  it('advances linearly against the size-derived estimate and waits below completion', () => {
    expect(simulatedLoadingProgress(0, 10_000)).toBe(4)
    expect(simulatedLoadingProgress(5_000, 10_000)).toBe(49)
    expect(simulatedLoadingProgress(10_000, 10_000)).toBe(94)
    expect(simulatedLoadingProgress(30_000, 10_000)).toBe(94)
  })
})
