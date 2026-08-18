import * as THREE from 'three'
import type {
  CoordinateFrame,
  OverlayPrimitive,
  ResourceRef,
  Vector3Tuple,
} from '../types'
import { createLabelTexture } from './label'
import type {
  OverlayAnnotation,
  OverlayObjectMetadata,
  OverlayState,
  ViewerOverlayFrame,
  ViewerOverlayLayerOptions,
} from './types'

// Keep the renderer default aligned with the Picking Engine's excluded layer.
const DEFAULT_LAYER = 31
const DEFAULT_RENDER_ORDER = 100
const DEFAULT_POINT_SIZE = 8
const DEFAULT_LABEL_FONT_SIZE = 14

type OverlayRenderable = THREE.Points | THREE.Line | THREE.Mesh | THREE.Sprite

interface OverlayEntry {
  kind: OverlayPrimitive['kind']
  object: OverlayRenderable
}

function resourceMatches(left: ResourceRef, right: ResourceRef): boolean {
  return (
    left.id === right.id &&
    left.type === right.type &&
    (left.version === undefined || right.version === undefined || left.version === right.version)
  )
}

export function overlayResourceKey(resourceRef: ResourceRef): string {
  return `${resourceRef.type}:${resourceRef.id}:${resourceRef.version ?? ''}`
}

export function transformOverlayPosition(
  position: Vector3Tuple,
  coordinateFrame: CoordinateFrame,
  resourceRef: ResourceRef,
  assetWorldMatrix = new THREE.Matrix4(),
): THREE.Vector3 | null {
  const result = new THREE.Vector3(...position)
  if (coordinateFrame.kind === 'world') return result
  if (!resourceMatches(coordinateFrame.resourceRef, resourceRef)) return null
  return result.applyMatrix4(assetWorldMatrix)
}

function stateColor(state: OverlayState): string {
  if (state === 'hover') return '#ffd166'
  if (state === 'draft') return '#f08a5d'
  return '#e06b3c'
}

function stateRenderOffset(state: OverlayState): number {
  if (state === 'hover') return 2
  if (state === 'draft') return 1
  return 0
}

function makeNonPickable(object: OverlayRenderable, layer: number): void {
  object.layers.set(layer)
  // Overlay geometry is updated interactively. Opt out of object-level frustum
  // culling so a stale Three.js bounding volume cannot hide an otherwise
  // visible measurement primitive after a camera move or zoom.
  object.frustumCulled = false
  object.raycast = () => undefined
}

function materialsOf(object: OverlayRenderable): THREE.Material[] {
  if (!('material' in object)) return []
  return Array.isArray(object.material) ? object.material : [object.material]
}

export function disposeOverlayObject(object: OverlayRenderable): void {
  if ('geometry' in object) object.geometry.dispose()
  for (const material of materialsOf(object)) {
    if (material instanceof THREE.SpriteMaterial && material.map) material.map.dispose()
    material.dispose()
  }
}

function isRenderable(primitive: OverlayPrimitive): boolean {
  if (primitive.kind === 'polyline') return primitive.points.length > 0
  if (primitive.kind === 'sphere') return Number.isFinite(primitive.radius) && primitive.radius > 0
  if (primitive.kind === 'box') return primitive.size.every((value) => Number.isFinite(value) && value > 0)
  if (primitive.kind === 'cylinder') {
    return Number.isFinite(primitive.radius) && primitive.radius > 0
      && Number.isFinite(primitive.height) && primitive.height > 0
      && primitive.axis.every(Number.isFinite)
      && Math.hypot(...primitive.axis) > 0
  }
  if (primitive.kind === 'label') return primitive.text.length > 0
  return true
}

export class ViewerOverlayLayer {
  readonly group: THREE.Group

  private readonly scene: THREE.Scene
  private readonly options: Required<ViewerOverlayLayerOptions>
  private readonly entries = new Map<string, OverlayEntry>()
  private currentResourceKey: string | null = null
  private disposed = false

  constructor(scene: THREE.Scene, options: ViewerOverlayLayerOptions = {}) {
    this.scene = scene
    this.options = {
      layer: options.layer ?? DEFAULT_LAYER,
      renderOrder: options.renderOrder ?? DEFAULT_RENDER_ORDER,
      depthTest: options.depthTest ?? true,
      pointSize: options.pointSize ?? DEFAULT_POINT_SIZE,
      labelFontSize: options.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE,
      labelPixelRatio:
        options.labelPixelRatio ??
        (typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1)),
    }
    this.group = new THREE.Group()
    this.group.name = '__viewer_annotation_overlays__'
    this.group.layers.set(this.options.layer)
    this.group.renderOrder = this.options.renderOrder
    this.group.userData = { pickable: false, viewerOverlay: true }
    this.scene.add(this.group)
  }

  get size(): number {
    return this.entries.size
  }

  getObject(annotationId: string, primitiveKey: string): OverlayRenderable | undefined {
    return this.entries.get(this.entryKey(annotationId, primitiveKey))?.object
  }

  update(frame: ViewerOverlayFrame): void {
    if (this.disposed) throw new Error('ViewerOverlayLayer has been disposed')
    const nextResourceKey = overlayResourceKey(frame.resourceRef)
    if (this.currentResourceKey !== null && this.currentResourceKey !== nextResourceKey) {
      this.clear()
    }
    this.currentResourceKey = nextResourceKey
    this.group.visible = frame.visible !== false

    const activeKeys = new Set<string>()
    const sources: readonly [readonly OverlayAnnotation[], OverlayState][] = [
      [frame.saved ?? [], 'saved'],
      [frame.draft ?? [], 'draft'],
      [frame.hover ?? [], 'hover'],
    ]
    for (const [annotations, defaultState] of sources) {
      for (const annotation of annotations) {
        this.updateAnnotation(annotation, frame, activeKeys, defaultState)
      }
    }
    for (const [key, entry] of this.entries) {
      if (activeKeys.has(key)) continue
      this.removeEntry(key, entry)
    }
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.removeEntry(key, entry)
  }

  dispose(): void {
    if (this.disposed) return
    this.clear()
    this.scene.remove(this.group)
    this.disposed = true
    this.currentResourceKey = null
  }

  private updateAnnotation(
    annotation: OverlayAnnotation,
    frame: ViewerOverlayFrame,
    activeKeys: Set<string>,
    defaultState: OverlayState,
  ): void {
    const state = annotation.state ?? defaultState
    for (const primitive of annotation.primitives) {
      const key = this.entryKey(annotation.annotationId, primitive.key)
      if (activeKeys.has(key)) continue
      if (!isRenderable(primitive)) continue
      const positions = this.primitivePositions(
        primitive,
        annotation.coordinateFrame,
        frame.resourceRef,
        frame.assetWorldMatrix,
      )
      if (!positions) continue
      activeKeys.add(key)
      let entry = this.entries.get(key)
      if (entry?.kind !== primitive.kind) {
        if (entry) this.removeEntry(key, entry)
        entry = undefined
      }
      if (!entry) {
        const object = this.createObject(primitive, positions, state)
        entry = { kind: primitive.kind, object }
        this.entries.set(key, entry)
        this.group.add(object)
      }
      this.updateObject(
        entry.object,
        primitive,
        positions,
        annotation,
        state,
        this.radiusScale(annotation.coordinateFrame, frame.assetWorldMatrix),
        this.frameQuaternion(annotation.coordinateFrame, frame.assetWorldMatrix),
      )
    }
  }

  private primitivePositions(
    primitive: OverlayPrimitive,
    coordinateFrame: CoordinateFrame,
    resourceRef: ResourceRef,
    assetWorldMatrix?: THREE.Matrix4,
  ): THREE.Vector3[] | null {
    const tuples = primitive.kind === 'point' || primitive.kind === 'label'
      ? [primitive.position]
      : primitive.kind === 'polyline' ? primitive.points : [primitive.center]
    const positions: THREE.Vector3[] = []
    for (const tuple of tuples) {
      const position = transformOverlayPosition(tuple, coordinateFrame, resourceRef, assetWorldMatrix)
      if (!position) return null
      positions.push(position)
    }
    return positions
  }

  private createObject(
    primitive: OverlayPrimitive,
    positions: THREE.Vector3[],
    state: OverlayState,
  ): OverlayRenderable {
    const color = primitive.color ?? stateColor(state)
    let object: OverlayRenderable
    if (primitive.kind === 'point') {
      object = new THREE.Points(
        new THREE.BufferGeometry().setFromPoints(positions),
        new THREE.PointsMaterial({
          color,
          size: primitive.size ?? this.options.pointSize,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
          transparent: (primitive.opacity ?? 1) < 1,
          opacity: primitive.opacity ?? 1,
        }),
      )
    } else if (primitive.kind === 'polyline') {
      const material = primitive.dashed
        ? new THREE.LineDashedMaterial({ color, linewidth: 1 })
        : new THREE.LineBasicMaterial({ color, linewidth: 1 })
      material.depthTest = this.options.depthTest
      material.depthWrite = false
      material.transparent = true
      object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(positions), material)
      if (object.material instanceof THREE.LineDashedMaterial) object.computeLineDistances()
    } else if (primitive.kind === 'sphere') {
      object = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 12),
        new THREE.MeshBasicMaterial({
          color,
          opacity: primitive.opacity ?? 1,
          transparent: (primitive.opacity ?? 1) < 1,
          depthTest: this.options.depthTest,
          depthWrite: false,
        }),
      )
    } else if (primitive.kind === 'box' || primitive.kind === 'cylinder') {
      const geometry = primitive.kind === 'box'
        ? new THREE.BoxGeometry(1, 1, 1)
        : new THREE.CylinderGeometry(1, 1, 1, 32, 1, true)
      object = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          opacity: primitive.opacity ?? 0.55,
          transparent: true,
          wireframe: true,
          depthTest: this.options.depthTest,
          depthWrite: false,
        }),
      )
    } else {
      const label = createLabelTexture(
        primitive.text,
        color,
        this.options.labelFontSize,
        this.options.labelPixelRatio,
      )
      object = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: label.texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          sizeAttenuation: false,
        }),
      )
      const screenHeight = 0.045
      object.scale.set(screenHeight * label.aspectRatio, screenHeight, 1)
      object.userData.labelSignature = `${primitive.text}\u0000${color}`
    }
    makeNonPickable(object, this.options.layer)
    return object
  }

  private updateObject(
    object: OverlayRenderable,
    primitive: OverlayPrimitive,
    positions: THREE.Vector3[],
    annotation: OverlayAnnotation,
    state: OverlayState,
    radiusScale: number,
    frameQuaternion: THREE.Quaternion,
  ): void {
    const color = primitive.color ?? stateColor(state)
    const previousLabelSignature = object.userData.labelSignature as string | undefined
    object.visible = annotation.visible !== false
    object.renderOrder = this.options.renderOrder + stateRenderOffset(state)
    object.name = `viewer-overlay:${annotation.annotationId}:${primitive.key}`
    const metadata: OverlayObjectMetadata = {
      annotationId: annotation.annotationId,
      primitiveKey: primitive.key,
      primitiveKind: primitive.kind,
      state,
      pickable: false,
      ...(primitive.kind === 'polyline'
        ? { requestedLineWidth: primitive.width ?? 1, effectiveLineWidth: 1 }
        : {}),
    }
    object.userData = metadata
    object.layers.set(this.options.layer)

    if (primitive.kind === 'point' && object instanceof THREE.Points) {
      object.geometry.setFromPoints(positions)
      object.geometry.attributes.position.needsUpdate = true
      const material = object.material as THREE.PointsMaterial
      material.color.set(color)
      material.size = primitive.size ?? this.options.pointSize
      material.opacity = primitive.opacity ?? 1
      material.transparent = material.opacity < 1
      material.needsUpdate = true
      return
    }
    if (primitive.kind === 'polyline' && object instanceof THREE.Line) {
      object.geometry.setFromPoints(positions)
      object.geometry.attributes.position.needsUpdate = true
      const isDashed = object.material instanceof THREE.LineDashedMaterial
      if (isDashed !== Boolean(primitive.dashed)) {
        ;(object.material as THREE.Material).dispose()
        object.material = primitive.dashed
          ? new THREE.LineDashedMaterial({ color, linewidth: 1 })
          : new THREE.LineBasicMaterial({ color, linewidth: 1 })
        object.material.depthTest = this.options.depthTest
        object.material.depthWrite = false
        object.material.transparent = true
      }
      const material = object.material as THREE.LineBasicMaterial | THREE.LineDashedMaterial
      material.color.set(color)
      material.linewidth = 1
      material.needsUpdate = true
      if (material instanceof THREE.LineDashedMaterial) object.computeLineDistances()
      return
    }
    if (primitive.kind === 'sphere' && object instanceof THREE.Mesh) {
      object.position.copy(positions[0])
      object.scale.setScalar(primitive.radius * radiusScale)
      const material = object.material as THREE.MeshBasicMaterial
      material.color.set(color)
      material.opacity = primitive.opacity ?? 1
      material.transparent = material.opacity < 1
      material.needsUpdate = true
      return
    }
    if (primitive.kind === 'box' && object instanceof THREE.Mesh) {
      object.position.copy(positions[0])
      object.scale.set(...primitive.size).multiplyScalar(radiusScale)
      const rotationAxis = new THREE.Vector3(...(primitive.rotationAxis ?? [0, 0, 1]))
      const localRotation = rotationAxis.lengthSq() > 0
        ? new THREE.Quaternion().setFromAxisAngle(rotationAxis.normalize(), primitive.rotationAngleRadians ?? 0)
        : new THREE.Quaternion()
      object.quaternion.copy(frameQuaternion).multiply(localRotation)
      this.updateRegionMaterial(object, color, primitive.opacity)
      return
    }
    if (primitive.kind === 'cylinder' && object instanceof THREE.Mesh) {
      object.position.copy(positions[0])
      object.scale.set(primitive.radius * radiusScale, primitive.height * radiusScale, primitive.radius * radiusScale)
      const axis = new THREE.Vector3(...primitive.axis).normalize()
      const localRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis)
      object.quaternion.copy(frameQuaternion).multiply(localRotation)
      this.updateRegionMaterial(object, color, primitive.opacity)
      return
    }
    if (primitive.kind === 'label' && object instanceof THREE.Sprite) {
      object.position.copy(positions[0])
      const labelSignature = `${primitive.text}\u0000${color}`
      object.userData.labelSignature = labelSignature
      if (previousLabelSignature === labelSignature) return
      const material = object.material as THREE.SpriteMaterial
      const previousTexture = material.map
      const label = createLabelTexture(
        primitive.text,
        color,
        this.options.labelFontSize,
        this.options.labelPixelRatio,
      )
      material.map = label.texture
      material.needsUpdate = true
      previousTexture?.dispose()
      const screenHeight = 0.045
      object.scale.set(screenHeight * label.aspectRatio, screenHeight, 1)
    }
  }

  private radiusScale(coordinateFrame: CoordinateFrame, assetWorldMatrix?: THREE.Matrix4): number {
    if (coordinateFrame.kind === 'world' || !assetWorldMatrix) return 1
    const scale = new THREE.Vector3()
    assetWorldMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale)
    return Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z))
  }

  private frameQuaternion(coordinateFrame: CoordinateFrame, assetWorldMatrix?: THREE.Matrix4): THREE.Quaternion {
    if (coordinateFrame.kind === 'world' || !assetWorldMatrix) return new THREE.Quaternion()
    const quaternion = new THREE.Quaternion()
    assetWorldMatrix.decompose(new THREE.Vector3(), quaternion, new THREE.Vector3())
    return quaternion
  }

  private updateRegionMaterial(object: THREE.Mesh, color: string, opacity?: number): void {
    const material = object.material as THREE.MeshBasicMaterial
    material.color.set(color)
    material.opacity = opacity ?? 0.55
    material.transparent = true
    material.needsUpdate = true
  }

  private entryKey(annotationId: string, primitiveKey: string): string {
    return `${annotationId}\u0000${primitiveKey}`
  }

  private removeEntry(key: string, entry: OverlayEntry): void {
    this.group.remove(entry.object)
    disposeOverlayObject(entry.object)
    this.entries.delete(key)
  }
}
