import type * as THREE from 'three'
import type { PickResult, SnapType, Vector3Tuple } from '../../types'
import type { PointerViewport } from '../engine'

export type FeatureClassification = 'convex' | 'concave' | 'sharp'
export type SnapCandidateKind =
  | 'surface'
  | 'mesh-vertex'
  | 'cad-edge'
  | 'cad-vertex'
  | FeatureClassification

export type SnapCandidateMethod =
  | 'surface-intersection'
  | 'mesh-triangle-vertex'
  | 'cad-topology'
  | 'mesh-angle-deficit'
  | 'mesh-dihedral'

export interface ScreenPosition {
  readonly x: number
  readonly y: number
}

export interface CadVertex {
  /** Stable topology identifier from the source model, not a Three object UUID. */
  readonly id: string
  readonly worldPosition: THREE.Vector3
  readonly object?: THREE.Object3D
  readonly visible?: boolean
}

export interface CadEdge {
  /** Stable topology identifier from the source model, not a Three object UUID. */
  readonly id: string
  /** World-space samples in topology order. Two points describe a straight edge. */
  readonly worldPoints: readonly THREE.Vector3[]
  readonly object?: THREE.Object3D
  readonly visible?: boolean
}

export interface CadFeaturePoint {
  /** Stable topology identifier from the source model, not a Three object UUID. */
  readonly id: string
  readonly worldPosition: THREE.Vector3
  readonly classification: FeatureClassification
  readonly confidence: number
  readonly object?: THREE.Object3D
  readonly visible?: boolean
}

export interface CadTopologyCandidates {
  readonly vertices?: readonly CadVertex[]
  readonly edges?: readonly CadEdge[]
  readonly features?: readonly CadFeaturePoint[]
}

/**
 * Narrow adapter boundary for Geometry/UVF topology. ViewerContext can implement
 * this without the snap package depending on viewer state or React.
 */
export interface CadTopologyProvider {
  readonly candidatesForIntersection: (
    intersection: THREE.Intersection<THREE.Object3D>,
  ) => CadTopologyCandidates | null
}

/** Narrow subset of ViewerContext needed by SnapResolver. */
export interface SnapViewerContext {
  readonly cadTopology?: CadTopologyProvider
  readonly isObjectEligible?: (object: THREE.Object3D) => boolean
  readonly isTopologyEntityVisible?: (stableId: string) => boolean
}

export interface SnapToolPolicy {
  readonly allowed?: readonly SnapCandidateKind[]
  /** Lower values are preferred. Unspecified kinds use the default ordering. */
  readonly priority?: Readonly<Partial<Record<SnapCandidateKind, number>>>
}

export interface SnapPerformanceLimits {
  /** Bounds the linear adjacency scan used only by mesh feature fallback. */
  readonly maxFeatureScanTriangles?: number
  /** Prevents pathological topology manifests from blocking a pointer event. */
  readonly maxCadCandidates?: number
}

export interface SnapResolveRequest {
  readonly intersection: THREE.Intersection<THREE.Object3D>
  readonly camera: THREE.Camera
  readonly screenPosition: ScreenPosition
  readonly viewport: PointerViewport
  readonly context: SnapViewerContext
  readonly tolerancePx?: number
  readonly toolPolicy?: SnapToolPolicy
  /** Alt temporarily bypasses all snapping and retains the base surface hit. */
  readonly altKey?: boolean
  readonly limits?: SnapPerformanceLimits
}

export interface SnapCandidate {
  readonly kind: SnapCandidateKind
  readonly worldPosition: THREE.Vector3
  readonly screenDistancePx: number
  readonly method: SnapCandidateMethod
  readonly confidence: number
  readonly source: 'surface' | 'mesh' | 'cad'
  readonly stableId?: string
  readonly vertexIndex?: number
  readonly classification?: FeatureClassification
}

export interface SnapResolutionMetrics {
  readonly elapsedMs: number
  readonly inspectedTriangles: number
  readonly skippedCadCandidates: number
  readonly featureFallback: 'not-needed' | 'complete' | 'degraded-limit' | 'unavailable'
}

export interface SnapStatusModel {
  readonly mode: 'active' | 'surface' | 'bypassed' | 'unavailable'
  readonly label: string
  readonly confidence?: number
  readonly candidateIndex: number
  readonly candidateCount: number
  readonly indicator?: {
    readonly position: Vector3Tuple
    readonly label: string
  }
}

export interface SnapResolution {
  readonly candidates: readonly SnapCandidate[]
  readonly selected: SnapCandidate | null
  readonly status: SnapStatusModel
  readonly metrics: SnapResolutionMetrics
}

export interface SnapResolver {
  readonly resolve: (request: SnapResolveRequest) => SnapResolution
}

export interface SnapPickResult extends PickResult {
  readonly snap: PickResult['snap'] & {
    readonly method: SnapCandidateMethod
    readonly stableId?: string
    readonly classification?: FeatureClassification
  }
}

export function pickResultSnapType(kind: SnapCandidateKind): SnapType {
  if (kind === 'convex' || kind === 'concave' || kind === 'sharp') return 'feature'
  return kind
}
