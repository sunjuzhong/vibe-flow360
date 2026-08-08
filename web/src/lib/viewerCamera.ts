import * as THREE from 'three'

type CameraControls = {
  target: THREE.Vector3
  update: () => void
  minDistance?: number
  maxDistance?: number
}

type CFDNavigationControls = CameraControls & {
  enableDamping: boolean
  dampingFactor: number
  screenSpacePanning: boolean
  zoomToCursor: boolean
  rotateSpeed: number
  panSpeed: number
  zoomSpeed: number
  mouseButtons: {
    LEFT?: THREE.MOUSE | null
    MIDDLE?: THREE.MOUSE | null
    RIGHT?: THREE.MOUSE | null
  }
  touches: {
    ONE?: THREE.TOUCH | null
    TWO?: THREE.TOUCH | null
  }
}

export type CameraFit = {
  center: THREE.Vector3
  radius: number
  distance: number
}

const CLIP_MARGIN_RADII = 1.5
const clippingDirection = new THREE.Vector3()
const clippingOffset = new THREE.Vector3()

/** ParaView-style navigation tuned for engineering and CFD models. */
export function configureCFDNavigationControls(controls: CFDNavigationControls): void {
  controls.enableDamping = true
  controls.dampingFactor = 0.055
  controls.screenSpacePanning = true
  controls.zoomToCursor = true
  controls.rotateSpeed = 0.72
  controls.panSpeed = 0.9
  controls.zoomSpeed = 0.85
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN
  controls.mouseButtons.RIGHT = THREE.MOUSE.DOLLY
  controls.touches.ONE = THREE.TOUCH.ROTATE
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
}

export function interpolateCameraPivot(
  startPosition: THREE.Vector3,
  startTarget: THREE.Vector3,
  nextTarget: THREE.Vector3,
  progress: number,
): { position: THREE.Vector3; target: THREE.Vector3 } {
  const amount = THREE.MathUtils.clamp(progress, 0, 1)
  const target = startTarget.clone().lerp(nextTarget, amount)
  return {
    position: startPosition.clone().add(target.clone().sub(startTarget)),
    target,
  }
}

export function updatePerspectiveCameraClipping(
  camera: THREE.PerspectiveCamera,
  boundsCenter: THREE.Vector3,
  radius: number,
): boolean {
  if (!Number.isFinite(radius) || radius <= 0) return false
  const cameraDirection = camera.getWorldDirection(clippingDirection)
  const centerDepth = clippingOffset.subVectors(boundsCenter, camera.position).dot(cameraDirection)
  if (!Number.isFinite(centerDepth)) return false

  const minimumNear = Math.max(radius * 1e-4, 1e-6)
  const nextNear = Math.max(minimumNear, centerDepth - radius * CLIP_MARGIN_RADII)
  const nextFar = Math.max(
    nextNear + radius * 2,
    centerDepth + radius * CLIP_MARGIN_RADII,
  )
  const tolerance = radius * 1e-6
  if (Math.abs(camera.near - nextNear) <= tolerance && Math.abs(camera.far - nextFar) <= tolerance) {
    return false
  }

  camera.near = nextNear
  camera.far = nextFar
  camera.updateProjectionMatrix()
  return true
}

export function configurePerspectiveCameraForBounds(
  camera: THREE.PerspectiveCamera,
  controls: CameraControls,
  radius: number,
  preferredDistance = camera.position.distanceTo(controls.target),
  clippingBounds?: Pick<THREE.Sphere, 'center' | 'radius'>,
): void {
  if (!Number.isFinite(radius) || radius <= 0) return
  controls.minDistance = Math.max(radius * 0.01, 1e-6)
  controls.maxDistance = Math.max(radius * 100, preferredDistance * 10)
  updatePerspectiveCameraClipping(
    camera,
    clippingBounds?.center ?? controls.target,
    clippingBounds?.radius ?? radius,
  )
}

export function resizePerspectiveViewport(
  renderer: Pick<THREE.WebGLRenderer, 'setSize'>,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  return true
}

export function fitPerspectiveCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: CameraControls,
  object: THREE.Object3D,
  padding = 1.15,
): CameraFit | null {
  object.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(object)
  if (bounds.isEmpty()) return null
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  if (!Number.isFinite(sphere.radius) || sphere.radius <= 0) return null

  const verticalFov = THREE.MathUtils.degToRad(camera.fov)
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(camera.aspect, 0.01))
  const limitingFov = Math.max(0.01, Math.min(verticalFov, horizontalFov))
  const distance = sphere.radius * Math.max(padding, 1) / Math.sin(limitingFov / 2)
  const direction = camera.position.clone().sub(controls.target)
  if (direction.lengthSq() < 1e-8) direction.set(1, 0.7, 1)
  direction.normalize()

  controls.target.copy(sphere.center)
  camera.position.copy(sphere.center).addScaledVector(direction, distance)
  camera.lookAt(sphere.center)
  configurePerspectiveCameraForBounds(camera, controls, sphere.radius, distance)
  controls.update()
  return { center: sphere.center.clone(), radius: sphere.radius, distance }
}
