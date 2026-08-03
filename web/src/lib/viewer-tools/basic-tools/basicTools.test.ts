import { describe, expect, it } from 'vitest'
import { createToolRuntime } from '../reducer'
import type { PickResult, ViewerAnnotation } from '../types'
import {
  BASIC_TOOL_DEFINITIONS,
  angleToolDefinition,
  asBasicToolAnnotation,
  basicToolAnnotationOverlay,
  basicToolResultSummary,
  computeAngleResult,
  computeLineResult,
  computePointResult,
  computePolylineResult,
  computeSphereResult,
  lineToolDefinition,
  pointToolDefinition,
  polylineToolDefinition,
  sphereToolDefinition,
  type BasicToolResult,
} from './index'

const resourceRef = { id: 'geometry-1', type: 'Geometry' } as const

function pick(
  position: readonly [number, number, number],
  id = position.join('-'),
): PickResult {
  return {
    localPosition: position,
    worldPosition: [position[0] + 10, position[1], position[2]],
    projectId: 'project-1',
    resourceRef,
    coordinateFrame: { kind: 'asset-local', resourceRef },
    entityId: id,
    entityType: 'face',
    triangleIndex: 2,
    vertexIndex: 7,
    snap: { type: 'surface', distance: 0.01, confidence: 0.95 },
  }
}

function annotation(
  toolId: keyof typeof BASIC_TOOL_DEFINITIONS,
  points: readonly PickResult[],
  result: BasicToolResult,
): ViewerAnnotation<BasicToolResult> {
  return {
    schemaVersion: 1,
    id: `${toolId}-1`,
    projectId: 'project-1',
    resourceRef,
    coordinateFrame: { kind: 'asset-local', resourceRef },
    toolId,
    points,
    result,
    style: {},
    visible: true,
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
  }
}

describe('basic viewer tool calculations', () => {
  it('registers fixed one-, two-, and three-point tools plus an open tool', () => {
    expect(pointToolDefinition.completion).toEqual({ kind: 'fixed', pointCount: 1 })
    expect(lineToolDefinition.completion).toEqual({ kind: 'fixed', pointCount: 2 })
    expect(sphereToolDefinition.completion).toEqual({ kind: 'fixed', pointCount: 2 })
    expect(angleToolDefinition.completion).toEqual({ kind: 'fixed', pointCount: 3 })
    expect(polylineToolDefinition.completion).toEqual({ kind: 'open', minPoints: 2 })
  })

  it('computes and serializes Point, Line, and Sphere results', () => {
    const start = pick([0, 0, 0], 'start')
    const end = pick([3, 4, 0], 'end')
    expect(computePointResult([start])).toMatchObject({
      kind: 'point',
      point: { position: [0, 0, 0], worldPosition: [10, 0, 0], entityId: 'start' },
    })
    expect(computeLineResult([start, end])).toMatchObject({
      kind: 'line', length: 5, deltaXYZ: [3, 4, 0], endpoints: [{ entityId: 'start' }, { entityId: 'end' }],
    })
    expect(computeSphereResult([start, end])).toMatchObject({
      kind: 'sphere', radius: 5, center: { entityId: 'start' }, edge: { entityId: 'end' },
    })
    expect(JSON.parse(JSON.stringify(computeSphereResult([start, end])))).toEqual(
      computeSphereResult([start, end]),
    )
  })

  it('computes every Polyline segment and cumulative length, including repeated points', () => {
    const result = computePolylineResult([
      pick([0, 0, 0]),
      pick([3, 4, 0]),
      pick([3, 4, 0], 'repeated'),
      pick([3, 4, 12]),
    ])
    expect(result.segmentLengths).toEqual([5, 0, 12])
    expect(result.length).toBe(17)
    expect(basicToolResultSummary(result)).toContain('3 segments')
  })

  it('computes 0–180 degree angles and returns null for a zero-length ray', () => {
    expect(computeAngleResult([
      pick([1, 0, 0]), pick([0, 0, 0]), pick([0, 1, 0]),
    ])).toMatchObject({ degrees: 90 })
    expect(computeAngleResult([
      pick([-1, 0, 0]), pick([0, 0, 0]), pick([1, 0, 0]),
    ])).toMatchObject({ degrees: 180 })
    expect(computeAngleResult([
      pick([0, 0, 0]), pick([0, 0, 0], 'vertex'), pick([1, 0, 0]),
    ])).toMatchObject({ degrees: null, radians: null })
  })

  it('rejects non-finite local, world, and snap values instead of serializing NaN', () => {
    expect(() => computePointResult([{ ...pick([0, 0, 0]), localPosition: [NaN, 0, 0] }]))
      .toThrow('non-finite local position')
    expect(() => computePointResult([{ ...pick([0, 0, 0]), worldPosition: [Infinity, 0, 0] }]))
      .toThrow('non-finite world position')
    expect(() => computePointResult([{ ...pick([0, 0, 0]), snap: { type: 'surface', confidence: NaN } }]))
      .toThrow('snap confidence must be finite')
  })
})

describe('basic viewer tool runtime and overlays', () => {
  it('supports Polyline Backspace and Enter completion through the shared runtime', () => {
    const runtime = createToolRuntime(polylineToolDefinition)
    let session = runtime.reducer(runtime.initialState, { type: 'activate' })
    session = runtime.reducer(session, { type: 'pick', pick: pick([0, 0, 0]) })
    expect(runtime.reducer(session, { type: 'finish' })).toBe(session)
    session = runtime.reducer(session, { type: 'pick', pick: pick([1, 0, 0]) })
    session = runtime.reducer(session, { type: 'undo-last' })
    expect(session).toMatchObject({ status: 'collecting', points: [{ localPosition: [0, 0, 0] }] })
    session = runtime.reducer(session, { type: 'pick', pick: pick([2, 0, 0]) })
    expect(runtime.reducer(session, { type: 'finish' })).toMatchObject({
      status: 'complete-draft', result: { kind: 'polyline', length: 2 },
    })
  })

  it('creates draft rubber bands, result overlays, and saved reload overlays for every tool', () => {
    const cases = [
      { definition: pointToolDefinition, points: [pick([0, 0, 0])], result: computePointResult([pick([0, 0, 0])]) },
      { definition: lineToolDefinition, points: [pick([0, 0, 0]), pick([1, 0, 0])], result: computeLineResult([pick([0, 0, 0]), pick([1, 0, 0])]) },
      { definition: sphereToolDefinition, points: [pick([0, 0, 0]), pick([1, 0, 0])], result: computeSphereResult([pick([0, 0, 0]), pick([1, 0, 0])]) },
      { definition: polylineToolDefinition, points: [pick([0, 0, 0]), pick([1, 0, 0]), pick([1, 1, 0])], result: computePolylineResult([pick([0, 0, 0]), pick([1, 0, 0]), pick([1, 1, 0])]) },
      { definition: angleToolDefinition, points: [pick([1, 0, 0]), pick([0, 0, 0]), pick([0, 1, 0])], result: computeAngleResult([pick([1, 0, 0]), pick([0, 0, 0]), pick([0, 1, 0])]) },
    ] as const

    cases.forEach(({ definition, points, result }) => {
      const draftPoints = definition.id === 'point' ? [] : points.slice(0, 1)
      const draft = definition.createOverlays({ points: draftPoints, hover: pick([2, 0, 0]), result: null })
      expect(draft.some(({ key }) => key.startsWith('hover-'))).toBe(true)
      const savedAnnotation = annotation(definition.id as keyof typeof BASIC_TOOL_DEFINITIONS, points, result)
      expect(asBasicToolAnnotation(savedAnnotation)).not.toBeNull()
      const overlay = basicToolAnnotationOverlay(savedAnnotation)
      expect(overlay.state).toBe('saved')
      expect(overlay.primitives.length).toBeGreaterThan(0)
      expect(JSON.parse(JSON.stringify(savedAnnotation))).toEqual(savedAnnotation)
    })

    const sphereDraft = sphereToolDefinition.createOverlays({
      points: [pick([0, 0, 0])], hover: pick([0, 3, 4]), result: null,
    })
    expect(sphereDraft).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'sphere', key: 'hover-sphere', radius: 5 }),
      expect.objectContaining({ kind: 'label', key: 'hover-radius-label' }),
    ]))
  })
})
