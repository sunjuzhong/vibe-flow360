import * as THREE from 'three'
import {
  CENTER,
  MeshBVH,
  acceleratedRaycast,
  computeBatchedBoundsTree,
  computeBoundsTree,
  disposeBatchedBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh'
import type { SerializedBVH } from 'three-mesh-bvh'

type BVHGeometry = THREE.BufferGeometry & {
  boundsTree?: MeshBVH | null
  computeBoundsTree?: typeof computeBoundsTree
  disposeBoundsTree?: typeof disposeBoundsTree
}

type BVHBatchedMesh = THREE.BatchedMesh & {
  boundsTrees?: unknown[]
  computeBoundsTree?: typeof computeBatchedBoundsTree
  disposeBoundsTree?: typeof disposeBatchedBoundsTree
}

let installed = false
const maxCachedTopologyBVHs = 64
const topologyBVHCache = new Map<string, SerializedBVH>()

function cachedTopologyBVH(key: string) {
  const cached = topologyBVHCache.get(key)
  if (!cached) return null
  topologyBVHCache.delete(key)
  topologyBVHCache.set(key, cached)
  return cached
}

function rememberTopologyBVH(key: string, bvh: MeshBVH) {
  topologyBVHCache.delete(key)
  topologyBVHCache.set(key, MeshBVH.serialize(bvh, { cloneBuffers: false }))
  const oldest = topologyBVHCache.keys().next().value
  if (topologyBVHCache.size > maxCachedTopologyBVHs && oldest !== undefined) {
    topologyBVHCache.delete(oldest)
  }
}

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
  readonly reusedMeshes: number
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
  let reusedMeshes = 0

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
        const topologyKey = typeof geometry.userData.uvfTopologyKey === 'string'
          ? geometry.userData.uvfTopologyKey
          : ''
        const cached = topologyKey ? cachedTopologyBVH(topologyKey) : null
        if (cached) {
          geometry.boundsTree = MeshBVH.deserialize(cached, geometry)
          reusedMeshes += 1
        } else {
          const builtBVH = geometry.computeBoundsTree?.({ strategy: CENTER, maxDepth: 40, targetLeafSize: 16 })
          if (topologyKey && builtBVH) {
            rememberTopologyBVH(topologyKey, builtBVH as MeshBVH)
          }
        }
        ownedGeometries.add(geometry)
      }
      seenGeometries.add(geometry)
    }
  })

  return {
    stats: { meshes, triangles, reusedMeshes, elapsedMs: performance.now() - startedAt },
    dispose: () => {
      for (const mesh of ownedBatchedMeshes) mesh.disposeBoundsTree?.()
      for (const geometry of ownedGeometries) geometry.disposeBoundsTree?.()
    },
  }
}
