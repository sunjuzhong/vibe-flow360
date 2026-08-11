import { describe, expect, it } from 'vitest'
import { buildVolumeRefinementReview, volumeRefinementOverlays } from './volumeRefinementReview'

const groups = [
  { id: 'wing', name: 'Wing', color: '#aaa', visible: true },
]

describe('VolumeMesh refinement review', () => {
  it('matches entity refinements through their parent manifest path', () => {
    const review = buildVolumeRefinementReview({
      simulationParams: {
        meshing: {
          refinements: [{
            refinement_type: 'SurfaceRefinement',
            entities: ['aircraft-wall'],
            max_edge_length: { value: 0.1, units: 'm' },
          }],
        },
      },
      groups: [{ id: 'face-1', name: 'wall face', color: '#aaa', visible: true, path: ['boundaries', 'aircraft-wall'] }],
    })
    expect(review.rules[0].matchedTargets).toEqual([{ id: 'face-1', name: 'wall face' }])
    expect(review.rules[0].unresolvedTargets).toEqual([])
  })

  it('parses public Uniform and Axisymmetric refinement shapes and spacings', () => {
    const review = buildVolumeRefinementReview({
      simulationParams: {
        meshing: {
          refinements: [
            {
              refinement_type: 'UniformRefinement',
              name: 'Wake boxes',
              spacing: { value: 0.02, units: 'm' },
              entities: { stored_entities: [{
                private_attribute_entity_type_name: 'Box',
                private_attribute_id: 'wake-box',
                name: 'Wake box',
                center: { value: [2, 0, 0], units: 'm' },
                size: { value: [4, 2, 2], units: 'm' },
                axis_of_rotation: [0, 0, 1],
                angle_of_rotation: { value: 0, units: 'degree' },
              }] },
            },
            {
              refinement_type: 'AxisymmetricRefinement',
              name: 'Rotor refinement',
              spacing_axial: { value: 0.01, units: 'm' },
              spacing_radial: { value: 0.02, units: 'm' },
              spacing_circumferential: { value: 0.03, units: 'm' },
              entities: [{
                type_name: 'Cylinder',
                name: 'Rotor cylinder',
                center: { value: [0, 0, 0], units: 'm' },
                axis: [1, 0, 0],
                height: { value: 1, units: 'm' },
                outer_radius: { value: 2, units: 'm' },
              }],
            },
          ],
        },
      },
      groups,
      boundingBox: { min: [-3, -3, -3], max: [3, 3, 3] },
    })

    expect(review.rules.map((rule) => rule.kind)).toEqual(['uniform', 'axisymmetric'])
    expect(review.rules[0].spacings[0]).toMatchObject({ key: 'spacing', value: '0.02 m' })
    expect(review.rules[1].spacings).toHaveLength(3)
    expect(review.regions.map((region) => region.kind)).toEqual(['box', 'cylinder'])
    expect(review.diagnostics.some((item) => item.kind === 'overlap')).toBe(true)
  })

  it('reports empty, unresolved, and out-of-domain refinement targets without inventing geometry', () => {
    const review = buildVolumeRefinementReview({
      simulationParams: {
        meshing: {
          refinements: [
            { refinement_type: 'UniformRefinement', name: 'Empty', spacing: 0.1, entities: [] },
            { refinement_type: 'SurfaceRefinement', name: 'Missing surface', spacing: 0.1, entities: ['missing'] },
            {
              _type: 'BoxRefinement', name: 'Outside', spacing: 0.2,
              center: [20, 0, 0], size: [2, 2, 2],
            },
            { refinement_type: 'BoundaryLayer', name: 'Not a volume refinement', entities: ['wing'] },
          ],
        },
      },
      groups,
      boundingBox: { min: [-1, -1, -1], max: [1, 1, 1] },
    })

    expect(review.rules).toHaveLength(3)
    expect(review.unresolvedTargetCount).toBe(1)
    expect(review.diagnostics.map((item) => item.kind)).toEqual(expect.arrayContaining([
      'empty-target', 'unresolved-target', 'outside-domain',
    ]))
  })

  it('translates only recovered regions into generic viewer overlays', () => {
    const review = buildVolumeRefinementReview({
      simulationParams: {
        meshing: { refinements: [{
          refinement_type: 'UniformRefinement', spacing: 0.1,
          entities: [{ type_name: 'Sphere', name: 'Near body', center: [0, 0, 0], radius: 2 }],
        }] },
      },
      groups,
    })
    const overlays = volumeRefinementOverlays(review, { id: 'vm-1', type: 'VolumeMesh' }, review.regions[0].id)
    expect(overlays).toHaveLength(1)
    expect(overlays[0].coordinateFrame).toEqual({ kind: 'asset-local', resourceRef: { id: 'vm-1', type: 'VolumeMesh' } })
    expect(overlays[0].primitives[0]).toMatchObject({ kind: 'sphere', radius: 2 })
    expect(overlays[0].state).toBe('hover')
  })
})
