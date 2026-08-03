import { createFixedPointTool } from '../factories'
import type {
  JsonValue,
  OverlayPrimitive,
  PickResult,
  Vector3Tuple,
  ViewerAnnotation,
} from '../types'
import type { OverlayAnnotation } from '../overlays/types'

export const DISTANCE_TOOL_ID = 'distance'

export type DistanceEndpoint = {
  readonly position: Vector3Tuple
  readonly worldPosition: Vector3Tuple
  readonly entityId: string | null
  readonly entityType: string | null
  readonly triangleIndex: number | null
  readonly vertexIndex: number | null
  readonly snap: {
    readonly type: string
    readonly distance: number | null
    readonly confidence: number | null
  }
}

export type DistanceResult = {
  readonly length: number
  readonly deltaXYZ: Vector3Tuple
  readonly endpoints: readonly [DistanceEndpoint, DistanceEndpoint]
  readonly unit: string
}

function endpoint(pick: PickResult): DistanceEndpoint {
  return {
    position: pick.localPosition,
    worldPosition: pick.worldPosition,
    entityId: pick.entityId ?? null,
    entityType: pick.entityType ?? null,
    triangleIndex: pick.triangleIndex ?? null,
    vertexIndex: pick.vertexIndex ?? null,
    snap: {
      type: pick.snap.type,
      distance: pick.snap.distance ?? null,
      confidence: pick.snap.confidence ?? null,
    },
  }
}

export function computeDistanceResult(points: readonly PickResult[]): DistanceResult {
  if (points.length !== 2) throw new Error('Distance requires exactly two points')
  const [start, end] = points
  const deltaXYZ: Vector3Tuple = [
    end.localPosition[0] - start.localPosition[0],
    end.localPosition[1] - start.localPosition[1],
    end.localPosition[2] - start.localPosition[2],
  ]
  return {
    length: Math.hypot(...deltaXYZ),
    deltaXYZ,
    endpoints: [endpoint(start), endpoint(end)],
    unit: 'model units',
  }
}

export function createDistanceOverlays({
  points,
  hover,
  result,
}: {
  readonly points: readonly PickResult[]
  readonly hover: PickResult | null
  readonly result: DistanceResult | null
}): readonly OverlayPrimitive[] {
  const primitives: OverlayPrimitive[] = points.map((pick, index) => ({
    kind: 'point',
    key: `endpoint-${index}`,
    position: pick.localPosition,
    color: '#f59e0b',
    size: 9,
  }))
  if (points.length === 2) {
    primitives.push({
      kind: 'polyline',
      key: 'distance-line',
      points: [points[0].localPosition, points[1].localPosition],
      color: '#f59e0b',
      width: 2,
    })
    if (result) {
      primitives.push({
        kind: 'label',
        key: 'distance-label',
        position: midpoint(points[0].localPosition, points[1].localPosition),
        text: `${formatDistance(result.length)} ${result.unit}`,
        color: '#fbbf24',
      })
    }
  } else if (points.length === 1 && hover) {
    primitives.push({
      kind: 'polyline',
      key: 'hover-rubber-band',
      points: [points[0].localPosition, hover.localPosition],
      color: '#fbbf24',
      width: 1,
      dashed: true,
    })
    primitives.push({
      kind: 'point',
      key: 'hover-endpoint',
      position: hover.localPosition,
      color: '#fde68a',
      size: 7,
    })
  }
  return primitives
}

function midpoint(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

export function formatDistance(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(7) : '—'
}

export const distanceToolDefinition = createFixedPointTool<DistanceResult>({
  id: DISTANCE_TOOL_ID,
  label: 'Distance',
  pointCount: 2,
  pickPolicy: {
    targets: ['surface'],
    snapTypes: ['surface', 'mesh-vertex', 'cad-edge', 'cad-vertex', 'feature'],
  },
  computeResult: computeDistanceResult,
  createOverlays: createDistanceOverlays,
  inspector: {
    title: 'Distance measurement',
    fields: [
      { key: 'length', label: 'Length', valuePath: 'length', format: 'distance' },
      { key: 'delta', label: 'ΔX / ΔY / ΔZ', valuePath: 'deltaXYZ', format: 'vector' },
      { key: 'start', label: 'Start', valuePath: 'endpoints.0.position', format: 'vector' },
      { key: 'end', label: 'End', valuePath: 'endpoints.1.position', format: 'vector' },
    ],
  },
})

export function isDistanceResult(value: JsonValue): value is DistanceResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { readonly [key: string]: JsonValue }
  return typeof candidate.length === 'number'
    && Array.isArray(candidate.deltaXYZ) && candidate.deltaXYZ.length === 3
    && Array.isArray(candidate.endpoints) && candidate.endpoints.length === 2
    && typeof candidate.unit === 'string'
}

export function distanceAnnotationOverlay(
  annotation: ViewerAnnotation<DistanceResult>,
): OverlayAnnotation {
  return {
    annotationId: annotation.id,
    coordinateFrame: annotation.coordinateFrame,
    primitives: distanceToolDefinition.createOverlays({
      points: annotation.points,
      hover: null,
      result: annotation.result,
    }),
    visible: annotation.visible,
    state: 'saved',
  }
}
