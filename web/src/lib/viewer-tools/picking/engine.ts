import * as THREE from 'three'
import type { CoordinateFrame, PickResult, ResourceRef, Vector3Tuple } from '../types'
import { isSurfacePickable, SURFACE_PICK_LAYER, VIEWER_OVERLAY_LAYER } from './layers'

export interface PointerCoordinates {
  readonly clientX: number
  readonly clientY: number
}

export interface PointerViewport {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export type PickCandidate = THREE.Intersection<THREE.Object3D>

export interface PickSceneOptions {
  readonly recursive?: boolean
  readonly filter?: (object: THREE.Object3D) => boolean
}

export interface ResolvePickOptions {
  readonly projectId: string
  readonly resourceRef: ResourceRef
  /** The transform whose coordinates are persisted as asset-local. */
  readonly assetRoot: THREE.Object3D
  readonly coordinateFrame?: CoordinateFrame
}

export interface ResolveFreePointOptions extends ResolvePickOptions {
  /** Point on the interaction plane used when the pointer ray misses geometry. */
  readonly planePoint: THREE.Vector3
  /** Usually the camera direction, producing a screen-aligned interaction plane. */
  readonly planeNormal: THREE.Vector3
  readonly fallbackDistance?: number
}

export function buildPointerRay(
  pointer: PointerCoordinates,
  camera: THREE.Camera,
  viewport: PointerViewport,
  target = new THREE.Raycaster(),
): THREE.Raycaster {
  if (!(viewport.width > 0) || !(viewport.height > 0)) {
    throw new Error('Pointer viewport must have positive dimensions')
  }
  const ndc = new THREE.Vector2(
    ((pointer.clientX - viewport.left) / viewport.width) * 2 - 1,
    -((pointer.clientY - viewport.top) / viewport.height) * 2 + 1,
  )
  target.layers.enable(SURFACE_PICK_LAYER)
  target.layers.disable(VIEWER_OVERLAY_LAYER)
  target.setFromCamera(ndc, camera)
  return target
}

export function pickScene(
  raycaster: THREE.Raycaster,
  roots: readonly THREE.Object3D[],
  options: PickSceneOptions = {},
): PickCandidate | null {
  const candidates = raycaster.intersectObjects([...roots], options.recursive ?? true)
  return candidates.find((candidate) =>
    isSurfacePickable(candidate.object, raycaster) && (options.filter?.(candidate.object) ?? true),
  ) ?? null
}

export function resolvePickCandidate(
  candidate: PickCandidate | null,
  options: ResolvePickOptions,
): PickResult | null {
  if (!candidate || !(candidate.object instanceof THREE.Mesh)) return null
  const mesh = candidate.object
  const worldPosition = candidate.point.clone()
  options.assetRoot.updateWorldMatrix(true, false)
  const localPosition = options.assetRoot.worldToLocal(worldPosition.clone())
  const metadata = findEntityMetadata(mesh, candidate.batchId)
  const normal = resolveWorldNormal(candidate, mesh)

  return {
    localPosition: tuple(localPosition),
    worldPosition: tuple(worldPosition),
    projectId: options.projectId,
    resourceRef: options.resourceRef,
    coordinateFrame: options.coordinateFrame ?? {
      kind: 'asset-local',
      resourceRef: options.resourceRef,
    },
    entityId: metadata.entityId,
    entityType: 'face',
    triangleIndex: candidate.faceIndex ?? undefined,
    normal: normal ? tuple(normal) : undefined,
    snap: { type: 'surface', distance: candidate.distance, confidence: 1 },
  }
}

/** Resolve a stable free-space point for tools when no surface/snap target is available. */
export function resolveFreePoint(
  raycaster: THREE.Raycaster,
  options: ResolveFreePointOptions,
): PickResult {
  const normal = options.planeNormal.clone().normalize()
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, options.planePoint)
  const worldPosition = raycaster.ray.intersectPlane(plane, new THREE.Vector3())
    ?? raycaster.ray.at(options.fallbackDistance ?? raycaster.ray.origin.distanceTo(options.planePoint), new THREE.Vector3())
  options.assetRoot.updateWorldMatrix(true, false)
  const localPosition = options.assetRoot.worldToLocal(worldPosition.clone())
  return {
    localPosition: tuple(localPosition),
    worldPosition: tuple(worldPosition),
    projectId: options.projectId,
    resourceRef: options.resourceRef,
    coordinateFrame: options.coordinateFrame ?? {
      kind: 'asset-local',
      resourceRef: options.resourceRef,
    },
    entityType: 'point',
    snap: { type: 'none', confidence: 0 },
  }
}

function findEntityMetadata(object: THREE.Object3D, batchId?: number): { entityId: string } {
  if (batchId !== undefined) {
    const entityId = object.userData.uvfBatchEntityByInstance?.[batchId]
    if (entityId !== undefined && entityId !== null && String(entityId)) {
      return { entityId: String(entityId) }
    }
  }
  let current: THREE.Object3D | null = object
  while (current) {
    const entityId = current.userData.entityId ?? current.userData.groupId
    if (entityId !== undefined && entityId !== null && String(entityId)) {
      return { entityId: String(entityId) }
    }
    current = current.parent
  }
  return { entityId: object.name || object.uuid }
}

function resolveWorldNormal(
  candidate: PickCandidate,
  mesh: THREE.Mesh,
): THREE.Vector3 | null {
  const geometry = mesh.geometry
  const objectMatrix = mesh.matrixWorld.clone()
  const batchMatrix = (candidate as PickCandidate & { uvfBatchMatrix?: THREE.Matrix4 }).uvfBatchMatrix
  if (batchMatrix) objectMatrix.multiply(batchMatrix)
  const normalAttribute = geometry.getAttribute('normal')
  let localNormal: THREE.Vector3 | null = null

  if (normalAttribute && candidate.face) {
    const barycentric = THREE.Triangle.getBarycoord(
      candidate.point.clone().applyMatrix4(objectMatrix.clone().invert()),
      vertex(geometry, candidate.face.a),
      vertex(geometry, candidate.face.b),
      vertex(geometry, candidate.face.c),
      new THREE.Vector3(),
    )
    if (barycentric) {
      const a = attributeVector(normalAttribute, candidate.face.a)
      const b = attributeVector(normalAttribute, candidate.face.b)
      const c = attributeVector(normalAttribute, candidate.face.c)
      localNormal = a.multiplyScalar(barycentric.x)
        .add(b.multiplyScalar(barycentric.y))
        .add(c.multiplyScalar(barycentric.z))
        .normalize()
    }
  }
  if (!localNormal && candidate.face) localNormal = candidate.face.normal.clone()
  if (!localNormal && candidate.normal) localNormal = candidate.normal.clone()
  if (!localNormal) return null

  return localNormal.applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(objectMatrix)).normalize()
}

function vertex(geometry: THREE.BufferGeometry, index: number): THREE.Vector3 {
  return attributeVector(geometry.getAttribute('position'), index)
}

function attributeVector(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number): THREE.Vector3 {
  return new THREE.Vector3(attribute.getX(index), attribute.getY(index), attribute.getZ(index))
}

function tuple(vector: THREE.Vector3): Vector3Tuple {
  return [vector.x, vector.y, vector.z]
}
