import { describe, expect, it } from 'vitest'
import { applyJSONMergePatch, combineStageSchemas, createJSONMergePatch } from './PlanParameterReview'

describe('PlanParameterReview helpers', () => {
  it('combines stage roots into one complete SimulationParams schema', () => {
    const schema = combineStageSchemas({
      schema_version: 1,
      source_type: 'Geometry',
      target: 'case',
      stages: ['SurfaceMesh', 'Case'],
      baseline: {},
      schemas: {
        SurfaceMesh: { type: 'object', properties: { meshing: { type: 'object' } }, required: ['meshing'] },
        Case: { type: 'object', properties: { models: { type: 'array' } }, required: ['models'] },
      },
    })
    expect(Object.keys(schema.properties ?? {})).toEqual(['meshing', 'models'])
    expect(schema.required).toEqual(['meshing', 'models'])
  })

  it('round-trips edits and removals as a JSON Merge Patch', () => {
    const source = { meshing: { defaults: { size: 1, legacy: true } }, models: ['Fluid'] }
    const target = { meshing: { defaults: { size: 2 } }, models: ['Fluid'] }
    const patch = createJSONMergePatch(source, target)
    expect(patch).toEqual({ meshing: { defaults: { size: 2, legacy: null } } })
    expect(applyJSONMergePatch(source, patch)).toEqual(target)
  })
})
