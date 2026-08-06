import { describe, expect, it } from 'vitest'
import type { ResourceDetail } from '../api/client'
import {
  buildVolumeZoneInventory,
  buildBoundaryLayerReview,
  buildVolumeQualityThresholds,
  buildVolumeSliceVariantReview,
  applyVolumeSliceVariantVisibility,
  assessVolumeMeshQuality,
  classifyBoundaryLayerEvidenceFields,
  classifyVolumeMeshQualityFields,
  computeVolumeReadiness,
  volumeMeshCapabilities,
  volumeMeshParameterSummary,
  volumeQualityRiskFilter,
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

  it('parses global and per-surface boundary-layer intent with stable entity matching', () => {
    const review = buildBoundaryLayerReview({
      simulationParams: {
        meshing: {
          defaults: {
            boundary_layer_first_layer_thickness: { value: 0.00001, units: 'meter' },
            boundary_layer_growth_rate: 1.2,
            number_of_boundary_layers: 12,
          },
          refinements: [
            {
              refinement_type: 'BoundaryLayer',
              name: 'Rotor walls',
              entities: { stored_entities: [{ private_attribute_id: 'rotor' }] },
              first_layer_thickness: { value: 0.000005, units: 'meter' },
              growth_rate: 1.15,
            },
            {
              refinement_type: 'PassiveSpacing',
              name: 'Farfield spacing',
              type: 'projected',
              entities: { stored_entities: [{ name: 'Farfield' }] },
            },
          ],
        },
      },
      groups,
      fields: [{ name: 'first_layer_height', kind: 'scalar', min: 1e-6, max: 1e-4 }],
    })

    expect(review.defaults).toEqual({
      firstLayerThickness: '0.00001 meter',
      growthRate: '1.2',
      layerCount: '12',
      layerCountMode: 'fixed',
    })
    expect(review.rules).toHaveLength(2)
    expect(review.rules[0]).toMatchObject({ kind: 'boundary-layer', behavior: 'grow' })
    expect(review.rules[0].targets[0]).toMatchObject({ matchedGroupId: 'rotor', match: 'id' })
    expect(review.rules[1]).toMatchObject({ kind: 'passive-spacing', behavior: 'projected' })
    expect(review.rules[1].targets[0]).toMatchObject({ matchedGroupId: 'farfield', match: 'id' })
    expect(review.evidenceFields.map((field) => field.name)).toEqual(['first_layer_height'])
  })

  it('keeps unmatched and wildcard surface references visible without inventing generated layers', () => {
    const review = buildBoundaryLayerReview({
      simulationParams: {
        meshing: {
          defaults: { boundary_layer_first_layer_thickness: { value: 1e-5, units: 'm' } },
          refinements: [{
            refinement_type: 'BoundaryLayer',
            faces: [{ name: 'Rotor*' }, { name: 'missing-wall' }],
            first_layer_thickness: { value: 5e-6, units: 'm' },
          }],
        },
      },
      groups,
      fields: [{ name: 'pressure', kind: 'scalar', min: 0, max: 1 }],
    })
    expect(review.matchedTargetCount).toBe(1)
    expect(review.unmatchedTargetCount).toBe(1)
    expect(review.rules[0].targets.map((target) => target.match)).toEqual(['pattern', 'unmatched'])
    expect(review.evidenceFields).toEqual([])
  })

  it('classifies only scalar generated boundary-layer evidence', () => {
    expect(classifyBoundaryLayerEvidenceFields([
      { name: 'prism_layer_count', kind: 'scalar', min: 0, max: 20 },
      { name: 'boundary_layer_vector', kind: 'vector', min: 0, max: 1 },
      { name: 'pressure', kind: 'scalar', min: -1, max: 1 },
    ]).map((field) => field.name)).toEqual(['prism_layer_count'])
  })

  it('builds conservative CFD screening thresholds without inventing dimensional limits', () => {
    const fields = [
      { name: 'maximum_skewness', kind: 'scalar' as const, min: 0.01, max: 0.97 },
      { name: 'minimum_orthogonality', kind: 'scalar' as const, min: 0.04, max: 1 },
      { name: 'cell_volume', kind: 'scalar' as const, min: 1e-12, max: 1 },
    ]
    const thresholds = buildVolumeQualityThresholds(fields, {
      maximum_skewness: { warning: 0.8, critical: 0.9 },
    })
    expect(thresholds).toHaveLength(2)
    expect(thresholds[0]).toMatchObject({ riskDirection: 'max', warning: 0.8, critical: 0.9, source: 'custom' })
    expect(thresholds[1]).toMatchObject({ riskDirection: 'min', warning: 0.15, critical: 0.05, source: 'baseline' })
  })

  it('ranks quality findings from field evidence and estimates histogram exceedance', () => {
    const fields = [
      { name: 'skewness', kind: 'scalar' as const, min: 0, max: 0.97 },
      { name: 'aspect_ratio', kind: 'scalar' as const, min: 1, max: 70 },
    ]
    const assessment = assessVolumeMeshQuality({
      fields,
      thresholds: buildVolumeQualityThresholds(fields),
      histogram: {
        field: fields[0],
        sampleCount: 100,
        bins: [
          { min: 0, max: 0.8, count: 80 },
          { min: 0.8, max: 0.9, count: 10 },
          { min: 0.9, max: 1, count: 10 },
        ],
      },
    })
    expect(assessment).toMatchObject({ criticalCount: 1, warningCount: 1, passCount: 0 })
    expect(assessment.findings[0]).toMatchObject({ fieldName: 'skewness', severity: 'critical', estimatedWarningCount: 15, estimatedCriticalCount: 5 })
    expect(assessment.findings[1]).toMatchObject({ fieldName: 'aspect_ratio', severity: 'warning' })
  })

  it('builds a viewer filter for the risky side of a threshold', () => {
    const field = { name: 'orthogonality', kind: 'scalar' as const, min: 0.02, max: 1 }
    const threshold = buildVolumeQualityThresholds([field])[0]
    expect(volumeQualityRiskFilter(field, threshold).rules[0]).toMatchObject({ min: 0.02, max: 0.15 })
  })

  it('pairs generated flat and crinkled slice faces by stable base name', () => {
    const review = buildVolumeSliceVariantReview([
      { id: 'slice-flat', name: 'Worst-quality x-normal slice (flat)', color: '#aaa', visible: true },
      { id: 'slice-crinkled', name: 'Worst-quality x-normal slice (crinkled)', color: '#bbb', visible: true },
      { id: 'fluid', name: 'Fluid zone', color: '#ccc', visible: true },
    ])
    expect(review).toMatchObject({ hasFlat: true, hasCrinkled: true, pairedCount: 1 })
    expect(review.families[0]).toMatchObject({
      name: 'Worst-quality x-normal slice',
      flatGroupIds: ['slice-flat'],
      crinkledGroupIds: ['slice-crinkled'],
    })
  })

  it('switches only slice variants and preserves non-slice visibility', () => {
    const review = buildVolumeSliceVariantReview([
      { id: 'flat', name: 'Slice A (flat)', color: '#aaa', visible: true },
      { id: 'crinkled', name: 'Slice A (crinkled)', color: '#bbb', visible: true },
      { id: 'crinkled-only', name: 'Slice B (crinkled)', color: '#bbb', visible: true },
    ])
    expect(applyVolumeSliceVariantVisibility({ flat: true, crinkled: true, 'crinkled-only': true, fluid: false }, review, 'flat')).toEqual({
      flat: true,
      crinkled: false,
      'crinkled-only': true,
      fluid: false,
    })
    expect(applyVolumeSliceVariantVisibility({ flat: true, crinkled: false, 'crinkled-only': true, fluid: false }, review, 'crinkled')).toEqual({
      flat: false,
      crinkled: true,
      'crinkled-only': true,
      fluid: false,
    })
  })
})
