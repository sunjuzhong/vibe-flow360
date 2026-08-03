import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { classifyIndexedMeshVertex } from './mesh'

function geometry(points: readonly number[], index: readonly number[]): THREE.BufferGeometry {
  const value = new THREE.BufferGeometry()
  value.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  value.setIndex([...index])
  return value
}

describe('mesh feature fallback', () => {
  it('classifies a closed positive angle deficit as convex with its source', () => {
    const tetrahedron = geometry([
      1, 1, 1,
      -1, -1, 1,
      -1, 1, -1,
      1, -1, -1,
    ], [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])
    expect(classifyIndexedMeshVertex(tetrahedron, 0)).toMatchObject({
      classification: 'convex', method: 'mesh-angle-deficit',
    })
    expect(classifyIndexedMeshVertex(tetrahedron, 0)?.confidence).toBeGreaterThan(0)
  })

  it('classifies a closed negative angle deficit as concave', () => {
    const concaveFan = geometry([
      0, 0, 0,
      1, 0, 1,
      0, 1, -1,
      -1, 0, 1,
      0, -1, -1,
    ], [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1])
    expect(classifyIndexedMeshVertex(concaveFan, 0)).toMatchObject({
      classification: 'concave', method: 'mesh-angle-deficit',
    })
  })

  it('uses dihedral classification for a sharp boundary instead of claiming CAD confidence', () => {
    const folded = geometry([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ], [0, 1, 2, 0, 2, 3])
    const result = classifyIndexedMeshVertex(folded, 0)
    expect(result).toMatchObject({ classification: 'sharp', method: 'mesh-dihedral' })
    expect(result!.confidence).toBeLessThan(1)
  })
})
