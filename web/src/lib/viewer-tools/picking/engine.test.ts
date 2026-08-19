import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  buildPointerRay,
  isSurfacePickable,
  pickScene,
  putOnViewerOverlayLayer,
  resolveFreePoint,
  resolvePickCandidate,
  SURFACE_PICK_LAYER,
  VIEWER_OVERLAY_LAYER,
} from './index'

const resourceRef = { id: 'geometry-1', type: 'Geometry' } as const

function camera(): THREE.PerspectiveCamera {
  const value = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  value.position.set(0, 0, 5)
  value.lookAt(0, 0, 0)
  value.updateMatrixWorld()
  return value
}

function triangle(indexed: boolean): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
  ], 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3))
  if (indexed) geometry.setIndex([0, 1, 2])
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  mesh.userData.uvfType = 'Face'
  mesh.userData.entityId = indexed ? 'indexed-face' : 'plain-face'
  return mesh
}

describe('picking engine', () => {
  it('builds a pointer ray from element-relative coordinates', () => {
    const ray = buildPointerRay(
      { clientX: 60, clientY: 70 },
      camera(),
      { left: 10, top: 20, width: 100, height: 100 },
    )
    expect(ray.ray.origin.toArray()).toEqual([0, 0, 5])
    expect(ray.ray.direction.x).toBeCloseTo(0)
    expect(ray.ray.direction.y).toBeCloseTo(0)
    expect(ray.ray.direction.z).toBeCloseTo(-1)
    expect(ray.layers.isEnabled(SURFACE_PICK_LAYER)).toBe(true)
    expect(ray.layers.isEnabled(VIEWER_OVERLAY_LAYER)).toBe(false)
  })

  it.each([true, false])('picks and resolves %s indexed BufferGeometry', (indexed) => {
    const root = new THREE.Group()
    root.position.set(10, 2, -1)
    const mesh = triangle(indexed)
    mesh.position.set(0, 0, 1)
    root.add(mesh)
    root.updateMatrixWorld(true)

    const ray = new THREE.Raycaster(new THREE.Vector3(10, 2, 5), new THREE.Vector3(0, 0, -1))
    const candidate = pickScene(ray, [root])
    const result = resolvePickCandidate(candidate, {
      projectId: 'project-1',
      resourceRef,
      assetRoot: root,
    })

    expect(result?.entityId).toBe(indexed ? 'indexed-face' : 'plain-face')
    expect(result?.objectId).toBe(mesh.uuid)
    expect(result?.triangleIndex).toBe(0)
    expect(result?.worldPosition).toEqual([10, 2, 0])
    expect(result?.localPosition).toEqual([0, 0, 1])
    expect(result?.normal?.[0]).toBeCloseTo(0)
    expect(result?.normal?.[1]).toBeCloseTo(0)
    expect(result?.normal?.[2]).toBeCloseTo(1)
    expect(result?.resourceRef).toBe(resourceRef)
    expect(result?.coordinateFrame).toEqual({ kind: 'asset-local', resourceRef })
    expect(result?.snap.type).toBe('surface')
  })

  it('supports plain Geometry resource meshes without UVF metadata', () => {
    const mesh = triangle(false)
    delete mesh.userData.uvfType
    delete mesh.userData.entityId
    mesh.name = 'geometry-body'
    mesh.updateMatrixWorld()
    const candidate = pickScene(
      new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)),
      [mesh],
    )
    const result = resolvePickCandidate(candidate, {
      projectId: 'project-1', resourceRef, assetRoot: mesh,
    })
    expect(result?.entityId).toBe('geometry-body')
  })

  it('resolves BatchedMesh intersections back to the source entity', () => {
    const source = triangle(true).geometry
    const batch = new THREE.BatchedMesh(1, 3, 3, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const geometryId = batch.addGeometry(source)
    const instanceId = batch.addInstance(geometryId)
    batch.userData.uvfBatchEntityByInstance = ['batched-body']
    batch.setMatrixAt(instanceId, new THREE.Matrix4())
    batch.updateMatrixWorld(true)
    const candidate = pickScene(
      new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)),
      [batch],
    )
    const result = resolvePickCandidate(candidate, {
      projectId: 'project-1', resourceRef, assetRoot: batch,
    })

    expect(candidate?.batchId).toBe(instanceId)
    expect(result?.entityId).toBe('batched-body')
    batch.dispose()
  })

  it('skips hidden, wireframe, UVF wire, and annotation overlay meshes', () => {
    const valid = triangle(true)
    valid.userData.entityId = 'valid'
    valid.position.z = -3

    const hidden = triangle(true)
    hidden.visible = false
    hidden.position.z = 3

    const wire = triangle(true)
    ;(wire.material as THREE.MeshBasicMaterial).wireframe = true
    wire.position.z = 2

    const uvfWire = triangle(true)
    uvfWire.userData.uvfWireframeOverlay = true
    uvfWire.position.z = 1

    const overlay = triangle(true)
    overlay.position.z = 0
    putOnViewerOverlayLayer(overlay)

    const annotationRoot = new THREE.Group()
    annotationRoot.userData.annotationOverlay = true
    const annotationChild = triangle(true)
    annotationChild.position.z = 0.5
    annotationRoot.add(annotationChild)

    const root = new THREE.Group()
    root.add(hidden, wire, uvfWire, overlay, annotationRoot, valid)
    root.updateMatrixWorld(true)
    const candidate = pickScene(
      new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1)),
      [root],
    )
    expect(candidate?.object.userData.entityId).toBe('valid')
    expect(isSurfacePickable(hidden)).toBe(false)
    expect(isSurfacePickable(wire)).toBe(false)
    expect(isSurfacePickable(uvfWire)).toBe(false)
    expect(isSurfacePickable(overlay)).toBe(false)
    expect(isSurfacePickable(annotationChild)).toBe(false)
  })

  it('returns null on a miss', () => {
    expect(pickScene(
      new THREE.Raycaster(new THREE.Vector3(4, 4, 5), new THREE.Vector3(0, 0, -1)),
      [triangle(true)],
    )).toBeNull()
  })

  it('resolves a free-space point on the camera-aligned interaction plane', () => {
    const root = new THREE.Group()
    root.position.set(1, 0, 0)
    root.updateMatrixWorld(true)
    const raycaster = buildPointerRay(
      { clientX: 50, clientY: 50 },
      camera(),
      { left: 0, top: 0, width: 100, height: 100 },
    )
    const result = resolveFreePoint(raycaster, {
      projectId: 'project-1',
      resourceRef,
      assetRoot: root,
      planePoint: new THREE.Vector3(0, 0, 0),
      planeNormal: new THREE.Vector3(0, 0, -1),
    })
    expect(result.worldPosition).toEqual([0, 0, 0])
    expect(result.localPosition).toEqual([-1, 0, 0])
    expect(result.entityType).toBe('point')
    expect(result.snap).toEqual({ type: 'none', confidence: 0 })
  })
})
