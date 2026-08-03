import { describe, expect, it } from 'vitest'
import {
  VIEWER_ANNOTATION_SCHEMA_VERSION,
  createFixedPointTool,
  createOpenPointTool,
  createToolRuntime,
  parseViewerAnnotation,
  type JsonValue,
  type PickResult,
  type ToolDefinition,
  type ToolSession,
  type ViewerAnnotation,
} from './index'

const resourceRef = { id: 'geometry-1', type: 'Geometry' } as const

function pick(x: number): PickResult {
  return {
    localPosition: [x, 0, 0],
    worldPosition: [x + 10, 0, 0],
    projectId: 'project-1',
    resourceRef,
    coordinateFrame: { kind: 'asset-local', resourceRef },
    entityId: `face-${x}`,
    entityType: 'face',
    triangleIndex: x,
    normal: [0, 0, 1],
    snap: { type: 'surface', distance: 0, confidence: 1 },
  }
}

function annotation<TResult extends JsonValue>(result: TResult): ViewerAnnotation<TResult> {
  return {
    schemaVersion: VIEWER_ANNOTATION_SCHEMA_VERSION,
    id: 'annotation-1',
    projectId: 'project-1',
    resourceRef,
    coordinateFrame: { kind: 'asset-local', resourceRef },
    toolId: 'distance',
    points: [pick(0), pick(2)],
    result,
    style: { color: '#fff', width: 2 },
    visible: true,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  }
}

type DistanceResult = { readonly distance: number }
type PolylineResult = { readonly length: number; readonly segments: number }

const baseDefinition = {
  label: 'Tool',
  pickPolicy: { targets: ['surface'] as const },
  createOverlays: () => [],
  inspector: { title: 'Result', fields: [] },
}

const distanceDefinition: ToolDefinition<DistanceResult> = {
  ...baseDefinition,
  id: 'distance',
  completion: { kind: 'fixed', pointCount: 2 },
  computeResult: (points) => ({
    distance: Math.abs(points[1].localPosition[0] - points[0].localPosition[0]),
  }),
}

const polylineDefinition: ToolDefinition<PolylineResult> = {
  ...baseDefinition,
  id: 'polyline',
  completion: { kind: 'open', minPoints: 2 },
  computeResult: (points) => ({ length: points.length - 1, segments: points.length - 1 }),
}

function dispatch<TResult extends JsonValue>(
  definition: ToolDefinition<TResult>,
  actions: Parameters<ReturnType<typeof createToolRuntime<TResult>>['reducer']>[1][],
): ToolSession<TResult> {
  const runtime = createToolRuntime(definition)
  return actions.reduce(runtime.reducer, runtime.initialState)
}

describe('viewer tool definitions and runtime', () => {
  it('accepts an ordinary structural object as a ToolDefinition', () => {
    const objectDefinition = {
      ...distanceDefinition,
      id: 'ordinary-object-distance',
    } satisfies ToolDefinition<DistanceResult>

    expect(createToolRuntime(objectDefinition).initialState).toEqual({ status: 'idle' })
  })

  it('uses the same runtime for fixed Distance and open Polyline definitions', () => {
    const distance = dispatch(distanceDefinition, [
      { type: 'activate' },
      { type: 'pick', pick: pick(0) },
      { type: 'hover', pick: pick(1) },
      { type: 'pick', pick: pick(2) },
    ])
    const polyline = dispatch(polylineDefinition, [
      { type: 'activate' },
      { type: 'pick', pick: pick(0) },
      { type: 'pick', pick: pick(1) },
      { type: 'pick', pick: pick(2) },
      { type: 'finish' },
    ])

    expect(distance).toMatchObject({ status: 'complete-draft', result: { distance: 2 } })
    expect(polyline).toMatchObject({
      status: 'complete-draft',
      result: { length: 2, segments: 2 },
    })
  })

  it('automatically completes a fixed-point tool and rejects later picks', () => {
    const runtime = createToolRuntime(distanceDefinition)
    let state = dispatch(distanceDefinition, [
      { type: 'activate' },
      { type: 'pick', pick: pick(0) },
      { type: 'pick', pick: pick(2) },
    ])
    const complete = state
    state = runtime.reducer(state, { type: 'pick', pick: pick(3) })

    expect(state).toBe(complete)
    expect(state.status === 'complete-draft' && state.points).toHaveLength(2)
  })

  it('only finishes an open tool after minPoints and supports hover and undo-last', () => {
    const runtime = createToolRuntime(polylineDefinition)
    let state = runtime.reducer(runtime.initialState, { type: 'activate' })
    state = runtime.reducer(state, { type: 'hover', pick: pick(9) })
    expect(state).toMatchObject({ status: 'armed', hover: pick(9) })
    state = runtime.reducer(state, { type: 'pick', pick: pick(0) })
    const tooEarly = runtime.reducer(state, { type: 'finish' })
    expect(tooEarly).toBe(state)
    state = runtime.reducer(state, { type: 'pick', pick: pick(1) })
    state = runtime.reducer(state, { type: 'undo-last' })
    expect(state).toMatchObject({ status: 'collecting', points: [pick(0)] })
    state = runtime.reducer(state, { type: 'pick', pick: pick(2) })
    expect(runtime.reducer(state, { type: 'finish' })).toMatchObject({ status: 'complete-draft' })
  })

  it('covers save success, save failure recovery, retry, and cancel', () => {
    const runtime = createToolRuntime(distanceDefinition)
    const complete = dispatch(distanceDefinition, [
      { type: 'activate' },
      { type: 'pick', pick: pick(0) },
      { type: 'pick', pick: pick(2) },
    ])
    const saving = runtime.reducer(complete, { type: 'save' })
    expect(saving.status).toBe('saving')

    const failed = runtime.reducer(saving, { type: 'save-failure', error: 'offline' })
    expect(failed).toMatchObject({ status: 'error', cause: 'save', error: 'offline' })
    expect(runtime.reducer(failed, { type: 'retry' })).toMatchObject({ status: 'complete-draft' })

    const saved = runtime.reducer(saving, {
      type: 'save-success',
      annotation: annotation({ distance: 2 }),
    })
    expect(saved).toMatchObject({ status: 'saved', annotation: { id: 'annotation-1' } })
    expect(runtime.reducer(saved, { type: 'retry' })).toMatchObject({ status: 'armed', points: [] })
    expect(runtime.reducer(complete, { type: 'cancel' })).toEqual({ status: 'cancelled' })
  })

  it('leaves state unchanged for illegal transitions', () => {
    const runtime = createToolRuntime(distanceDefinition)
    const idle = runtime.initialState
    expect(runtime.reducer(idle, { type: 'pick', pick: pick(0) })).toBe(idle)
    expect(runtime.reducer(idle, { type: 'finish' })).toBe(idle)
    expect(runtime.reducer(idle, { type: 'save' })).toBe(idle)

    const collecting = dispatch(distanceDefinition, [
      { type: 'activate' },
      { type: 'pick', pick: pick(0) },
    ])
    expect(runtime.reducer(collecting, {
      type: 'save-success',
      annotation: annotation({ distance: 2 }),
    })).toBe(collecting)
  })

  it('validates factory completion policies', () => {
    expect(createFixedPointTool({ ...distanceDefinition, pointCount: 2 }).completion)
      .toEqual({ kind: 'fixed', pointCount: 2 })
    expect(createOpenPointTool({ ...polylineDefinition, minPoints: 2, maxPoints: 5 }).completion)
      .toEqual({ kind: 'open', minPoints: 2, maxPoints: 5 })
    expect(() => createOpenPointTool({ ...polylineDefinition, minPoints: 3, maxPoints: 2 }))
      .toThrow('maxPoints')
  })
})

describe('ViewerAnnotation schema', () => {
  it('accepts the current schema version and remains plain JSON data', () => {
    const value = annotation({ distance: 2 })
    expect(parseViewerAnnotation(JSON.parse(JSON.stringify(value)))).toEqual(value)
    expect(JSON.stringify(value)).not.toContain('Object3D')
    expect(JSON.stringify(value)).not.toContain('Vector3')
  })

  it('rejects unknown schema versions', () => {
    expect(() => parseViewerAnnotation({ ...annotation({ distance: 2 }), schemaVersion: 99 }))
      .toThrow('Unsupported viewer annotation schema version: 99')
  })
})
