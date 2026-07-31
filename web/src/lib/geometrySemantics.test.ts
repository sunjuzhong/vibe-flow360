import { describe, expect, it } from 'vitest'
import {
  geometryMeasurementDistance,
  geometrySemanticAgentAction,
  inferGeometrySurfaceRole,
  suggestGeometrySemantics,
} from './geometrySemantics'

describe('Geometry semantic suggestions', () => {
  it('infers roles only from auditable names', () => {
    expect(inferGeometrySurfaceRole({ id: 'farfield', name: 'Outer Enclosure' })?.role).toBe('farfield')
    expect(inferGeometrySurfaceRole({ id: 'symm', name: 'symmetry-plane' })?.role).toBe('symmetry')
    expect(inferGeometrySurfaceRole({ id: 'face-1', name: 'body00001_face_6' })).toBeNull()
  })

  it('leaves ambiguous CAD-generated faces unassigned', () => {
    const suggestions = suggestGeometrySemantics([
      { id: 'face-1', name: 'body00001_face_6' },
      { id: 'wall-1', name: 'fuselage_wall' },
    ])

    expect(suggestions).toHaveLength(1)
    expect(suggestions[0]).toMatchObject({ groupId: 'wall-1', role: 'wall', provenance: 'inferred' })
  })
})

describe('Geometry inspection measurements', () => {
  it('calculates point-to-point distance in Geometry coordinates', () => {
    expect(geometryMeasurementDistance([[0, 0, 0], [3, 4, 12]])).toBe(13)
    expect(geometryMeasurementDistance([[0, 0, 0]])).toBeNull()
  })
})

describe('Geometry semantic review action', () => {
  it('creates a review-only plan with provenance and no direct remote patch', () => {
    const action = geometrySemanticAgentAction({
      project: {
        id: 'prj-1',
        name: 'Wing',
        solver_version: 'release-25.10',
        tags: [],
        root_item: { id: 'geo-1', type: 'Geometry' },
      },
      geometryId: 'geo-1',
      geometryName: 'Aircraft',
      draft: {
        bodyIntent: 'external-aerodynamics',
        assignments: [
          { groupId: 'wing', groupName: 'wing', role: 'wall', provenance: 'provided', reason: 'User assignment' },
          { groupId: 'farfield', groupName: 'farfield', role: 'farfield', provenance: 'inferred', reason: 'Name match' },
        ],
      },
    })

    expect(action.proposals?.[0].patch).toEqual({})
    expect(action.proposals?.[0].target).toBe('surface-mesh')
    expect(action.proposals?.[0].fields.map((field) => field.provenance)).toEqual([
      'provided', 'provided', 'inferred',
    ])
    expect(action.warnings?.[0]).toContain('local review plan')
  })
})
