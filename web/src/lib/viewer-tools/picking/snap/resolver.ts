import * as THREE from 'three'
import type { PickPolicy, PickResult, SnapType, Vector3Tuple } from '../../types'
import { isSurfacePickable } from '../layers'
import { cadSnapCandidates } from './cad'
import { meshFeatureCandidates, meshVertexCandidates } from './mesh'
import { projectWorldToScreen, screenDistance } from './projection'
import { createSnapCycleState, selectedSnapCandidate, snapStatusModel } from './state'
import {
  pickResultSnapType,
  type SnapCandidate,
  type SnapCandidateKind,
  type SnapPickResult,
  type SnapResolution,
  type SnapResolveRequest,
  type SnapResolver,
  type SnapToolPolicy,
} from './types'

const DEFAULT_TOLERANCE_PX = 12
const DEFAULT_KIND_PRIORITY: Readonly<Record<SnapCandidateKind, number>> = {
  'cad-vertex': 0,
  'mesh-vertex': 1,
  'cad-edge': 2,
  convex: 3,
  concave: 3,
  sharp: 3,
  surface: 100,
}

export class DefaultSnapResolver implements SnapResolver {
  resolve(request: SnapResolveRequest): SnapResolution {
    const startedAt = now()
    const emptyMetrics = {
      inspectedTriangles: 0,
      skippedCadCandidates: 0,
      featureFallback: 'unavailable' as const,
    }
    if (
      !validRequest(request)
      || !isSurfacePickable(request.intersection.object)
      || !(request.context.isObjectEligible?.(request.intersection.object) ?? true)
    ) {
      const state = createSnapCycleState([], Boolean(request.altKey))
      return {
        candidates: [],
        selected: null,
        status: snapStatusModel(state),
        metrics: { ...emptyMetrics, elapsedMs: now() - startedAt },
      }
    }

    const tolerancePx = request.tolerancePx ?? DEFAULT_TOLERANCE_PX
    const surface = surfaceCandidate(request)
    if (request.altKey) {
      const candidates = surface ? [surface] : []
      const state = createSnapCycleState(candidates, true)
      return {
        candidates,
        selected: selectedSnapCandidate(state),
        status: snapStatusModel(state),
        metrics: { ...emptyMetrics, featureFallback: 'not-needed', elapsedMs: now() - startedAt },
      }
    }

    const topology = request.context.cadTopology?.candidatesForIntersection(request.intersection)
    const cad = topology ? cadSnapCandidates({
      topology,
      context: request.context,
      camera: request.camera,
      viewport: request.viewport,
      pointer: request.screenPosition,
      tolerancePx,
      maxCandidates: request.limits?.maxCadCandidates,
    }) : { candidates: [], skipped: 0 }
    const vertices = meshVertexCandidates(
      request.intersection,
      request.camera,
      request.viewport,
      request.screenPosition,
      tolerancePx,
    )

    const hasCadFeatures = cad.candidates.some(isFeatureCandidate)
    const wantsFeatures = policyAllowsFeatures(request.toolPolicy)
    const meshFeatures = !hasCadFeatures && wantsFeatures
      ? meshFeatureCandidates(request.intersection, vertices, request.limits)
      : {
          candidates: [] as readonly SnapCandidate[],
          inspectedTriangles: 0,
          status: 'unavailable' as const,
        }
    const featureFallback = hasCadFeatures || !wantsFeatures ? 'not-needed' : meshFeatures.status
    const candidates = rankSnapCandidates(
      [
        ...cad.candidates,
        ...vertices,
        ...meshFeatures.candidates,
        ...(surface ? [surface] : []),
      ].filter((candidate) => policyAllows(request.toolPolicy, candidate.kind)),
      request.toolPolicy,
    )
    const state = createSnapCycleState(candidates)
    return {
      candidates,
      selected: selectedSnapCandidate(state),
      status: snapStatusModel(state),
      metrics: {
        elapsedMs: now() - startedAt,
        inspectedTriangles: meshFeatures.inspectedTriangles,
        skippedCadCandidates: cad.skipped,
        featureFallback,
      },
    }
  }
}

export function rankSnapCandidates(
  candidates: readonly SnapCandidate[],
  policy?: SnapToolPolicy,
): readonly SnapCandidate[] {
  return candidates.map((candidate, order) => ({ candidate, order })).sort((left, right) => {
    const priority = candidatePriority(left.candidate, policy) - candidatePriority(right.candidate, policy)
    if (priority !== 0) return priority
    const distance = left.candidate.screenDistancePx - right.candidate.screenDistancePx
    if (Math.abs(distance) > Number.EPSILON) return distance
    const confidence = right.candidate.confidence - left.candidate.confidence
    if (Math.abs(confidence) > Number.EPSILON) return confidence
    if (left.candidate.source !== right.candidate.source) return left.candidate.source === 'cad' ? -1 : 1
    return left.order - right.order
  }).map(({ candidate }) => candidate)
}

/** Bridges the existing ToolDefinition.pickPolicy without coupling the resolver to a tool. */
export function snapPolicyFromPickPolicy(policy: PickPolicy): SnapToolPolicy {
  if (!policy.snapTypes) return {}
  const allowed = policy.snapTypes.flatMap(snapTypeKinds)
  return { allowed }
}

export function applySnapCandidate(
  basePick: PickResult,
  candidate: SnapCandidate,
  worldToLocal: (worldPosition: THREE.Vector3) => Vector3Tuple,
): SnapPickResult {
  const position = candidate.worldPosition
  return {
    ...basePick,
    localPosition: worldToLocal(position.clone()),
    worldPosition: [position.x, position.y, position.z],
    entityId: candidate.stableId ?? basePick.entityId,
    entityType: candidate.kind === 'cad-edge'
      ? 'edge'
      : candidate.kind === 'cad-vertex' || candidate.kind === 'mesh-vertex'
        ? 'vertex'
        : candidate.kind === 'surface' ? basePick.entityType : 'point',
    vertexIndex: candidate.vertexIndex,
    snap: {
      type: pickResultSnapType(candidate.kind),
      distance: candidate.screenDistancePx,
      confidence: candidate.confidence,
      method: candidate.method,
      stableId: candidate.stableId,
      classification: candidate.classification,
    },
  }
}

function surfaceCandidate(request: SnapResolveRequest): SnapCandidate | null {
  const projected = projectWorldToScreen(request.intersection.point, request.camera, request.viewport)
  if (!projected) return null
  return {
    kind: 'surface',
    worldPosition: request.intersection.point.clone(),
    screenDistancePx: screenDistance(request.screenPosition, projected),
    method: 'surface-intersection',
    confidence: 1,
    source: 'surface',
  }
}

function validRequest(request: SnapResolveRequest): boolean {
  return request.viewport.width > 0
    && request.viewport.height > 0
    && (request.tolerancePx ?? DEFAULT_TOLERANCE_PX) >= 0
}

function policyAllows(policy: SnapToolPolicy | undefined, kind: SnapCandidateKind): boolean {
  return !policy?.allowed || policy.allowed.includes(kind)
}

function policyAllowsFeatures(policy: SnapToolPolicy | undefined): boolean {
  // Mesh inference is deliberately opt-in because it performs an adjacency scan
  // and has lower semantic confidence than CAD topology.
  return policy?.allowed?.some((kind) => kind === 'convex' || kind === 'concave' || kind === 'sharp') ?? false
}

function candidatePriority(candidate: SnapCandidate, policy: SnapToolPolicy | undefined): number {
  return policy?.priority?.[candidate.kind] ?? DEFAULT_KIND_PRIORITY[candidate.kind]
}

function isFeatureCandidate(candidate: SnapCandidate): boolean {
  return candidate.kind === 'convex' || candidate.kind === 'concave' || candidate.kind === 'sharp'
}

function snapTypeKinds(type: SnapType): readonly SnapCandidateKind[] {
  if (type === 'feature') return ['convex', 'concave', 'sharp']
  if (type === 'none') return []
  return [type]
}

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
