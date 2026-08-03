import { describe, expect, it } from 'vitest'
import type { PickResult } from '../types'
import {
  computeDistanceResult,
  distanceAnnotationOverlay,
  distanceToolDefinition,
} from './distanceTool'

function pick(position: readonly [number, number, number], entityId: string): PickResult {
  return {
    localPosition: position,
    worldPosition: position,
    projectId: 'project-1',
    resourceRef: { id: 'geometry-1', type: 'Geometry' },
    coordinateFrame: {
      kind: 'asset-local',
      resourceRef: { id: 'geometry-1', type: 'Geometry' },
    },
    entityId,
    entityType: 'face',
    triangleIndex: 4,
    snap: { type: 'surface', distance: 0.01, confidence: 0.9 },
  }
}

describe('distance tool', () => {
  it('computes length, deltas, endpoints, and pick metadata', () => {
    const result = computeDistanceResult([pick([1, 2, 3], 'start'), pick([4, 6, 3], 'end')])
    expect(result).toMatchObject({
      length: 5,
      deltaXYZ: [3, 4, 0],
      unit: 'model units',
      endpoints: [
        { position: [1, 2, 3], entityId: 'start', entityType: 'face', triangleIndex: 4, snap: { type: 'surface' } },
        { position: [4, 6, 3], entityId: 'end', entityType: 'face', triangleIndex: 4, snap: { type: 'surface' } },
      ],
    })
  })

  it('uses two surface points and creates a rubber-band before completion', () => {
    expect(distanceToolDefinition.completion).toEqual({ kind: 'fixed', pointCount: 2 })
    expect(distanceToolDefinition.pickPolicy.targets).toEqual(['surface'])
    const primitives = distanceToolDefinition.createOverlays({
      points: [pick([0, 0, 0], 'start')],
      hover: pick([1, 0, 0], 'hover'),
      result: null,
    })
    expect(primitives.map(({ key }) => key)).toEqual(['endpoint-0', 'hover-rubber-band', 'hover-endpoint'])
  })

  it('uses the same overlay factory for saved annotations', () => {
    const points = [pick([0, 0, 0], 'start'), pick([0, 3, 4], 'end')] as const
    const result = computeDistanceResult(points)
    const overlay = distanceAnnotationOverlay({
      schemaVersion: 1,
      id: 'distance-1',
      projectId: 'project-1',
      resourceRef: points[0].resourceRef,
      coordinateFrame: points[0].coordinateFrame,
      toolId: 'distance',
      points,
      result,
      style: {},
      visible: true,
      createdAt: '2026-08-03T00:00:00Z',
      updatedAt: '2026-08-03T00:00:00Z',
    })
    expect(overlay.primitives.map(({ key }) => key)).toEqual([
      'endpoint-0', 'endpoint-1', 'distance-line', 'distance-label',
    ])
  })
})
