import type * as THREE from 'three'
import { closestPointOnScreenPolyline, projectWorldToScreen, screenDistance } from './projection'
import type {
  CadTopologyCandidates,
  ScreenPosition,
  SnapCandidate,
  SnapViewerContext,
} from './types'
import type { PointerViewport } from '../engine'

const DEFAULT_MAX_CAD_CANDIDATES = 2_000

export interface CadCandidateResult {
  readonly candidates: readonly SnapCandidate[]
  readonly skipped: number
}

export function cadSnapCandidates(input: {
  readonly topology: CadTopologyCandidates
  readonly context: SnapViewerContext
  readonly camera: THREE.Camera
  readonly viewport: PointerViewport
  readonly pointer: ScreenPosition
  readonly tolerancePx: number
  readonly maxCandidates?: number
}): CadCandidateResult {
  const limit = input.maxCandidates ?? DEFAULT_MAX_CAD_CANDIDATES
  const result: SnapCandidate[] = []
  let visited = 0

  const accept = (stableId: string, object: THREE.Object3D | undefined, visible = true): boolean => {
    if (visited >= limit) return false
    visited += 1
    return Boolean(stableId) && visible && hierarchyIsEligible(object)
      && (object ? (input.context.isObjectEligible?.(object) ?? true) : true)
      && (input.context.isTopologyEntityVisible?.(stableId) ?? true)
  }

  for (const vertex of input.topology.vertices ?? []) {
    if (visited >= limit) break
    if (!accept(vertex.id, vertex.object, vertex.visible)) continue
    const screen = projectWorldToScreen(vertex.worldPosition, input.camera, input.viewport)
    if (!screen) continue
    const distance = screenDistance(input.pointer, screen)
    if (distance > input.tolerancePx) continue
    result.push({
      kind: 'cad-vertex',
      worldPosition: vertex.worldPosition.clone(),
      screenDistancePx: distance,
      method: 'cad-topology',
      confidence: 1,
      source: 'cad',
      stableId: vertex.id,
    })
  }

  for (const edge of input.topology.edges ?? []) {
    if (visited >= limit) break
    if (!accept(edge.id, edge.object, edge.visible) || edge.worldPoints.length < 2) continue
    const closest = closestPointOnScreenPolyline(
      edge.worldPoints,
      input.camera,
      input.viewport,
      input.pointer,
    )
    if (!closest || closest.screenDistancePx > input.tolerancePx) continue
    result.push({
      kind: 'cad-edge',
      worldPosition: closest.worldPosition,
      screenDistancePx: closest.screenDistancePx,
      method: 'cad-topology',
      confidence: 0.98,
      source: 'cad',
      stableId: edge.id,
    })
  }

  for (const feature of input.topology.features ?? []) {
    if (visited >= limit) break
    if (!accept(feature.id, feature.object, feature.visible)) continue
    const screen = projectWorldToScreen(feature.worldPosition, input.camera, input.viewport)
    if (!screen) continue
    const distance = screenDistance(input.pointer, screen)
    if (distance > input.tolerancePx) continue
    result.push({
      kind: feature.classification,
      classification: feature.classification,
      worldPosition: feature.worldPosition.clone(),
      screenDistancePx: distance,
      method: 'cad-topology',
      confidence: Math.max(0, Math.min(1, feature.confidence)),
      source: 'cad',
      stableId: feature.id,
    })
  }

  const total = (input.topology.vertices?.length ?? 0)
    + (input.topology.edges?.length ?? 0)
    + (input.topology.features?.length ?? 0)
  return { candidates: result, skipped: Math.max(0, total - visited) }
}

function hierarchyIsEligible(object: THREE.Object3D | undefined): boolean {
  let current: THREE.Object3D | null | undefined = object
  while (current) {
    const data = current.userData
    const type = String(data.uvfType ?? '').toLowerCase()
    if (
      !current.visible
      || data.pickable === false
      || data.viewerOverlay === true
      || data.annotationOverlay === true
      || data.uvfWireframeOverlay === true
      || data.groupId === '__wireframe__'
      || type === 'overlay'
      || type === 'annotation'
      || type === 'annotationoverlay'
    ) return false
    current = current.parent
  }
  return true
}
