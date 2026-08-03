import { createFixedPointTool, createOpenPointTool } from '../factories'
import type { OverlayPrimitive, PickResult, ToolDefinition, Vector3Tuple } from '../types'
import {
  ANGLE_TOOL_ID,
  LINE_TOOL_ID,
  POINT_TOOL_ID,
  POLYLINE_TOOL_ID,
  SPHERE_TOOL_ID,
  basicToolResultSummary,
  computeAngleResult,
  computeLineResult,
  computePointResult,
  computePolylineResult,
  computeSphereResult,
  formatNumber,
  midpoint,
  type BasicToolId,
  type BasicToolResult,
} from './geometry'

const COLORS: Record<BasicToolId, string> = {
  point: '#38bdf8',
  line: '#a78bfa',
  sphere: '#34d399',
  polyline: '#fb7185',
  angle: '#facc15',
}

function points(points: readonly PickResult[], color: string): OverlayPrimitive[] {
  return points.map((pick, index) => ({
    kind: 'point',
    key: `point-${index}`,
    position: pick.localPosition,
    color,
    size: 0.018,
  }))
}

function rubberBand(
  pointsValue: readonly PickResult[],
  hover: PickResult | null,
  color: string,
): OverlayPrimitive[] {
  const last = pointsValue.at(-1)
  if (!last || !hover) return []
  return [{
    kind: 'polyline',
    key: 'hover-rubber-band',
    points: [last.localPosition, hover.localPosition],
    color,
    width: 1,
    dashed: true,
  }, {
    kind: 'point',
    key: 'hover-point',
    position: hover.localPosition,
    color,
    size: 0.014,
  }]
}

function polylineMidpoint(pointsValue: readonly PickResult[]): Vector3Tuple {
  const middle = Math.max(1, Math.floor(pointsValue.length / 2))
  return midpoint(pointsValue[middle - 1].localPosition, pointsValue[middle].localPosition)
}

const commonPolicy = { targets: ['surface', 'line', 'point'] as const }

export const pointToolDefinition = createFixedPointTool<BasicToolResult>({
  id: POINT_TOOL_ID,
  label: 'Point Marker',
  pointCount: 1,
  pickPolicy: commonPolicy,
  computeResult: computePointResult,
  createOverlays: ({ points: pointsValue, hover }) => {
    if (pointsValue.length) return points(pointsValue, COLORS.point)
    return hover ? [{ kind: 'point', key: 'hover-point', position: hover.localPosition, color: COLORS.point, size: 0.014 }] : []
  },
  inspector: {
    title: 'Point marker',
    fields: [{ key: 'position', label: 'Position', valuePath: 'point.position', format: 'vector' }],
  },
})

export const lineToolDefinition = createFixedPointTool<BasicToolResult>({
  id: LINE_TOOL_ID,
  label: 'Line',
  pointCount: 2,
  pickPolicy: commonPolicy,
  computeResult: computeLineResult,
  createOverlays: ({ points: pointsValue, hover }) => {
    const primitives = points(pointsValue, COLORS.line)
    if (pointsValue.length === 2) primitives.push({
      kind: 'polyline', key: 'line', points: pointsValue.map(({ localPosition }) => localPosition), color: COLORS.line, width: 2,
    })
    return [...primitives, ...rubberBand(pointsValue, hover, COLORS.line)]
  },
  inspector: {
    title: 'Line',
    fields: [
      { key: 'start', label: 'Start', valuePath: 'endpoints.0.position', format: 'vector' },
      { key: 'end', label: 'End', valuePath: 'endpoints.1.position', format: 'vector' },
    ],
  },
})

export const sphereToolDefinition = createFixedPointTool<BasicToolResult>({
  id: SPHERE_TOOL_ID,
  label: 'Sphere',
  pointCount: 2,
  pickPolicy: commonPolicy,
  computeResult: computeSphereResult,
  createOverlays: ({ points: pointsValue, hover, result }) => {
    const primitives = points(pointsValue, COLORS.sphere)
    if (result?.kind === 'sphere') {
      primitives.push({ kind: 'sphere', key: 'sphere', center: result.center.position, radius: result.radius, color: COLORS.sphere, opacity: 0.24 })
      primitives.push({ kind: 'label', key: 'radius-label', position: result.edge.position, text: `r ${formatNumber(result.radius)} ${result.unit}`, color: COLORS.sphere })
    } else if (pointsValue.length === 1 && hover) {
      const radius = Math.hypot(
        hover.localPosition[0] - pointsValue[0].localPosition[0],
        hover.localPosition[1] - pointsValue[0].localPosition[1],
        hover.localPosition[2] - pointsValue[0].localPosition[2],
      )
      primitives.push({
        kind: 'sphere', key: 'hover-sphere', center: pointsValue[0].localPosition,
        radius, color: COLORS.sphere, opacity: 0.14,
      })
      primitives.push({
        kind: 'label', key: 'hover-radius-label', position: hover.localPosition,
        text: `r ${formatNumber(radius)} model units`, color: COLORS.sphere,
      })
    }
    return [...primitives, ...rubberBand(pointsValue, hover, COLORS.sphere)]
  },
  inspector: {
    title: 'Sphere',
    fields: [
      { key: 'radius', label: 'Radius', valuePath: 'radius', format: 'distance' },
      { key: 'center', label: 'Center', valuePath: 'center.position', format: 'vector' },
    ],
  },
})

export const polylineToolDefinition = createOpenPointTool<BasicToolResult>({
  id: POLYLINE_TOOL_ID,
  label: 'Polyline',
  minPoints: 2,
  pickPolicy: commonPolicy,
  computeResult: computePolylineResult,
  createOverlays: ({ points: pointsValue, hover, result }) => {
    const primitives = points(pointsValue, COLORS.polyline)
    if (pointsValue.length >= 2) primitives.push({
      kind: 'polyline', key: 'polyline', points: pointsValue.map(({ localPosition }) => localPosition), color: COLORS.polyline, width: 2,
    })
    if (result?.kind === 'polyline') {
      result.segmentLengths.forEach((length, index) => primitives.push({
        kind: 'label',
        key: `segment-${index}-label`,
        position: midpoint(pointsValue[index].localPosition, pointsValue[index + 1].localPosition),
        text: formatNumber(length),
        color: COLORS.polyline,
      }))
      primitives.push({
        kind: 'label', key: 'total-label', position: polylineMidpoint(pointsValue), text: `Σ ${formatNumber(result.length)} ${result.unit}`, color: COLORS.polyline,
      })
    }
    return [...primitives, ...rubberBand(pointsValue, hover, COLORS.polyline)]
  },
  inspector: {
    title: 'Polyline',
    fields: [
      { key: 'length', label: 'Total length', valuePath: 'length', format: 'distance' },
      { key: 'segments', label: 'Segments', valuePath: 'segmentLengths', format: 'text' },
    ],
  },
})

export const angleToolDefinition = createFixedPointTool<BasicToolResult>({
  id: ANGLE_TOOL_ID,
  label: 'Angle',
  pointCount: 3,
  pickPolicy: commonPolicy,
  computeResult: computeAngleResult,
  createOverlays: ({ points: pointsValue, hover, result }) => {
    const primitives = points(pointsValue, COLORS.angle)
    if (pointsValue.length >= 2) primitives.push({
      kind: 'polyline', key: 'angle-rays', points: pointsValue.map(({ localPosition }) => localPosition), color: COLORS.angle, width: 2,
    })
    if (result?.kind === 'angle') primitives.push({
      kind: 'label', key: 'angle-label', position: pointsValue[1].localPosition,
      text: result.degrees === null ? 'Undefined angle' : `${formatNumber(result.degrees)}°`, color: COLORS.angle,
    })
    return [...primitives, ...rubberBand(pointsValue, hover, COLORS.angle)]
  },
  inspector: {
    title: 'Angle',
    fields: [
      { key: 'angle', label: 'Angle', valuePath: 'degrees', format: 'number', unit: '°' },
      { key: 'vertex', label: 'Vertex', valuePath: 'points.1.position', format: 'vector' },
    ],
  },
})

export const BASIC_TOOL_DEFINITIONS: Readonly<Record<BasicToolId, ToolDefinition<BasicToolResult>>> = {
  point: pointToolDefinition,
  line: lineToolDefinition,
  sphere: sphereToolDefinition,
  polyline: polylineToolDefinition,
  angle: angleToolDefinition,
}

export const BASIC_TOOLS = Object.values(BASIC_TOOL_DEFINITIONS)

export function basicToolLabel(result: BasicToolResult): string {
  return basicToolResultSummary(result)
}
