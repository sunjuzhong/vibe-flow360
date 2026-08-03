import { createFixedPointTool, createOpenPointTool } from '../factories'
import type { OverlayPrimitive, PickResult, ToolDefinition, Vector3Tuple } from '../types'
import {
  ANGLE_TOOL_ID,
  AREA_TOOL_ID,
  BOX_TOOL_ID,
  CIRCLE_TOOL_ID,
  LINE_TOOL_ID,
  POINT_TOOL_ID,
  POLYLINE_TOOL_ID,
  SPHERE_TOOL_ID,
  basicToolResultSummary,
  computeAngleResult,
  computeAreaResult,
  computeBoxResult,
  computeCircleResult,
  computeLineResult,
  computePointResult,
  computePolylineResult,
  computeSphereResult,
  formatNumber,
  midpoint,
  type BasicToolId,
  type BasicToolResult,
  type BoxResult,
  type CircleResult,
} from './geometry'

const COLORS: Record<BasicToolId, string> = {
  point: '#38bdf8',
  line: '#a78bfa',
  sphere: '#34d399',
  polyline: '#fb7185',
  angle: '#facc15',
  circle: '#22d3ee',
  area: '#f97316',
  box: '#60a5fa',
}

function points(points: readonly PickResult[], color: string): OverlayPrimitive[] {
  return points.map((pick, index) => ({
    kind: 'point',
    key: `point-${index}`,
    position: pick.localPosition,
    color,
    size: 9,
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
    size: 7,
  }]
}

function polylineMidpoint(pointsValue: readonly PickResult[]): Vector3Tuple {
  const middle = Math.max(1, Math.floor(pointsValue.length / 2))
  return midpoint(pointsValue[middle - 1].localPosition, pointsValue[middle].localPosition)
}

const commonPolicy = { targets: ['surface', 'line', 'point'] as const }

function circlePoints(result: CircleResult, segments = 64): Vector3Tuple[] {
  const radial: Vector3Tuple = [
    result.points[0].position[0] - result.center[0],
    result.points[0].position[1] - result.center[1],
    result.points[0].position[2] - result.center[2],
  ]
  const radialLength = Math.hypot(...radial)
  const firstAxis: Vector3Tuple = [
    radial[0] / radialLength,
    radial[1] / radialLength,
    radial[2] / radialLength,
  ]
  const secondAxis: Vector3Tuple = [
    result.normal[1] * firstAxis[2] - result.normal[2] * firstAxis[1],
    result.normal[2] * firstAxis[0] - result.normal[0] * firstAxis[2],
    result.normal[0] * firstAxis[1] - result.normal[1] * firstAxis[0],
  ]
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = 2 * Math.PI * index / segments
    return [
      result.center[0] + result.radius * (Math.cos(angle) * firstAxis[0] + Math.sin(angle) * secondAxis[0]),
      result.center[1] + result.radius * (Math.cos(angle) * firstAxis[1] + Math.sin(angle) * secondAxis[1]),
      result.center[2] + result.radius * (Math.cos(angle) * firstAxis[2] + Math.sin(angle) * secondAxis[2]),
    ]
  })
}

function boxEdges(result: BoxResult): readonly [Vector3Tuple, Vector3Tuple][] {
  const [x0, y0, z0] = result.min
  const [x1, y1, z1] = result.max
  const corners: Vector3Tuple[] = [
    [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
  ]
  return [
    [corners[0], corners[1]], [corners[0], corners[2]], [corners[1], corners[3]], [corners[2], corners[3]],
    [corners[4], corners[5]], [corners[4], corners[6]], [corners[5], corners[7]], [corners[6], corners[7]],
    [corners[0], corners[4]], [corners[1], corners[5]], [corners[2], corners[6]], [corners[3], corners[7]],
  ]
}

export const pointToolDefinition = createFixedPointTool<BasicToolResult>({
  id: POINT_TOOL_ID,
  label: 'Point Marker',
  pointCount: 1,
  pickPolicy: commonPolicy,
  computeResult: computePointResult,
  createOverlays: ({ points: pointsValue, hover }) => {
    if (pointsValue.length) return points(pointsValue, COLORS.point)
    return hover ? [{ kind: 'point', key: 'hover-point', position: hover.localPosition, color: COLORS.point, size: 7 }] : []
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

export const circleToolDefinition = createFixedPointTool<BasicToolResult>({
  id: CIRCLE_TOOL_ID,
  label: 'Circle',
  pointCount: 3,
  pickPolicy: commonPolicy,
  computeResult: computeCircleResult,
  createOverlays: ({ points: pointsValue, hover, result }) => {
    const primitives = points(pointsValue, COLORS.circle)
    if (result?.kind === 'circle') {
      primitives.push({ kind: 'polyline', key: 'circle', points: circlePoints(result), color: COLORS.circle, width: 2 })
      primitives.push({ kind: 'label', key: 'circle-radius', position: result.points[0].position, text: `r ${formatNumber(result.radius)} ${result.unit}`, color: COLORS.circle })
    }
    return [...primitives, ...rubberBand(pointsValue, hover, COLORS.circle)]
  },
  inspector: {
    title: 'Circle',
    fields: [
      { key: 'radius', label: 'Radius', valuePath: 'radius', format: 'distance' },
      { key: 'circumference', label: 'Circumference', valuePath: 'circumference', format: 'distance' },
      { key: 'center', label: 'Center', valuePath: 'center', format: 'vector' },
    ],
  },
})

export const areaToolDefinition = createOpenPointTool<BasicToolResult>({
  id: AREA_TOOL_ID,
  label: 'Area',
  minPoints: 3,
  pickPolicy: commonPolicy,
  computeResult: computeAreaResult,
  createOverlays: ({ points: pointsValue, hover, result }) => {
    const primitives = points(pointsValue, COLORS.area)
    if (pointsValue.length >= 2) {
      const positions = pointsValue.map(({ localPosition }) => localPosition)
      primitives.push({
        kind: 'polyline',
        key: 'area-outline',
        points: result?.kind === 'area' ? [...positions, positions[0]] : positions,
        color: COLORS.area,
        width: 2,
      })
    }
    if (result?.kind === 'area') primitives.push({
      kind: 'label', key: 'area-label', position: result.centroid,
      text: `${formatNumber(result.area)} ${result.unit}`, color: COLORS.area,
    })
    return [...primitives, ...rubberBand(pointsValue, hover, COLORS.area)]
  },
  inspector: {
    title: 'Area',
    fields: [
      { key: 'area', label: 'Area', valuePath: 'area', format: 'number', unit: 'model units²' },
      { key: 'centroid', label: 'Centroid', valuePath: 'centroid', format: 'vector' },
    ],
  },
})

export const boxToolDefinition = createFixedPointTool<BasicToolResult>({
  id: BOX_TOOL_ID,
  label: 'Box',
  pointCount: 2,
  pickPolicy: commonPolicy,
  computeResult: computeBoxResult,
  createOverlays: ({ points: pointsValue, hover, result }) => {
    const primitives = points(pointsValue, COLORS.box)
    if (result?.kind === 'box') {
      boxEdges(result).forEach((edge, index) => primitives.push({
        kind: 'polyline', key: `box-edge-${index}`, points: edge, color: COLORS.box, width: 2,
      }))
      primitives.push({
        kind: 'label', key: 'box-label', position: result.center,
        text: `${formatNumber(result.volume)} ${result.unit}³`, color: COLORS.box,
      })
    }
    return [...primitives, ...rubberBand(pointsValue, hover, COLORS.box)]
  },
  inspector: {
    title: 'Box',
    fields: [
      { key: 'dimensions', label: 'Dimensions', valuePath: 'dimensions', format: 'vector' },
      { key: 'volume', label: 'Volume', valuePath: 'volume', format: 'number', unit: 'model units³' },
      { key: 'center', label: 'Center', valuePath: 'center', format: 'vector' },
    ],
  },
})

export const BASIC_TOOL_DEFINITIONS: Readonly<Record<BasicToolId, ToolDefinition<BasicToolResult>>> = {
  point: pointToolDefinition,
  line: lineToolDefinition,
  sphere: sphereToolDefinition,
  polyline: polylineToolDefinition,
  angle: angleToolDefinition,
  circle: circleToolDefinition,
  area: areaToolDefinition,
  box: boxToolDefinition,
}

export const BASIC_TOOLS = Object.values(BASIC_TOOL_DEFINITIONS)

export function basicToolLabel(result: BasicToolResult): string {
  return basicToolResultSummary(result)
}
