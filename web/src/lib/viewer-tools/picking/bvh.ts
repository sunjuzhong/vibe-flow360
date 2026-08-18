import * as THREE from 'three'
import {
  CENTER,
  acceleratedRaycast,
  computeBatchedBoundsTree,
  computeBoundsTree,
  disposeBatchedBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'

type BVHGeometry = THREE.BufferGeometry & {
  boundsTree?: unknown
  computeBoundsTree?: typeof computeBoundsTree
  disposeBoundsTree?: typeof disposeBoundsTree
}

type BVHBatchedMesh = THREE.BatchedMesh & {
  boundsTrees?: unknown[]
  computeBoundsTree?: typeof computeBatchedBoundsTree
  disposeBoundsTree?: typeof disposeBatchedBoundsTree
}

let installed = false

function installBVHRaycasting() {
  if (installed) return
  installed = true
  THREE.Mesh.prototype.raycast = acceleratedRaycast
  THREE.BatchedMesh.prototype.raycast = acceleratedRaycast
  THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
  THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
  THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree
  THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree
}

export interface BVHBuildStats {
  readonly meshes: number
  readonly triangles: number
  readonly elapsedMs: number
}

/** Build spatial indexes once after loading an asset. Returns a disposer for cache ownership. */
export function preparePickingBVH(root: THREE.Object3D): { stats: BVHBuildStats; dispose: () => void } {
  installBVHRaycasting()
  const startedAt = performance.now()
  const seenGeometries = new Set<BVHGeometry>()
  const ownedGeometries = new Set<BVHGeometry>()
  const ownedBatchedMeshes: BVHBatchedMesh[] = []
  let meshes = 0
  let triangles = 0

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.viewerOverlay === true) return
    meshes += 1
    const geometry = object.geometry as BVHGeometry
    const indexCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0
    triangles += Math.floor(indexCount / 3)
    if (object instanceof THREE.BatchedMesh) {
      const batched = object as BVHBatchedMesh
      if (!batched.boundsTrees) {
        batched.computeBoundsTree?.(undefined, { strategy: CENTER, maxDepth: 40, targetLeafSize: 16 })
        ownedBatchedMeshes.push(batched)
      }
    } else if (!seenGeometries.has(geometry)) {
      if (!geometry.boundsTree) {
        geometry.computeBoundsTree?.({ strategy: CENTER, maxDepth: 40, targetLeafSize: 16 })
        ownedGeometries.add(geometry)
      }
      seenGeometries.add(geometry)
    }
  })

  return {
    stats: { meshes, triangles, elapsedMs: performance.now() - startedAt },
    dispose: () => {
      for (const mesh of ownedBatchedMeshes) mesh.disposeBoundsTree?.()
      for (const geometry of ownedGeometries) geometry.disposeBoundsTree?.()
    },
  }
}
