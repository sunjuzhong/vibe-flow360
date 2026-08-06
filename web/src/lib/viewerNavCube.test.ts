import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { chooseNavCubeUp, NAV_CUBE_TARGETS } from './viewerNavCube'

describe('interactive Viewer NavCube model', () => {
  it('exposes every face, edge, and corner as a pick target', () => {
    expect(NAV_CUBE_TARGETS.filter((target) => target.kind === 'face')).toHaveLength(6)
    expect(NAV_CUBE_TARGETS.filter((target) => target.kind === 'edge')).toHaveLength(12)
    expect(NAV_CUBE_TARGETS.filter((target) => target.kind === 'corner')).toHaveLength(8)
    expect(new Set(NAV_CUBE_TARGETS.map((target) => target.name)).size).toBe(26)
  })

  it('prefers the candidate that keeps global Z maximally upright', () => {
    const target = NAV_CUBE_TARGETS.find((candidate) => candidate.name === 'pxCubeFace')
    expect(target).toBeDefined()
    const up = chooseNavCubeUp(
      new THREE.Vector3(1, 1, 1),
      new THREE.Vector3(0, 0, 1),
      target!,
    )

    expect(up.toArray()).toEqual([0, 0, 1])
  })
})
