import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { meshFeatureCandidates } from './mesh'

describe('dense mesh bounded degradation benchmark', () => {
  it('does not scan a dense mesh after the configured triangle budget is exceeded', () => {
    const triangleCount = 50_000
    const positions = new Float32Array(triangleCount * 9)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    const intersection: THREE.Intersection<THREE.Object3D> = {
      distance: 1,
      point: new THREE.Vector3(),
      object,
      faceIndex: 0,
    }
    const vertexCandidate = {
      kind: 'mesh-vertex' as const,
      worldPosition: new THREE.Vector3(),
      screenDistancePx: 0,
      method: 'mesh-triangle-vertex' as const,
      confidence: 0.75,
      source: 'mesh' as const,
      vertexIndex: 0,
    }

    const startedAt = performance.now()
    const result = meshFeatureCandidates(intersection, [vertexCandidate], {
      maxFeatureScanTriangles: 2_000,
    })
    const elapsedMs = performance.now() - startedAt

    expect(result).toMatchObject({ status: 'degraded-limit', inspectedTriangles: 0, candidates: [] })
    // A deliberately generous regression guard: the bounded path is constant-time in triangle count.
    expect(elapsedMs).toBeLessThan(100)
  })
})
