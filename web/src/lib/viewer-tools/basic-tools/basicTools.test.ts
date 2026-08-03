import { describe, expect, it } from 'vitest'
import { createToolRuntime } from '../reducer'
import type { PickResult, ViewerAnnotation } from '../types'
import {
  BASIC_TOOL_DEFINITIONS,
  angleToolDefinition,
  areaToolDefinition,
  asBasicToolAnnotation,
  basicToolAnnotationOverlay,
  basicToolResultSummary,
  computeAngleResult,
  computeAreaResult,
  computeBoxResult,
  computeCircleResult,
  computeLineResult,
  computePointResult,
  computePolylineResult,
  computeSphereResult,
  boxToolDefinition,
  circleToolDefinition,
  isBasicToolResult,
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
    expect(circleToolDefinition.completion).toEqual({ kind: 'fixed', pointCount: 3 })
    expect(areaToolDefinition.completion).toEqual({ kind: 'open', minPoints: 3 })
    expect(boxToolDefinition.completion).toEqual({ kind: 'fixed', pointCount: 2 })
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

  it('computes a 3D circle from three points and rejects collinear input', () => {
    const result = computeCircleResult([
      pick([1, 0, 2]), pick([0, 1, 2]), pick([-1, 0, 2]),
    ])
    expect(result.kind).toBe('circle')
    expect(result.center[0]).toBeCloseTo(0)
    expect(result.center[1]).toBeCloseTo(0)
    expect(result.center[2]).toBeCloseTo(2)
    expect(result.normal).toEqual([0, 0, 1])
    expect(result.radius).toBeCloseTo(1)
    expect(result.circumference).toBeCloseTo(2 * Math.PI)
    expect(() => computeCircleResult([
      pick([0, 0, 0]), pick([1, 0, 0]), pick([2, 0, 0]),
    ])).toThrow('non-collinear')
  })

  it('computes closed polygon area and an axis-aligned box', () => {
    const area = computeAreaResult([
      pick([0, 0, 1]), pick([4, 0, 1]), pick([4, 3, 1]), pick([0, 3, 1]),
    ])
    expect(area).toMatchObject({ kind: 'area', area: 12, centroid: [2, 1.5, 1] })

    const box = computeBoxResult([pick([4, -1, 5]), pick([1, 3, -1])])
    expect(box).toMatchObject({
      kind: 'box', min: [1, -1, -1], max: [4, 3, 5], center: [2.5, 1, 2],
      dimensions: [3, 4, 6], volume: 72,
    })
  })

  it('validates persisted Circle, Area, and Box results', () => {
    const circle = computeCircleResult([pick([1, 0, 0]), pick([0, 1, 0]), pick([-1, 0, 0])])
    const area = computeAreaResult([pick([0, 0, 0]), pick([1, 0, 0]), pick([0, 1, 0])])
    const box = computeBoxResult([pick([0, 0, 0]), pick([1, 2, 3])])
    expect(isBasicToolResult(circle)).toBe(true)
    expect(isBasicToolResult(area)).toBe(true)
    expect(isBasicToolResult(box)).toBe(true)
    expect(isBasicToolResult({ ...circle, center: [Number.NaN, 0, 0] })).toBe(false)
    expect(isBasicToolResult({ ...area, points: [] })).toBe(false)
    expect(isBasicToolResult({ ...box, dimensions: [1, Number.POSITIVE_INFINITY, 3] })).toBe(false)
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
      { definition: circleToolDefinition, points: [pick([1, 0, 0]), pick([0, 1, 0]), pick([-1, 0, 0])], result: computeCircleResult([pick([1, 0, 0]), pick([0, 1, 0]), pick([-1, 0, 0])]) },
      { definition: areaToolDefinition, points: [pick([0, 0, 0]), pick([1, 0, 0]), pick([0, 1, 0])], result: computeAreaResult([pick([0, 0, 0]), pick([1, 0, 0]), pick([0, 1, 0])]) },
      { definition: boxToolDefinition, points: [pick([0, 0, 0]), pick([1, 2, 3])], result: computeBoxResult([pick([0, 0, 0]), pick([1, 2, 3])]) },
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
