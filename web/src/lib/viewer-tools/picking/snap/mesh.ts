import * as THREE from 'three'
import { projectWorldToScreen, screenDistance } from './projection'
import type {
  FeatureClassification,
  ScreenPosition,
  SnapCandidate,
  SnapCandidateMethod,
  SnapPerformanceLimits,
} from './types'
import type { PointerViewport } from '../engine'

export interface MeshFeatureScanResult {
  readonly candidates: readonly SnapCandidate[]
  readonly inspectedTriangles: number
  readonly status: 'complete' | 'degraded-limit' | 'unavailable'
}

interface FeatureClassificationResult {
  readonly classification: FeatureClassification
  readonly confidence: number
  readonly method: SnapCandidateMethod
}

interface TriangleIndices {
  readonly a: number
  readonly b: number
  readonly c: number
}

const DEFAULT_MAX_FEATURE_SCAN_TRIANGLES = 20_000
const FEATURE_EPSILON_RADIANS = THREE.MathUtils.degToRad(8)
const SHARP_DIHEDRAL_RADIANS = THREE.MathUtils.degToRad(35)

export function meshVertexCandidates(
  intersection: THREE.Intersection<THREE.Object3D>,
  camera: THREE.Camera,
  viewport: PointerViewport,
  pointer: ScreenPosition,
  tolerancePx: number,
): readonly SnapCandidate[] {
  if (!(intersection.object instanceof THREE.Mesh)) return []
  const mesh = intersection.object
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  if (!position) return []
  const indices = hitTriangleIndices(intersection, geometry)
  if (!indices) return []
  mesh.updateWorldMatrix(true, false)

  return [...new Set([indices.a, indices.b, indices.c])].flatMap((vertexIndex) => {
    if (vertexIndex < 0 || vertexIndex >= position.count) return []
    const worldPosition = vectorFromAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld)
    const screen = projectWorldToScreen(worldPosition, camera, viewport)
    if (!screen) return []
    const distance = screenDistance(pointer, screen)
    if (distance > tolerancePx) return []
    return [{
      kind: 'mesh-vertex' as const,
      worldPosition,
      screenDistancePx: distance,
      method: 'mesh-triangle-vertex' as const,
      confidence: 0.75,
      source: 'mesh' as const,
      vertexIndex,
    }]
  })
}

export function meshFeatureCandidates(
  intersection: THREE.Intersection<THREE.Object3D>,
  vertexCandidates: readonly SnapCandidate[],
  limits: SnapPerformanceLimits = {},
): MeshFeatureScanResult {
  if (!(intersection.object instanceof THREE.Mesh)) {
    return { candidates: [], inspectedTriangles: 0, status: 'unavailable' }
  }
  const mesh = intersection.object
  const geometry = mesh.geometry
  const position = geometry.getAttribute('position')
  if (!position || vertexCandidates.length === 0) {
    return { candidates: [], inspectedTriangles: 0, status: 'unavailable' }
  }
  const triangleCount = geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor(position.count / 3)
  const maxTriangles = limits.maxFeatureScanTriangles ?? DEFAULT_MAX_FEATURE_SCAN_TRIANGLES
  if (triangleCount > maxTriangles) {
    return { candidates: [], inspectedTriangles: 0, status: 'degraded-limit' }
  }

  const candidates = vertexCandidates.flatMap((candidate) => {
    if (candidate.vertexIndex === undefined) return []
    const classification = classifyIndexedMeshVertex(geometry, candidate.vertexIndex)
    if (!classification) return []
    return [{
      ...candidate,
      kind: classification.classification,
      classification: classification.classification,
      confidence: classification.confidence,
      method: classification.method,
    }]
  })
  return { candidates, inspectedTriangles: triangleCount, status: 'complete' }
}

/** Exported for deterministic algorithm tests and offline topology profiling. */
export function classifyIndexedMeshVertex(
  geometry: THREE.BufferGeometry,
  vertexIndex: number,
): FeatureClassificationResult | null {
  const position = geometry.getAttribute('position')
  if (!position || vertexIndex < 0 || vertexIndex >= position.count) return null
  const incident: TriangleIndices[] = []
  const triangleCount = geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor(position.count / 3)
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const triangle = triangleIndices(geometry, triangleIndex)
    if (triangle.a === vertexIndex || triangle.b === vertexIndex || triangle.c === vertexIndex) {
      incident.push(triangle)
    }
  }
  if (incident.length < 2) return null

  let angleSum = 0
  let maxDihedral = 0
  const normals: THREE.Vector3[] = []
  const incidentEdgeCounts = new Map<string, number>()
  for (const triangle of incident) {
    const ordered = orderAtVertex(triangle, vertexIndex)
    if (!ordered) continue
    const center = vectorFromAttribute(position, vertexIndex)
    const first = vectorFromAttribute(position, ordered[0])
    const second = vectorFromAttribute(position, ordered[1])
    const firstDirection = first.clone().sub(center)
    const secondDirection = second.clone().sub(center)
    angleSum += firstDirection.angleTo(secondDirection)
    const normal = firstDirection.clone().cross(secondDirection).normalize()
    if (normal.lengthSq() > 0) normals.push(normal)
    for (const adjacent of ordered) {
      const key = `${Math.min(vertexIndex, adjacent)}:${Math.max(vertexIndex, adjacent)}`
      incidentEdgeCounts.set(key, (incidentEdgeCounts.get(key) ?? 0) + 1)
    }
  }
  for (let first = 0; first < normals.length; first += 1) {
    for (let second = first + 1; second < normals.length; second += 1) {
      maxDihedral = Math.max(maxDihedral, normals[first].angleTo(normals[second]))
    }
  }

  const isBoundary = [...incidentEdgeCounts.values()].some((count) => count === 1)
  const deficit = Math.PI * 2 - angleSum
  if (!isBoundary && Math.abs(deficit) >= FEATURE_EPSILON_RADIANS) {
    return {
      classification: deficit > 0 ? 'convex' : 'concave',
      confidence: clampConfidence(Math.abs(deficit) / Math.PI, incident.length),
      method: 'mesh-angle-deficit',
    }
  }
  if (maxDihedral >= SHARP_DIHEDRAL_RADIANS) {
    return {
      classification: 'sharp',
      confidence: clampConfidence(maxDihedral / Math.PI, incident.length),
      method: 'mesh-dihedral',
    }
  }
  return null
}

function hitTriangleIndices(
  intersection: THREE.Intersection<THREE.Object3D>,
  geometry: THREE.BufferGeometry,
): TriangleIndices | null {
  if (intersection.faceIndex !== undefined && intersection.faceIndex !== null) {
    return triangleIndices(geometry, intersection.faceIndex)
  }
  if (intersection.face) {
    return { a: intersection.face.a, b: intersection.face.b, c: intersection.face.c }
  }
  return null
}

function triangleIndices(geometry: THREE.BufferGeometry, triangleIndex: number): TriangleIndices {
  const offset = triangleIndex * 3
  const index = geometry.getIndex()
  return index
    ? { a: index.getX(offset), b: index.getX(offset + 1), c: index.getX(offset + 2) }
    : { a: offset, b: offset + 1, c: offset + 2 }
}

function orderAtVertex(triangle: TriangleIndices, vertexIndex: number): readonly [number, number] | null {
  if (triangle.a === vertexIndex) return [triangle.b, triangle.c]
  if (triangle.b === vertexIndex) return [triangle.c, triangle.a]
  if (triangle.c === vertexIndex) return [triangle.a, triangle.b]
  return null
}

function vectorFromAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
): THREE.Vector3 {
  return new THREE.Vector3(attribute.getX(index), attribute.getY(index), attribute.getZ(index))
}

function clampConfidence(signal: number, incidentFaces: number): number {
  const support = Math.min(1, incidentFaces / 6)
  return Math.min(0.9, Math.max(0.25, signal * 0.65 + support * 0.25))
}
