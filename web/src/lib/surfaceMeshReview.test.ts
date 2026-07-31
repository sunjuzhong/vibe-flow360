import { describe, expect, it } from 'vitest'
import {
  buildSurfaceBoundaryInventory,
  classifySurfaceMeshQualityFields,
  surfaceMeshParameterSummary,
} from './surfaceMeshReview'

const groups = [
  { id: 'face-wing', name: 'wing', triangles: 120 },
  { id: 'face-fuselage', name: 'fuselage', triangles: 80 },
]

describe('SurfaceMesh review business adapter', () => {
  it('joins physical surfaces by stable entity id and sub-component name', () => {
    const inventory = buildSurfaceBoundaryInventory(groups, {
      simulation_params: {
        models: [{
          name: 'No-slip walls',
          type: 'Wall',
          surfaces: {
            stored_entities: [{
              private_attribute_id: 'face-wing',
              private_attribute_sub_components: ['fuselage'],
            }],
          },
        }],
      },
    })

    expect(inventory).toEqual([
      expect.objectContaining({
        id: 'face-wing',
        status: 'assigned',
        assignments: [{ modelName: 'No-slip walls', modelType: 'Wall' }],
      }),
      expect.objectContaining({
        id: 'face-fuselage',
        status: 'assigned',
        assignments: [{ modelName: 'No-slip walls', modelType: 'Wall' }],
      }),
    ])
  })

  it('supports wildcard surface assignments and reports conflicts', () => {
    const inventory = buildSurfaceBoundaryInventory(groups, {
      models: [
        {
          name: 'All walls',
          type: 'Wall',
          surfaces: { stored_entities: [{ name: '*' }] },
        },
        {
          name: 'Wing override',
          type: 'SlipWall',
          surfaces: { stored_entities: [{ name: 'wing' }] },
        },
      ],
    })

    expect(inventory[0].status).toBe('conflict')
    expect(inventory[0].assignments).toHaveLength(2)
    expect(inventory[1].status).toBe('assigned')
  })

  it('does not mistake volume-zone entities for physical surface assignments', () => {
    const inventory = buildSurfaceBoundaryInventory(groups, {
      models: [{
        name: 'Farfield',
        type: 'Freestream',
        entities: { stored_entities: [{ name: '*' }] },
      }],
    })

    expect(inventory.every((row) => row.status === 'unassigned')).toBe(true)
  })

  it('summarizes only parameters that affect SurfaceMesh', () => {
    const summary = surfaceMeshParameterSummary({
      meshing: {
        defaults: {
          surface_max_edge_length: { value: 0.1, units: 'meter' },
          surface_edge_growth_rate: 1.2,
          boundary_layer_first_layer_thickness: { value: 0.001, units: 'meter' },
          volume_edge_growth_rate: 1.3,
        },
        refinements: [{ type: 'SurfaceRefinement' }],
        volume_zones: [{ type: 'AutomatedFarfield' }],
      },
    })

    expect(summary.map((row) => row.path)).toEqual([
      'meshing.defaults.surface_max_edge_length',
      'meshing.defaults.surface_edge_growth_rate',
      'meshing.refinements',
    ])
    expect(summary[0].value).toBe('0.1 meter')
  })

  it('classifies CFD surface quality fields without changing the UVF library', () => {
    const fields = [
      { name: 'surface_area', kind: 'scalar', min: 0, max: 1 },
      { name: 'maximum-skewness', kind: 'scalar', min: 0, max: 0.9 },
      { name: 'pressure', kind: 'scalar', min: -1, max: 1 },
      { name: 'velocity', kind: 'vector', min: 0, max: 10 },
    ] as const

    expect(classifySurfaceMeshQualityFields([...fields]).map((field) => field.name)).toEqual([
      'surface_area',
      'maximum-skewness',
    ])
  })
})
