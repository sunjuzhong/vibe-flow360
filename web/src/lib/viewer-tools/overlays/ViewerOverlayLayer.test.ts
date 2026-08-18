import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { CoordinateFrame, OverlayPrimitive, ResourceRef } from '../types'
import { calculateLabelCanvasMetrics } from './label'
import { transformOverlayPosition, ViewerOverlayLayer } from './ViewerOverlayLayer'
import type { OverlayAnnotation } from './types'

const resource: ResourceRef = { id: 'asset-a', type: 'Geometry', version: 'v1' }
const world: CoordinateFrame = { kind: 'world' }
const local: CoordinateFrame = { kind: 'asset-local', resourceRef: resource }

function annotation(
  annotationId: string,
  primitives: readonly OverlayPrimitive[],
  coordinateFrame: CoordinateFrame = world,
  visible = true,
): OverlayAnnotation {
  return { annotationId, primitives, coordinateFrame, visible }
}

describe('ViewerOverlayLayer', () => {
  it('renders all primitive kinds from data, including two and N point polylines', () => {
    const scene = new THREE.Scene()
    const layer = new ViewerOverlayLayer(scene, { labelPixelRatio: 2 })
    layer.update({
      resourceRef: resource,
      saved: [
        annotation('all', [
          { kind: 'point', key: 'point', position: [1, 2, 3], size: 11, opacity: 0.4 },
          { kind: 'polyline', key: 'line-2', points: [[0, 0, 0], [1, 0, 0]] },
          {
            kind: 'polyline',
            key: 'line-n',
            points: [[0, 0, 0], [1, 0, 0], [1, 1, 0]],
            width: 4,
          },
          { kind: 'sphere', key: 'sphere', center: [3, 2, 1], radius: 2, opacity: 0.4 },
          { kind: 'box', key: 'box', center: [1, 1, 1], size: [2, 4, 6], rotationAxis: [0, 0, 1], rotationAngleRadians: Math.PI / 2 },
          { kind: 'cylinder', key: 'cylinder', center: [2, 1, 0], axis: [1, 0, 0], height: 6, radius: 2 },
          { kind: 'label', key: 'label', position: [2, 3, 4], text: '12.3 mm' },
        ]),
      ],
    })

    expect(scene.children).toContain(layer.group)
    expect(layer.size).toBe(7)
    expect(layer.getObject('all', 'point')).toBeInstanceOf(THREE.Points)
    expect(layer.getObject('all', 'line-2')).toBeInstanceOf(THREE.Line)
    expect(layer.getObject('all', 'line-n')?.userData).toMatchObject({
      requestedLineWidth: 4,
      effectiveLineWidth: 1,
    })
    const point = layer.getObject('all', 'point') as THREE.Points
    expect((point.material as THREE.PointsMaterial).sizeAttenuation).toBe(false)
    expect((point.material as THREE.PointsMaterial).size).toBe(11)
    expect((point.material as THREE.PointsMaterial).depthTest).toBe(false)
    expect((point.material as THREE.PointsMaterial).depthWrite).toBe(false)
    expect((point.material as THREE.PointsMaterial).opacity).toBe(0.4)
    expect((point.material as THREE.PointsMaterial).transparent).toBe(true)
    const line = layer.getObject('all', 'line-2') as THREE.Line
    expect((line.material as THREE.LineBasicMaterial).depthTest).toBe(true)
    expect((line.material as THREE.LineBasicMaterial).depthWrite).toBe(false)
    const sphere = layer.getObject('all', 'sphere') as THREE.Mesh
    expect(sphere.position.toArray()).toEqual([3, 2, 1])
    expect(sphere.scale.toArray()).toEqual([2, 2, 2])
    expect((sphere.material as THREE.MeshBasicMaterial).opacity).toBe(0.4)
    expect((sphere.material as THREE.MeshBasicMaterial).depthTest).toBe(true)
    expect((sphere.material as THREE.MeshBasicMaterial).depthWrite).toBe(false)
    const box = layer.getObject('all', 'box') as THREE.Mesh
    expect(box.position.toArray()).toEqual([1, 1, 1])
    expect(box.scale.toArray()).toEqual([2, 4, 6])
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(box.quaternion).toArray()[1]).toBeCloseTo(1)
    const cylinder = layer.getObject('all', 'cylinder') as THREE.Mesh
    expect(cylinder.position.toArray()).toEqual([2, 1, 0])
    expect(cylinder.scale.toArray()).toEqual([2, 6, 2])
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(cylinder.quaternion).toArray()[0]).toBeCloseTo(1)
    const label = layer.getObject('all', 'label') as THREE.Sprite
    expect(label.position.toArray()).toEqual([2, 3, 4])
    expect((label.material as THREE.SpriteMaterial).sizeAttenuation).toBe(false)
    expect((label.material as THREE.SpriteMaterial).depthTest).toBe(false)
    expect((label.material as THREE.SpriteMaterial).depthWrite).toBe(false)
    for (const primitiveKey of ['point', 'line-2', 'line-n', 'sphere', 'box', 'cylinder', 'label']) {
      expect(layer.getObject('all', primitiveKey)?.frustumCulled).toBe(false)
    }
  })

  it('preserves spatial depth testing when a polyline switches material type', () => {
    const layer = new ViewerOverlayLayer(new THREE.Scene())
    layer.update({
      resourceRef: resource,
      draft: [annotation('line', [{
        kind: 'polyline', key: 'path', points: [[0, 0, 0], [1, 0, 0]], dashed: false,
      }])],
    })
    layer.update({
      resourceRef: resource,
      draft: [annotation('line', [{
        kind: 'polyline', key: 'path', points: [[0, 0, 0], [1, 1, 0]], dashed: true,
      }])],
    })

    const line = layer.getObject('line', 'path') as THREE.Line
    expect(line.material).toBeInstanceOf(THREE.LineDashedMaterial)
    expect((line.material as THREE.LineDashedMaterial).depthTest).toBe(true)
    expect((line.material as THREE.LineDashedMaterial).depthWrite).toBe(false)
  })

  it('renders saved, draft and hover sources together with independent state', () => {
    const layer = new ViewerOverlayLayer(new THREE.Scene())
    layer.update({
      resourceRef: resource,
      saved: [annotation('saved', [{ kind: 'point', key: 'p', position: [0, 0, 0] }])],
      draft: [
        annotation('draft', [{ kind: 'point', key: 'p', position: [1, 0, 0] }]),
      ],
      hover: [
        annotation('hover', [{ kind: 'point', key: 'p', position: [2, 0, 0] }]),
      ],
    })

    expect(layer.size).toBe(3)
    expect(layer.getObject('saved', 'p')?.userData.state).toBe('saved')
    expect(layer.getObject('draft', 'p')?.userData.state).toBe('draft')
    expect(layer.getObject('hover', 'p')?.userData.state).toBe('hover')
  })

  it('transforms asset-local positions to world and rejects another asset frame', () => {
    const matrix = new THREE.Matrix4().makeTranslation(10, 20, 30)
    expect(transformOverlayPosition([1, 2, 3], local, resource, matrix)?.toArray()).toEqual([
      11, 22, 33,
    ])
    expect(transformOverlayPosition([1, 2, 3], world, resource, matrix)?.toArray()).toEqual([
      1, 2, 3,
    ])
    expect(
      transformOverlayPosition(
        [1, 2, 3],
        { kind: 'asset-local', resourceRef: { id: 'asset-b', type: 'Geometry' } },
        resource,
        matrix,
      ),
    ).toBeNull()

    const layer = new ViewerOverlayLayer(new THREE.Scene())
    layer.update({
      resourceRef: resource,
      assetWorldMatrix: matrix,
      saved: [annotation('local', [{ kind: 'sphere', key: 's', center: [1, 2, 3], radius: 1 }], local)],
    })
    expect(layer.getObject('local', 's')?.position.toArray()).toEqual([11, 22, 33])
  })

  it('conservatively scales an asset-local sphere with the asset transform', () => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(10, 0, 0),
      new THREE.Quaternion(),
      new THREE.Vector3(2, 3, 2),
    )
    const layer = new ViewerOverlayLayer(new THREE.Scene())
    layer.update({
      resourceRef: resource,
      assetWorldMatrix: matrix,
      saved: [
        annotation('local', [{ kind: 'sphere', key: 's', center: [1, 0, 0], radius: 2 }], local),
      ],
    })
    const sphere = layer.getObject('local', 's') as THREE.Mesh
    expect(sphere.position.toArray()).toEqual([12, 0, 0])
    expect(sphere.scale.toArray()).toEqual([6, 6, 6])
  })

  it('reuses keyed objects across updates and visibility changes', () => {
    const layer = new ViewerOverlayLayer(new THREE.Scene())
    layer.update({
      resourceRef: resource,
      draft: [annotation('draft', [{ kind: 'point', key: 'p', position: [1, 2, 3] }])],
    })
    const before = layer.getObject('draft', 'p') as THREE.Points
    const geometry = before.geometry

    layer.update({
      resourceRef: resource,
      draft: [annotation('draft', [{ kind: 'point', key: 'p', position: [4, 5, 6] }], world, false)],
    })
    const after = layer.getObject('draft', 'p') as THREE.Points
    expect(after).toBe(before)
    expect(after.geometry).toBe(geometry)
    expect(after.visible).toBe(false)
    expect(Array.from(after.geometry.attributes.position.array)).toEqual([4, 5, 6])
  })

  it('ignores empty primitives and disposes removed or stale-resource objects', () => {
    const scene = new THREE.Scene()
    const layer = new ViewerOverlayLayer(scene)
    layer.update({
      resourceRef: resource,
      saved: [
        annotation('empty', [
          { kind: 'polyline', key: 'line', points: [] },
          { kind: 'label', key: 'label', position: [0, 0, 0], text: '' },
          { kind: 'sphere', key: 'sphere', center: [0, 0, 0], radius: 0 },
        ]),
        annotation('kept', [{ kind: 'point', key: 'point', position: [0, 0, 0] }]),
      ],
    })
    expect(layer.size).toBe(1)
    const object = layer.getObject('kept', 'point') as THREE.Points
    const geometryDispose = vi.fn()
    const materialDispose = vi.fn()
    object.geometry.addEventListener('dispose', geometryDispose)
    ;(object.material as THREE.Material).addEventListener('dispose', materialDispose)

    layer.update({ resourceRef: { id: 'asset-b', type: 'Geometry' } })
    expect(layer.size).toBe(0)
    expect(layer.group.children).toHaveLength(0)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()

    layer.dispose()
    expect(scene.children).not.toContain(layer.group)
  })

  it('keeps GPU-backed overlay objects bounded across repeated resource switches', () => {
    const layer = new ViewerOverlayLayer(new THREE.Scene())
    let geometryDisposals = 0
    let materialDisposals = 0

    for (let index = 0; index < 100; index += 1) {
      const currentResource = { id: `asset-${index}`, type: 'Geometry' }
      layer.update({
        resourceRef: currentResource,
        saved: [annotation(`annotation-${index}`, [
          { kind: 'point', key: 'point', position: [index, 0, 0] },
        ], { kind: 'asset-local', resourceRef: currentResource })],
      })

      expect(layer.size).toBe(1)
      const object = layer.getObject(`annotation-${index}`, 'point') as THREE.Points
      object.geometry.addEventListener('dispose', () => { geometryDisposals += 1 })
      ;(object.material as THREE.Material).addEventListener('dispose', () => { materialDisposals += 1 })
    }

    expect(geometryDisposals).toBe(99)
    expect(materialDisposals).toBe(99)
    layer.dispose()
    expect(geometryDisposals).toBe(100)
    expect(materialDisposals).toBe(100)
  })

  it('never participates in raycaster picking, even when its layer is enabled', () => {
    const layer = new ViewerOverlayLayer(new THREE.Scene(), { layer: 29 })
    layer.update({
      resourceRef: resource,
      saved: [annotation('a', [{ kind: 'sphere', key: 's', center: [0, 0, 0], radius: 2 }])],
    })
    layer.group.updateMatrixWorld(true)
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1))
    raycaster.layers.enable(29)
    expect(raycaster.intersectObject(layer.group, true)).toEqual([])
    expect(layer.getObject('a', 's')?.userData.pickable).toBe(false)
    expect(layer.getObject('a', 's')?.layers.isEnabled(29)).toBe(true)
  })

  it('calculates high-DPI backing canvas independently of CSS label size', () => {
    const oneX = calculateLabelCanvasMetrics(80, 16, 1)
    const twoX = calculateLabelCanvasMetrics(80, 16, 2)
    expect(twoX.cssWidth).toBe(oneX.cssWidth)
    expect(twoX.cssHeight).toBe(oneX.cssHeight)
    expect(twoX.canvasWidth).toBe(oneX.canvasWidth * 2)
    expect(twoX.canvasHeight).toBe(oneX.canvasHeight * 2)
  })
})
