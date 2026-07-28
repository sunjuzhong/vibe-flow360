import { describe, expect, it } from 'vitest'
import { validateFileNames } from './ImportPanel'

describe('validateFileNames', () => {
  it('accepts CATIA extensions regardless of filename casing', () => {
    expect(validateFileNames(['wing.CATPart', 'assembly.catproduct'], 'geometry')).toBeNull()
  })

  it('rejects extensions that do not belong to the selected source type', () => {
    expect(validateFileNames(['mesh.cgns'], 'geometry')).toContain('mesh.cgns')
    expect(validateFileNames(['geometry.step'], 'volume-mesh')).toContain('geometry.step')
  })
})
