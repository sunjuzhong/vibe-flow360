import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { PickResult } from '../../types'
import {
  applySnapCandidate,
  createSnapCycleState,
  cycleSnapCandidate,
  DefaultSnapResolver,
  projectWorldToScreen,
  selectedSnapCandidate,
  setSnapBypassed,
  snapPolicyFromPickPolicy,
  snapStatusModel,
} from './index'

const viewport = { left: 10, top: 20, width: 800, height: 600 } as const

function camera(z = 5): THREE.PerspectiveCamera {
  const value = new THREE.PerspectiveCamera(50, viewport.width / viewport.height, 0.1, 100)
  value.position.set(0, 0, z)
  value.lookAt(0, 0, 0)
  value.updateProjectionMatrix()
  value.updateMatrixWorld()
  return value
}

function mesh(indexed: boolean): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -1, -1, 0,
    1, -1, 0,
    0, 1, 0,
  ], 3))
  if (indexed) geometry.setIndex([0, 1, 2])
  const value = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  value.userData.entityId = 'face-1'
  value.updateMatrixWorld()
  return value
}

function hit(object: THREE.Mesh): THREE.Intersection<THREE.Object3D> {
  return {
    distance: 5,
    point: new THREE.Vector3(0, 0, 0),
    object,
    faceIndex: 0,
    face: { a: 0, b: 1, c: 2, normal: new THREE.Vector3(0, 0, 1), materialIndex: 0 },
  }
}

describe('DefaultSnapResolver', () => {
  it.each([
    { indexed: true, expected: 1 },
    { indexed: false, expected: 1 },
  ])('resolves the correct hit-triangle vertex index for indexed=$indexed', ({ indexed, expected }) => {
    const object = mesh(indexed)
    const view = camera()
    const vertex = new THREE.Vector3(1, -1, 0)
    const pointer = projectWorldToScreen(vertex, view, viewport)
    expect(pointer).not.toBeNull()
    const result = new DefaultSnapResolver().resolve({
      intersection: hit(object),
      camera: view,
      screenPosition: pointer!,
      viewport,
      context: {},
      toolPolicy: { allowed: ['mesh-vertex', 'surface'] },
    })
    expect(result.selected?.kind).toBe('mesh-vertex')
    expect(result.selected?.vertexIndex).toBe(expected)
    expect(result.selected?.worldPosition.toArray()).toEqual([1, -1, 0])
  })

  it('keeps tolerance in CSS pixels as camera distance changes', () => {
    const object = mesh(true)
    for (const z of [3, 30]) {
      const view = camera(z)
      const projected = projectWorldToScreen(new THREE.Vector3(-1, -1, 0), view, viewport)!
      const result = new DefaultSnapResolver().resolve({
        intersection: hit(object),
        camera: view,
        screenPosition: { x: projected.x + 9, y: projected.y },
        viewport,
        context: {},
        tolerancePx: 10,
        toolPolicy: { allowed: ['mesh-vertex'] },
      })
      expect(result.selected?.kind).toBe('mesh-vertex')
      expect(result.selected?.screenDistancePx).toBeCloseTo(9)
    }
  })

  it('prefers stable CAD topology, classifies its feature, and skips mesh fallback', () => {
    const object = mesh(true)
    const view = camera()
    const origin = projectWorldToScreen(new THREE.Vector3(), view, viewport)!
    const result = new DefaultSnapResolver().resolve({
      intersection: hit(object),
      camera: view,
      screenPosition: origin,
      viewport,
      context: {
        cadTopology: {
          candidatesForIntersection: () => ({
            vertices: [{ id: 'body-7:vertex-42', worldPosition: new THREE.Vector3(0, 0, 0) }],
            edges: [{
              id: 'body-7:edge-9',
              worldPoints: [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0)],
            }],
            features: [{
              id: 'body-7:feature-3',
              worldPosition: new THREE.Vector3(0, 0, 0),
              classification: 'concave',
              confidence: 0.93,
            }],
          }),
        },
      },
    })

    expect(result.selected).toMatchObject({ kind: 'cad-vertex', stableId: 'body-7:vertex-42' })
    expect(result.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'cad-edge', stableId: 'body-7:edge-9' }),
      expect.objectContaining({
        kind: 'concave', stableId: 'body-7:feature-3', method: 'cad-topology', confidence: 0.93,
      }),
    ]))
    expect(result.metrics.featureFallback).toBe('not-needed')
    expect(result.metrics.inspectedTriangles).toBe(0)
  })

  it('filters hidden CAD entities and overlay hierarchy candidates', () => {
    const object = mesh(true)
    const hidden = new THREE.Line()
    hidden.visible = false
    const overlayRoot = new THREE.Group()
    overlayRoot.userData.viewerOverlay = true
    const overlay = new THREE.Line()
    overlayRoot.add(overlay)
    const view = camera()
    const pointer = projectWorldToScreen(new THREE.Vector3(), view, viewport)!
    const result = new DefaultSnapResolver().resolve({
      intersection: hit(object), camera: view, screenPosition: pointer, viewport,
      context: {
        cadTopology: {
          candidatesForIntersection: () => ({ vertices: [
            { id: 'hidden', worldPosition: new THREE.Vector3(), object: hidden },
            { id: 'overlay', worldPosition: new THREE.Vector3(), object: overlay },
            { id: 'filtered', worldPosition: new THREE.Vector3() },
          ] }),
        },
        isTopologyEntityVisible: (id) => id !== 'filtered',
      },
      toolPolicy: { allowed: ['cad-vertex'] },
    })
    expect(result.candidates).toEqual([])

    object.visible = false
    const hiddenSurface = new DefaultSnapResolver().resolve({
      intersection: hit(object), camera: view, screenPosition: pointer, viewport, context: {},
    })
    expect(hiddenSurface.candidates).toEqual([])
  })

  it('honors tool policy and exposes candidate indicator state', () => {
    const object = mesh(true)
    const view = camera()
    const pointer = projectWorldToScreen(new THREE.Vector3(-1, -1, 0), view, viewport)!
    const result = new DefaultSnapResolver().resolve({
      intersection: hit(object), camera: view, screenPosition: pointer, viewport, context: {},
      toolPolicy: { allowed: ['surface'] },
    })
    expect(result.candidates).toHaveLength(1)
    expect(result.status).toMatchObject({ mode: 'surface', label: 'SURFACE', candidateCount: 1 })
    expect(result.status.indicator?.position).toEqual([0, 0, 0])
    expect(snapPolicyFromPickPolicy({ targets: ['surface'], snapTypes: ['cad-edge', 'feature'] })).toEqual({
      allowed: ['cad-edge', 'convex', 'concave', 'sharp'],
    })
  })

  it('cycles overlapping candidates with Tab and bypasses snap with Alt', () => {
    const object = mesh(true)
    const view = camera()
    const pointer = projectWorldToScreen(new THREE.Vector3(-1, -1, 0), view, viewport)!
    const resolution = new DefaultSnapResolver().resolve({
      intersection: hit(object), camera: view, screenPosition: pointer, viewport, context: {},
      toolPolicy: { allowed: ['mesh-vertex', 'surface'] },
    })
    const initial = createSnapCycleState(resolution.candidates)
    expect(selectedSnapCandidate(initial)?.kind).toBe('mesh-vertex')
    const cycled = cycleSnapCandidate(initial)
    expect(selectedSnapCandidate(cycled)?.kind).toBe('surface')
    const bypassed = setSnapBypassed(initial, true)
    expect(selectedSnapCandidate(bypassed)?.kind).toBe('surface')
    expect(snapStatusModel(bypassed)).toMatchObject({ mode: 'bypassed', label: 'SURFACE · ALT BYPASS' })

    const directBypass = new DefaultSnapResolver().resolve({
      intersection: hit(object), camera: view, screenPosition: pointer, viewport, context: {}, altKey: true,
    })
    expect(directBypass.selected?.kind).toBe('surface')
    expect(directBypass.status.mode).toBe('bypassed')
  })

  it('maps a candidate back to an enriched PickResult', () => {
    const resourceRef = { id: 'g-1', type: 'Geometry' }
    const base: PickResult = {
      localPosition: [0, 0, 0], worldPosition: [0, 0, 0], projectId: 'p-1', resourceRef,
      coordinateFrame: { kind: 'asset-local', resourceRef }, entityType: 'face', snap: { type: 'surface' },
    }
    const candidate = {
      kind: 'cad-vertex' as const,
      worldPosition: new THREE.Vector3(5, 4, 3),
      screenDistancePx: 2,
      method: 'cad-topology' as const,
      confidence: 1,
      source: 'cad' as const,
      stableId: 'v-9',
    }
    const snapped = applySnapCandidate(base, candidate, (world) => [world.x - 1, world.y - 1, world.z - 1])
    expect(snapped).toMatchObject({
      localPosition: [4, 3, 2], worldPosition: [5, 4, 3], entityId: 'v-9', entityType: 'vertex',
      snap: { type: 'cad-vertex', method: 'cad-topology', stableId: 'v-9' },
    })
  })
})
