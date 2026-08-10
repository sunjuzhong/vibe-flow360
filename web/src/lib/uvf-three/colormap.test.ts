import { describe, expect, it } from 'vitest'
import { DEFAULT_COLORMAP, sampleColormap, applyScalarField, listColormaps, createColormapTexture } from './colormap'
import type { UVFFieldInfo } from './types'

describe('colormap', () => {
  it('uses turbo as the default scientific colormap', () => {
    expect(DEFAULT_COLORMAP).toBe('turbo')
    expect(sampleColormap(0.5).toArray()).toEqual(sampleColormap(0.5, 'turbo').toArray())
  })

  it('lists available colormaps', () => {
    const maps = listColormaps()
    expect(maps).toContain('viridis')
    expect(maps).toContain('turbo')
    expect(maps).toContain('coolwarm')
    expect(maps.length).toBeGreaterThanOrEqual(4)
  })

  it('samples colormap at boundaries', () => {
    const atZero = sampleColormap(0, 'viridis')
    expect(atZero.r).toBeCloseTo(0.267, 2)
    const atOne = sampleColormap(1, 'viridis')
    expect(atOne.r).toBeCloseTo(0.993, 2)
  })

  it('clamps values outside 0-1', () => {
    const below = sampleColormap(-0.5, 'viridis')
    const atZero = sampleColormap(0, 'viridis')
    expect(below.r).toBeCloseTo(atZero.r, 5)
    const above = sampleColormap(1.5, 'viridis')
    const atOne = sampleColormap(1, 'viridis')
    expect(above.r).toBeCloseTo(atOne.r, 5)
  })

  it('applyScalarField produces correct color array', () => {
    const values = new Float32Array([0, 0.5, 1.0])
    const field: UVFFieldInfo = { name: 'pressure', kind: 'scalar', min: 0, max: 1 }
    const colors = applyScalarField(values, field, 'grayscale')
    expect(colors.length).toBe(9) // 3 values * 3 channels
    expect(colors[0]).toBeCloseTo(0, 1) // black at 0
    expect(colors[4]).toBeCloseTo(0.5, 1) // gray at 0.5
    expect(colors[8]).toBeCloseTo(1, 1) // white at 1.0
  })

  it('applyScalarField handles zero range', () => {
    const values = new Float32Array([5, 5])
    const field: UVFFieldInfo = { name: 't', kind: 'scalar', min: 5, max: 5 }
    const colors = applyScalarField(values, field, 'viridis')
    expect(colors.length).toBe(6)
  })

  it('creates colormap texture', () => {
    const texture = createColormapTexture('turbo', 16)
    expect(texture).toBeDefined()
    expect(texture.image.width).toBe(16)
    expect(texture.image.height).toBe(1)
  })
})
