import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { pickScene, preparePickingBVH } from './index'

function gridMesh(triangles: number): THREE.Mesh {
  const positions = new Float32Array(triangles * 9)
  for (let index = 0; index < triangles; index += 1) {
    const x = (index % 500) * 2
    const y = Math.floor(index / 500) * 2
    positions.set([x, y, 0, x + 1, y, 0, x, y + 1, 0], index * 9)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  mesh.userData.entityId = 'large-surface'
  return mesh
}

describe('picking BVH', () => {
  it('indexes and accurately picks a 100k-triangle surface', () => {
    const mesh = gridMesh(100_000)
    const { stats, dispose } = preparePickingBVH(mesh)
    mesh.updateMatrixWorld(true)

    expect(stats.meshes).toBe(1)
    expect(stats.triangles).toBe(100_000)
    expect((mesh.geometry as THREE.BufferGeometry & { boundsTree?: unknown }).boundsTree).toBeDefined()
    const hit = pickScene(
      new THREE.Raycaster(new THREE.Vector3(0.25, 0.25, 5), new THREE.Vector3(0, 0, -1)),
      [mesh],
    )
    expect(hit?.object).toBe(mesh)
    expect(hit?.faceIndex).toBe(0)

    dispose()
    expect((mesh.geometry as THREE.BufferGeometry & { boundsTree?: unknown }).boundsTree).toBeNull()
    mesh.geometry.dispose()
    ;(mesh.material as THREE.Material).dispose()
  })

  it('indexes BatchedMesh without changing instance resolution', () => {
    const source = gridMesh(2).geometry
    const batch = new THREE.BatchedMesh(1, 6, 6, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const geometryId = batch.addGeometry(source)
    const instanceId = batch.addInstance(geometryId)
    batch.setMatrixAt(instanceId, new THREE.Matrix4())
    batch.userData.uvfBatchEntityByInstance = ['batched-surface']
    const { dispose } = preparePickingBVH(batch)
    batch.updateMatrixWorld(true)
    const hit = pickScene(
      new THREE.Raycaster(new THREE.Vector3(0.25, 0.25, 5), new THREE.Vector3(0, 0, -1)),
      [batch],
    )
    expect(hit?.batchId).toBe(instanceId)
    dispose()
    batch.dispose()
  })
})
