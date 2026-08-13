import { describe, expect, it } from 'vitest'
import { applySurfaceOpacity, brightenSurfaceColor, buildSurfaceAppearances } from './surfaceAppearance'

describe('Surface appearance', () => {
  it('lightens valid boundary colors and uses a light neutral fallback', () => {
    expect(brightenSurfaceColor('#6f8790')).toBe('#a9b7bc')
    expect(brightenSurfaceColor(undefined)).toBe('#a9b7bc')
  })

  it('builds per-boundary appearances without losing individual colors', () => {
    expect(buildSurfaceAppearances(
      ['wing', 'farfield'],
      { wing: '#6f8790', farfield: '#2563eb' },
      { farfield: 0.35 },
    )).toEqual({
      wing: { color: '#a9b7bc', opacity: 1 },
      farfield: { color: '#7ca1f3', opacity: 0.35 },
    })
  })

  it('applies and clamps opacity only for the requested boundaries', () => {
    expect(applySurfaceOpacity({ wing: 0.8 }, ['farfield', 'inlet'], 0.3)).toEqual({
      wing: 0.8,
      farfield: 0.3,
      inlet: 0.3,
    })
    expect(applySurfaceOpacity({}, ['wing'], 0)).toEqual({ wing: 0.05 })
  })
})
