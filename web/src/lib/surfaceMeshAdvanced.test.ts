import { describe, expect, it } from 'vitest'
import {
  buildSurfaceRemediationRecommendation,
  compareSurfaceParameters,
  measurementDistance,
  remediationAgentAction,
} from './surfaceMeshAdvanced'

describe('SurfaceMesh advanced review', () => {
  it('compares SurfaceMesh parameter summaries', () => {
    expect(compareSurfaceParameters(
      [
        { path: 'a', label: 'A', value: '1' },
        { path: 'b', label: 'B', value: '2' },
      ],
      [
        { path: 'a', label: 'A', value: '3' },
        { path: 'c', label: 'C', value: '4' },
      ],
    )).toEqual([
      { path: 'a', label: 'A', baseline: '1', comparison: '3', kind: 'changed' },
      { path: 'b', label: 'B', baseline: '2', comparison: undefined, kind: 'removed' },
      { path: 'c', label: 'C', baseline: undefined, comparison: '4', kind: 'added' },
    ])
  })

  it('measures distance in manifest coordinates', () => {
    expect(measurementDistance([[0, 0, 0], [3, 4, 12]])).toBe(13)
    expect(measurementDistance([[0, 0, 0]])).toBeNull()
  })

  it('builds an evidence-backed patch and review-only agent action', () => {
    const recommendation = buildSurfaceRemediationRecommendation({
      field: { name: 'maximumSkewness', kind: 'scalar', min: 0, max: 0.98 },
      probe: {
        fieldName: 'maximumSkewness',
        value: 0.98,
        entityId: 'wing',
        position: [1, 2, 3],
      },
      simulationParams: {
        meshing: {
          defaults: {
            surface_max_edge_length: { value: 0.2, units: 'meter' },
            surface_edge_growth_rate: 1.3,
          },
        },
      },
    })
    expect(recommendation.patch).toMatchObject({
      meshing: {
        defaults: {
          surface_edge_growth_rate: 1.15,
          surface_max_aspect_ratio: 20,
        },
      },
    })
    expect(
      ((recommendation.patch.meshing as Record<string, unknown>).defaults as Record<string, { value: number }>)
        .surface_max_edge_length.value,
    ).toBeCloseTo(0.15)
    const action = remediationAgentAction({
      recommendation,
      project: {
        id: 'project',
        name: 'Wing',
        solver_version: 'v1',
        tags: [],
        root_item: { id: 'geometry', type: 'Geometry' },
      },
      geometryId: 'geometry',
      geometryName: 'CAD',
    })
    expect(action.kind).toBe('create-plan')
    expect(action.proposals?.[0]).toMatchObject({
      action: 'Geometry',
      source_id: 'geometry',
      source_type: 'Geometry',
      target: 'surface-mesh',
    })
    expect(action.version).toBe('v1')
    expect(action.warnings?.[0]).toContain('draft plan only')
  })
})
