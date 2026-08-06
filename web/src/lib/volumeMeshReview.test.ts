import { describe, expect, it } from 'vitest'
import type { ResourceDetail } from '../api/client'
import {
  buildVolumeZoneInventory,
  classifyVolumeMeshQualityFields,
  computeVolumeReadiness,
  volumeMeshCapabilities,
  volumeMeshParameterSummary,
  volumeQualityRiskDirection,
} from './volumeMeshReview'

const groups = [
  { id: 'farfield', name: 'Farfield', color: '#aaa', visible: true, triangles: 120 },
  { id: 'rotor', name: 'Rotor domain', color: '#bbb', visible: true, triangles: 80 },
]

function detail(overrides: Partial<ResourceDetail> = {}): ResourceDetail {
  return {
    id: 'vm-1',
    type: 'VolumeMesh',
    state: { status: 'completed' },
    summary: { cell_count: 1000 },
    simulation_params: {},
    ...overrides,
  }
}

describe('VolumeMesh review business adapter', () => {
  it('classifies scalar cell-quality fields without leaking CFD semantics into uvf-three', () => {
    const fields = [
      { name: 'cell_volume', kind: 'scalar' as const, min: 1e-8, max: 1 },
      { name: 'maximumAspectRatio', kind: 'scalar' as const, min: 1, max: 80 },
      { name: 'pressure', kind: 'scalar' as const, min: -1, max: 1 },
      { name: 'cell_velocity', kind: 'vector' as const, min: 0, max: 10 },
    ]
    expect(classifyVolumeMeshQualityFields(fields).map((field) => field.name)).toEqual([
      'cell_volume',
      'maximumAspectRatio',
    ])
    expect(volumeQualityRiskDirection('cell_volume')).toBe('min')
    expect(volumeQualityRiskDirection('maximumAspectRatio')).toBe('max')
  })

  it('summarizes VolumeMesh-only parameter groups', () => {
    const rows = volumeMeshParameterSummary({
      meshing: {
        defaults: {
          surface_max_edge_length: { value: 0.1, units: 'meter' },
          boundary_layer_first_layer_thickness: { value: 1e-5, units: 'meter' },
          boundary_layer_growth_rate: 1.2,
        },
        volume_zones: [{ name: 'farfield', type: 'AutomatedFarfield' }],
        refinements: [{ name: 'wake', type: 'UniformRefinement' }],
      },
    })
    expect(rows.map((row) => row.path)).toEqual([
      'meshing.defaults.boundary_layer_first_layer_thickness',
      'meshing.defaults.boundary_layer_growth_rate',
      'meshing.volume_zones',
      'meshing.refinements',
    ])
    expect(rows[0].section).toBe('Boundary layer')
  })

  it('uses provided zone types before conservative name inference', () => {
    const inventory = buildVolumeZoneInventory(groups, detail({
      info: { regions: [{ id: 'rotor', type: 'PorousMedium' }] },
    }))
    expect(inventory[0]).toMatchObject({ zoneType: 'farfield', typeProvenance: 'name-inferred' })
    expect(inventory[1]).toMatchObject({ zoneType: 'porous', typeProvenance: 'provided' })
  })

  it('marks Geometry fallback and clipping-only sections as proxy evidence', () => {
    const capabilities = volumeMeshCapabilities({
      detail: detail(),
      previewSource: 'fallback',
      groups,
      fields: [],
    })
    expect(capabilities.find((item) => item.key === 'asset')?.status).toBe('proxy')
    expect(capabilities.find((item) => item.key === 'quality')?.status).toBe('unavailable')
    expect(capabilities.find((item) => item.key === 'slices')?.status).toBe('unavailable')
  })

  it('detects explicit slice fields from the complete UVF field catalog', () => {
    const capabilities = volumeMeshCapabilities({
      detail: detail(),
      previewSource: 'primary',
      groups,
      fields: [{ name: 'wake_slice', kind: 'scalar', min: 0, max: 1 }],
    })
    expect(capabilities.find((item) => item.key === 'slices')?.status).toBe('available')
  })

  it('requires real asset, zones, fields, and parameters for full readiness', () => {
    const checks = computeVolumeReadiness({
      detail: detail({
        simulation_params: { meshing: { defaults: { boundary_layer_growth_rate: 1.2 } } },
      }),
      previewSource: 'primary',
      groups,
      fields: [{ name: 'aspect_ratio', kind: 'scalar', min: 1, max: 40 }],
    })
    expect(checks.every((check) => check.status === 'ready')).toBe(true)
  })
})
