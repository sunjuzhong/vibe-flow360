import type * as THREE from 'three'
import type {
  CoordinateFrame,
  OverlayPrimitive,
  ResourceRef,
} from '../types'

export type OverlayState = 'saved' | 'draft' | 'hover'

export interface OverlayAnnotation {
  readonly annotationId: string
  readonly coordinateFrame: CoordinateFrame
  readonly primitives: readonly OverlayPrimitive[]
  readonly visible?: boolean
  readonly state?: OverlayState
}

export interface ViewerOverlayFrame {
  readonly resourceRef: ResourceRef
  readonly assetWorldMatrix?: THREE.Matrix4
  readonly saved?: readonly OverlayAnnotation[]
  readonly draft?: readonly OverlayAnnotation[]
  readonly hover?: readonly OverlayAnnotation[]
  readonly visible?: boolean
}

export interface ViewerOverlayLayerOptions {
  /** Three.js layer reserved for overlays. Picking raycasters should not enable it. */
  readonly layer?: number
  readonly renderOrder?: number
  /** Whether spatial geometry (polylines and spheres) is occluded by scene depth. */
  readonly depthTest?: boolean
  readonly pointSize?: number
  readonly labelFontSize?: number
  readonly labelPixelRatio?: number
}

export interface OverlayObjectMetadata {
  readonly annotationId: string
  readonly primitiveKey: string
  readonly primitiveKind: OverlayPrimitive['kind']
  readonly state: OverlayState
  readonly pickable: false
  readonly requestedLineWidth?: number
  readonly effectiveLineWidth?: number
}
