import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  configureCFDNavigationControls,
  fitPerspectiveCameraToObject,
  interpolateCameraPivot,
  rotateCameraRigAroundPivot,
  resizePerspectiveViewport,
  updatePerspectiveCameraClipping,
  visibleObjectBounds,
  zoomCameraRigToAnchor,
} from './viewerCamera'

function createFixture(aspect: number) {
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 1000)
  camera.position.set(3, 2, 4)
  const controls = {
    target: new THREE.Vector3(),
    update: () => undefined,
    minDistance: 0,
    maxDistance: Infinity,
  }
  const object = new THREE.Mesh(
    new THREE.BoxGeometry(2, 1, 1),
    new THREE.MeshBasicMaterial(),
  )
  object.position.set(4, -2, 1)
  return { camera, controls, object }
}

describe('responsive viewer camera framing', () => {
  it('configures accessible CFD mouse and touch navigation', () => {
    const controls = {
      target: new THREE.Vector3(),
      update: () => undefined,
      enableDamping: false,
      enablePan: false,
      enableZoom: false,
      dampingFactor: 0,
      screenSpacePanning: false,
      zoomToCursor: false,
      rotateSpeed: 1,
      panSpeed: 1,
      zoomSpeed: 1,
      mouseButtons: { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE },
      touches: { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE },
    }

    configureCFDNavigationControls(controls)

    expect(controls.enableDamping).toBe(true)
    expect(controls.enablePan).toBe(true)
    expect(controls.enableZoom).toBe(true)
    expect(controls.zoomToCursor).toBe(false)
    expect(controls.mouseButtons).toEqual({
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    })
    expect(controls.touches).toEqual({ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN })
    expect(controls.rotateSpeed).toBeLessThan(1)
  })

  it('rotates around a picked surface pivot without moving it on screen', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    camera.position.set(0, 1, 8)
    const target = new THREE.Vector3(0, 0, 0)
    camera.lookAt(target)
    camera.updateMatrixWorld()
    const pivot = new THREE.Vector3(1.25, 0.4, 0.2)
    const before = pivot.clone().project(camera)

    expect(rotateCameraRigAroundPivot(camera, target, pivot, -0.35, 0.2)).toBe(true)
    const after = pivot.clone().project(camera)

    expect(after.x).toBeCloseTo(before.x, 8)
    expect(after.y).toBeCloseTo(before.y, 8)
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(
      new THREE.Vector3(0, 1, 8).distanceTo(pivot),
      8,
    )
  })

  it('zooms around the pointer anchor without changing its screen position or heading', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    camera.position.set(0, 1, 8)
    const target = new THREE.Vector3(0, 0, 0)
    camera.lookAt(target)
    camera.updateMatrixWorld()
    const anchor = new THREE.Vector3(1.25, 0.4, 0.2)
    const before = anchor.clone().project(camera)
    const heading = target.clone().sub(camera.position).normalize()

    expect(zoomCameraRigToAnchor(camera, target, anchor, 0.7, 0.1, 100)).toBe(true)
    const after = anchor.clone().project(camera)

    expect(after.x).toBeCloseTo(before.x, 8)
    expect(after.y).toBeCloseTo(before.y, 8)
    expect(target.clone().sub(camera.position).normalize().distanceTo(heading)).toBeLessThan(1e-10)
    expect(camera.position.distanceTo(target)).toBeCloseTo(new THREE.Vector3(0, 1, 8).length() * 0.7)
  })

  it('recenters a pivot without changing camera direction or distance', () => {
    const startPosition = new THREE.Vector3(4, 3, 8)
    const startTarget = new THREE.Vector3(1, 1, 1)
    const nextTarget = new THREE.Vector3(-2, 5, 3)
    const halfway = interpolateCameraPivot(startPosition, startTarget, nextTarget, 0.5)
    const finished = interpolateCameraPivot(startPosition, startTarget, nextTarget, 1)

    expect(halfway.target.toArray()).toEqual([-0.5, 3, 2])
    expect(finished.target.toArray()).toEqual(nextTarget.toArray())
    expect(finished.position.clone().sub(finished.target).toArray()).toEqual(
      startPosition.clone().sub(startTarget).toArray(),
    )
  })

  it('keeps the object centered and increases distance for a portrait viewport', () => {
    const desktop = createFixture(16 / 9)
    const desktopFit = fitPerspectiveCameraToObject(
      desktop.camera,
      desktop.controls,
      desktop.object,
    )!
    const portrait = createFixture(390 / 844)
    const portraitFit = fitPerspectiveCameraToObject(
      portrait.camera,
      portrait.controls,
      portrait.object,
    )!

    expect(desktop.controls.target.toArray()).toEqual([4, -2, 1])
    expect(portrait.controls.target.toArray()).toEqual([4, -2, 1])
    expect(portraitFit.distance).toBeGreaterThan(desktopFit.distance)
    expect(portrait.camera.near).toBeGreaterThan(0)
    expect(portrait.camera.far).toBeGreaterThan(portrait.camera.near)
    expect(portrait.controls.minDistance).toBeGreaterThan(0)
    expect(portrait.controls.maxDistance).toBeGreaterThan(portraitFit.distance)
  })

  it('preserves the current viewing direction across refits', () => {
    const fixture = createFixture(1)
    const before = fixture.camera.position.clone().sub(fixture.controls.target).normalize()
    fitPerspectiveCameraToObject(fixture.camera, fixture.controls, fixture.object)
    const after = fixture.camera.position.clone().sub(fixture.controls.target).normalize()

    expect(after.distanceTo(before)).toBeLessThan(1e-8)
  })

  it('fits only geometry that is visible through the full scene hierarchy', () => {
    const root = new THREE.Group()
    const visible = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial())
    visible.position.set(2, 0, 0)
    const hidden = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial())
    hidden.position.set(500, 0, 0)
    hidden.visible = false
    const hiddenParent = new THREE.Group()
    hiddenParent.visible = false
    const visibleChildOfHiddenParent = new THREE.Mesh(
      new THREE.BoxGeometry(200, 200, 200),
      new THREE.MeshBasicMaterial(),
    )
    hiddenParent.add(visibleChildOfHiddenParent)
    root.add(visible, hidden, hiddenParent)

    const bounds = visibleObjectBounds(root)
    expect(bounds.getCenter(new THREE.Vector3()).toArray()).toEqual([2, 0, 0])
    expect(bounds.getSize(new THREE.Vector3()).toArray()).toEqual([2, 2, 2])

    const fixture = createFixture(1)
    const fit = fitPerspectiveCameraToObject(fixture.camera, fixture.controls, root)
    expect(fit?.center.toArray()).toEqual([2, 0, 0])
    expect(fit?.radius).toBeCloseTo(Math.sqrt(3))
  })

  it('updates renderer dimensions and camera aspect while rejecting transient zero sizes', () => {
    const sizes: Array<[number, number, boolean | undefined]> = []
    const renderer = {
      setSize: (width: number, height: number, updateStyle?: boolean) => {
        sizes.push([width, height, updateStyle])
      },
    }
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    const before = camera.projectionMatrix.clone()

    expect(resizePerspectiveViewport(renderer as THREE.WebGLRenderer, camera, 390, 844)).toBe(true)
    expect(sizes).toEqual([[390, 844, false]])
    expect(camera.aspect).toBeCloseTo(390 / 844)
    expect(camera.projectionMatrix.equals(before)).toBe(false)
    expect(resizePerspectiveViewport(renderer as THREE.WebGLRenderer, camera, 0, 844)).toBe(false)
    expect(sizes).toHaveLength(1)
  })

  it('keeps the whole asset inside the clipping range at close and far zoom distances', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    const target = new THREE.Vector3()
    const radius = 2

    camera.position.set(0, 0, radius * 0.02)
    expect(updatePerspectiveCameraClipping(camera, target, radius)).toBe(true)
    expect(camera.near).toBeGreaterThan(0)
    expect(camera.near).toBeLessThan(radius)
    expect(camera.far).toBeGreaterThan(camera.position.distanceTo(target) + radius)

    camera.position.set(0, 0, radius * 90)
    expect(updatePerspectiveCameraClipping(camera, target, radius)).toBe(true)
    expect(camera.near).toBeLessThan(camera.position.distanceTo(target) - radius)
    expect(camera.far).toBeGreaterThan(camera.position.distanceTo(target) + radius)
  })

  it('protects the asset bounds when orbiting around an off-center surface pivot', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    const bounds = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2)
    const pivot = new THREE.Vector3(1.8, 0, 0)

    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      camera.position.set(
        pivot.x + Math.sin(angle) * 6,
        pivot.y,
        Math.cos(angle) * 6,
      )
      camera.lookAt(pivot)
      updatePerspectiveCameraClipping(camera, bounds.center, bounds.radius)

      const forward = camera.getWorldDirection(new THREE.Vector3())
      const centerDepth = bounds.center.clone().sub(camera.position).dot(forward)
      expect(camera.near).toBeLessThanOrEqual(Math.max(bounds.radius * 1e-4, centerDepth - bounds.radius))
      expect(camera.far).toBeGreaterThanOrEqual(centerDepth + bounds.radius)
    }
  })

  it('keeps a usable frustum while the camera is inside the asset bounds', () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000)
    const center = new THREE.Vector3()
    const radius = 10
    camera.position.set(0, 0, 0.2)
    camera.lookAt(0, 0, 0)

    updatePerspectiveCameraClipping(camera, center, radius)

    expect(camera.near).toBeGreaterThan(0)
    expect(camera.near).toBeLessThan(radius * 0.001)
    expect(camera.far).toBeGreaterThan(radius)
  })
})
