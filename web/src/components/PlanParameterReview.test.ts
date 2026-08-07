import { describe, expect, it } from 'vitest'
import { applyJSONMergePatch, diffParameterValues } from './PlanParameterReview'

describe('PlanParameterReview helpers', () => {
  it('applies nested AI merge patches without replacing sibling values', () => {
    const source = { meshing: { defaults: { size: 1, growth: 1.2 } }, models: ['Fluid'] }
    expect(applyJSONMergePatch(source, { meshing: { defaults: { size: 2 } } })).toEqual({
      meshing: { defaults: { size: 2, growth: 1.2 } },
      models: ['Fluid'],
    })
  })

  it('builds a leaf-level before and after repair diff', () => {
    const before = { meshing: { defaults: { size: 1, legacy: true } }, models: ['Fluid'] }
    const after = { meshing: { defaults: { size: 2, first_layer: 0.01 } }, models: ['Fluid'] }
    expect(diffParameterValues(before, after)).toEqual([
      { path: 'meshing.defaults.first_layer', before: undefined, after: 0.01, kind: 'added' },
      { path: 'meshing.defaults.legacy', before: true, after: undefined, kind: 'removed' },
      { path: 'meshing.defaults.size', before: 1, after: 2, kind: 'changed' },
    ])
  })
})
