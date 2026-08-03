import type { JsonValue, PickResult, Vector3Tuple } from '../types'

export const POINT_TOOL_ID = 'point'
export const LINE_TOOL_ID = 'line'
export const SPHERE_TOOL_ID = 'sphere'
export const POLYLINE_TOOL_ID = 'polyline'
export const ANGLE_TOOL_ID = 'angle'
export const CIRCLE_TOOL_ID = 'circle'
export const AREA_TOOL_ID = 'area'
export const BOX_TOOL_ID = 'box'

export type BasicToolId =
  | typeof POINT_TOOL_ID
  | typeof LINE_TOOL_ID
  | typeof SPHERE_TOOL_ID
  | typeof POLYLINE_TOOL_ID
  | typeof ANGLE_TOOL_ID
  | typeof CIRCLE_TOOL_ID
  | typeof AREA_TOOL_ID
  | typeof BOX_TOOL_ID

export type SerializedPick = {
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

export type PointResult = {
  readonly kind: 'point'
  readonly point: SerializedPick
}

export type LineResult = {
  readonly kind: 'line'
  readonly length: number
  readonly deltaXYZ: Vector3Tuple
  readonly endpoints: readonly [SerializedPick, SerializedPick]
  readonly unit: string
}

export type SphereResult = {
  readonly kind: 'sphere'
  readonly center: SerializedPick
  readonly edge: SerializedPick
  readonly radius: number
  readonly unit: string
}

export type PolylineResult = {
  readonly kind: 'polyline'
  readonly length: number
  readonly segmentLengths: readonly number[]
  readonly points: readonly SerializedPick[]
  readonly unit: string
}

export type AngleResult = {
  readonly kind: 'angle'
  readonly degrees: number | null
  readonly radians: number | null
  readonly points: readonly [SerializedPick, SerializedPick, SerializedPick]
}

export type CircleResult = {
  readonly kind: 'circle'
  readonly center: Vector3Tuple
  readonly normal: Vector3Tuple
  readonly radius: number
  readonly circumference: number
  readonly points: readonly [SerializedPick, SerializedPick, SerializedPick]
  readonly unit: string
}

export type AreaResult = {
  readonly kind: 'area'
  readonly area: number
  readonly centroid: Vector3Tuple
  readonly points: readonly SerializedPick[]
  readonly unit: string
}

export type BoxResult = {
  readonly kind: 'box'
  readonly min: Vector3Tuple
  readonly max: Vector3Tuple
  readonly center: Vector3Tuple
  readonly dimensions: Vector3Tuple
  readonly volume: number
  readonly endpoints: readonly [SerializedPick, SerializedPick]
  readonly unit: string
}

export type BasicToolResult =
  | PointResult
  | LineResult
  | SphereResult
  | PolylineResult
  | AngleResult
  | CircleResult
  | AreaResult
  | BoxResult

function requirePointCount(points: readonly PickResult[], expected: number, label: string): void {
  if (points.length !== expected) throw new Error(`${label} requires exactly ${expected} point${expected === 1 ? '' : 's'}`)
}

function finitePosition(pick: PickResult, index: number): Vector3Tuple {
  const position = pick.localPosition
  if (position.length !== 3 || !position.every(Number.isFinite)) {
    throw new Error(`Point ${index + 1} has a non-finite local position`)
  }
  if (pick.worldPosition.length !== 3 || !pick.worldPosition.every(Number.isFinite)) {
    throw new Error(`Point ${index + 1} has a non-finite world position`)
  }
  return position
}

export function serializePick(pick: PickResult, index = 0): SerializedPick {
  const position = finitePosition(pick, index)
  return {
    position,
    worldPosition: pick.worldPosition,
    entityId: pick.entityId ?? null,
    entityType: pick.entityType ?? null,
    triangleIndex: pick.triangleIndex ?? null,
    vertexIndex: pick.vertexIndex ?? null,
    snap: {
      type: pick.snap.type,
      distance: finiteOptional(pick.snap.distance, 'snap distance'),
      confidence: finiteOptional(pick.snap.confidence, 'snap confidence'),
    },
  }
}

function finiteOptional(value: number | undefined, label: string): number | null {
  if (value === undefined) return null
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

export function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function vectorLength(vector: Vector3Tuple): number {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function scale(vector: Vector3Tuple, factor: number): Vector3Tuple {
  return [vector[0] * factor, vector[1] * factor, vector[2] * factor]
}

function add(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function distanceBetween(a: Vector3Tuple, b: Vector3Tuple): number {
  return vectorLength(subtract(b, a))
}

export function midpoint(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

export function computePointResult(points: readonly PickResult[]): PointResult {
  requirePointCount(points, 1, 'Point')
  return { kind: 'point', point: serializePick(points[0]) }
}

export function computeLineResult(points: readonly PickResult[]): LineResult {
  requirePointCount(points, 2, 'Line')
  const start = finitePosition(points[0], 0)
  const end = finitePosition(points[1], 1)
  const deltaXYZ = subtract(end, start)
  return {
    kind: 'line',
    length: vectorLength(deltaXYZ),
    deltaXYZ,
    endpoints: [serializePick(points[0], 0), serializePick(points[1], 1)],
    unit: 'model units',
  }
}

export function computeSphereResult(points: readonly PickResult[]): SphereResult {
  requirePointCount(points, 2, 'Sphere')
  return {
    kind: 'sphere',
    center: serializePick(points[0], 0),
    edge: serializePick(points[1], 1),
    radius: distanceBetween(points[0].localPosition, points[1].localPosition),
    unit: 'model units',
  }
}

export function computePolylineResult(points: readonly PickResult[]): PolylineResult {
  if (points.length < 2) throw new Error('Polyline requires at least two points')
  points.forEach(finitePosition)
  const segmentLengths = points.slice(1).map((pick, index) => (
    distanceBetween(points[index].localPosition, pick.localPosition)
  ))
  return {
    kind: 'polyline',
    length: segmentLengths.reduce((total, length) => total + length, 0),
    segmentLengths,
    points: points.map(serializePick),
    unit: 'model units',
  }
}

export function computeAngleResult(points: readonly PickResult[]): AngleResult {
  requirePointCount(points, 3, 'Angle')
  points.forEach(finitePosition)
  const firstRay = subtract(points[0].localPosition, points[1].localPosition)
  const secondRay = subtract(points[2].localPosition, points[1].localPosition)
  const denominator = vectorLength(firstRay) * vectorLength(secondRay)
  let radians: number | null = null
  if (denominator > 0) {
    const dot = firstRay[0] * secondRay[0]
      + firstRay[1] * secondRay[1]
      + firstRay[2] * secondRay[2]
    radians = Math.acos(Math.max(-1, Math.min(1, dot / denominator)))
  }
  return {
    kind: 'angle',
    degrees: radians === null ? null : radians * 180 / Math.PI,
    radians,
    points: [serializePick(points[0], 0), serializePick(points[1], 1), serializePick(points[2], 2)],
  }
}

export function computeCircleResult(points: readonly PickResult[]): CircleResult {
  requirePointCount(points, 3, 'Circle')
  points.forEach(finitePosition)
  const origin = points[0].localPosition
  const first = subtract(points[1].localPosition, origin)
  const second = subtract(points[2].localPosition, origin)
  const planeNormal = cross(first, second)
  const normalLength = vectorLength(planeNormal)
  if (normalLength <= Number.EPSILON) {
    throw new Error('Circle requires three non-collinear points')
  }
  const denominator = 2 * normalLength * normalLength
  const firstSquared = vectorLength(first) ** 2
  const secondSquared = vectorLength(second) ** 2
  const offset = scale(add(
    scale(cross(second, planeNormal), firstSquared),
    scale(cross(planeNormal, first), secondSquared),
  ), 1 / denominator)
  const center = add(origin, offset)
  const radius = vectorLength(offset)
  return {
    kind: 'circle',
    center,
    normal: scale(planeNormal, 1 / normalLength),
    radius,
    circumference: 2 * Math.PI * radius,
    points: [serializePick(points[0], 0), serializePick(points[1], 1), serializePick(points[2], 2)],
    unit: 'model units',
  }
}

export function computeAreaResult(points: readonly PickResult[]): AreaResult {
  if (points.length < 3) throw new Error('Area requires at least three points')
  points.forEach(finitePosition)
  let areaVector: Vector3Tuple = [0, 0, 0]
  let centroid: Vector3Tuple = [0, 0, 0]
  points.forEach((pick, index) => {
    areaVector = add(areaVector, cross(
      pick.localPosition,
      points[(index + 1) % points.length].localPosition,
    ))
    centroid = add(centroid, pick.localPosition)
  })
  centroid = scale(centroid, 1 / points.length)
  return {
    kind: 'area',
    area: vectorLength(areaVector) / 2,
    centroid,
    points: points.map(serializePick),
    unit: 'model units²',
  }
}

export function computeBoxResult(points: readonly PickResult[]): BoxResult {
  requirePointCount(points, 2, 'Box')
  const first = finitePosition(points[0], 0)
  const second = finitePosition(points[1], 1)
  const min: Vector3Tuple = [
    Math.min(first[0], second[0]),
    Math.min(first[1], second[1]),
    Math.min(first[2], second[2]),
  ]
  const max: Vector3Tuple = [
    Math.max(first[0], second[0]),
    Math.max(first[1], second[1]),
    Math.max(first[2], second[2]),
  ]
  const dimensions = subtract(max, min)
  return {
    kind: 'box',
    min,
    max,
    center: midpoint(min, max),
    dimensions,
    volume: dimensions[0] * dimensions[1] * dimensions[2],
    endpoints: [serializePick(points[0], 0), serializePick(points[1], 1)],
    unit: 'model units',
  }
}

function finiteNumber(value: JsonValue): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isBasicToolResult(value: JsonValue): value is BasicToolResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as { readonly [key: string]: JsonValue }
  switch (candidate.kind) {
    case 'point':
      return Boolean(candidate.point && typeof candidate.point === 'object')
    case 'line':
      return finiteNumber(candidate.length) && Array.isArray(candidate.deltaXYZ)
        && Array.isArray(candidate.endpoints) && candidate.endpoints.length === 2
    case 'sphere':
      return finiteNumber(candidate.radius) && Boolean(candidate.center) && Boolean(candidate.edge)
    case 'polyline':
      return finiteNumber(candidate.length) && Array.isArray(candidate.segmentLengths)
        && candidate.segmentLengths.every(finiteNumber) && Array.isArray(candidate.points)
    case 'angle':
      return (candidate.degrees === null || finiteNumber(candidate.degrees))
        && (candidate.radians === null || finiteNumber(candidate.radians))
        && Array.isArray(candidate.points) && candidate.points.length === 3
    case 'circle':
      return finiteNumber(candidate.radius) && finiteNumber(candidate.circumference)
        && Array.isArray(candidate.center) && candidate.center.length === 3
        && candidate.center.every(finiteNumber)
        && Array.isArray(candidate.normal) && candidate.normal.length === 3
        && candidate.normal.every(finiteNumber)
        && Array.isArray(candidate.points) && candidate.points.length === 3
    case 'area':
      return finiteNumber(candidate.area)
        && Array.isArray(candidate.centroid) && candidate.centroid.length === 3
        && candidate.centroid.every(finiteNumber) && Array.isArray(candidate.points)
        && candidate.points.length >= 3
    case 'box':
      return finiteNumber(candidate.volume)
        && Array.isArray(candidate.min) && candidate.min.length === 3 && candidate.min.every(finiteNumber)
        && Array.isArray(candidate.max) && candidate.max.length === 3 && candidate.max.every(finiteNumber)
        && Array.isArray(candidate.center) && candidate.center.length === 3 && candidate.center.every(finiteNumber)
        && Array.isArray(candidate.dimensions) && candidate.dimensions.length === 3
        && candidate.dimensions.every(finiteNumber)
        && Array.isArray(candidate.endpoints) && candidate.endpoints.length === 2
    default:
      return false
  }
}

export function basicToolResultSummary(result: BasicToolResult): string {
  switch (result.kind) {
    case 'point': return `Point (${formatVector(result.point.position)})`
    case 'line': return `Line · ${formatNumber(result.length)} ${result.unit}`
    case 'sphere': return `Sphere · radius ${formatNumber(result.radius)} ${result.unit}`
    case 'polyline': return `Polyline · ${result.segmentLengths.length} segments · ${formatNumber(result.length)} ${result.unit}`
    case 'angle': return `Angle · ${result.degrees === null ? 'undefined' : `${formatNumber(result.degrees)}°`}`
    case 'circle': return `Circle · radius ${formatNumber(result.radius)} ${result.unit}`
    case 'area': return `Area · ${formatNumber(result.area)} ${result.unit}`
    case 'box': return `Box · ${formatNumber(result.dimensions[0])} × ${formatNumber(result.dimensions[1])} × ${formatNumber(result.dimensions[2])} ${result.unit}`
  }
}

export function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(7) : '—'
}

function formatVector(value: Vector3Tuple): string {
  return value.map(formatNumber).join(', ')
}
