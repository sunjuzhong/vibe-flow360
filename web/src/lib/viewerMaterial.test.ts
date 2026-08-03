import { describe, expect, it } from 'vitest'
import { resolveViewerMaterialStyle } from './viewerMaterial'

describe('resolveViewerMaterialStyle', () => {
  it('preserves assigned transparency while the face is selected', () => {
    expect(resolveViewerMaterialStyle(
      '#6f8790',
      { color: '#8fb8c8', opacity: 0.28 },
      true,
      true,
    )).toMatchObject({ color: '#8fb8c8', opacity: 0.28, emissiveIntensity: 0.16 })
  })

  it('restores the manifest defaults after an assignment is removed', () => {
    expect(resolveViewerMaterialStyle('#6f8790', undefined, false, true)).toMatchObject({
      color: '#6f8790', opacity: 1, emissive: '#000000',
    })
  })

  it('keeps hidden entities faint regardless of their appearance', () => {
    expect(resolveViewerMaterialStyle(
      '#6f8790',
      { color: '#8fb8c8', opacity: 0.28 },
      false,
      false,
    ).opacity).toBe(0.15)
  })
})
