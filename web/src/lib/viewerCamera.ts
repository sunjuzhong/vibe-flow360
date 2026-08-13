import * as THREE from 'three'

type CameraControls = {
  target: THREE.Vector3
  update: () => void
  minDistance?: number
  maxDistance?: number
}

type CFDNavigationControls = CameraControls & {
  enableDamping: boolean
  enablePan: boolean
  enableZoom: boolean
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

/** Bounds rendered geometry across one or more roots while respecting visibility on every ancestor. */
export function visibleObjectBounds(
  input: THREE.Object3D | readonly (THREE.Object3D | null | undefined)[],
): THREE.Box3 {
  const bounds = new THREE.Box3()
  const roots: readonly (THREE.Object3D | null | undefined)[] = Array.isArray(input) ? input : [input]
  for (const root of roots) {
    if (!root) continue
    root.updateWorldMatrix(true, true)
    root.traverseVisible((child) => {
      const geometry = (child as THREE.Mesh | THREE.Line | THREE.Points).geometry
      if (!(geometry instanceof THREE.BufferGeometry)) return
      if (!geometry.boundingBox) geometry.computeBoundingBox()
      if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
        bounds.union(geometry.boundingBox.clone().applyMatrix4(child.matrixWorld))
      }
    })
  }
  return bounds
}

const CLIP_MARGIN_RADII = 1.5
const clippingDirection = new THREE.Vector3()
const clippingOffset = new THREE.Vector3()

/** CFD/CAD navigation. Mouse rotation and wheel zoom are anchored by Viewer3D. */
export function configureCFDNavigationControls(controls: CFDNavigationControls): void {
  controls.enableDamping = true
  controls.enablePan = true
  controls.enableZoom = true
  controls.dampingFactor = 0.055
  controls.screenSpacePanning = true
  // OrbitControls rewrites `target` to a point in free space when zoomToCursor is
  // enabled. Viewer3D owns cursor-anchored wheel zoom so the orbit pivot remains
  // a deliberate model/navigation point.
  controls.zoomToCursor = false
  controls.rotateSpeed = 0.72
  controls.panSpeed = 0.9
  controls.zoomSpeed = 0.85
  controls.mouseButtons.LEFT = null
  controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN
  controls.touches.ONE = THREE.TOUCH.ROTATE
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN
}

const MIN_POLAR_ANGLE = 1e-3

/**
 * Rotate the complete camera rig around an arbitrary world-space surface point.
 * Rotating both camera and look target keeps the picked point visually stable,
 * unlike assigning OrbitControls.target directly at pointer-down.
 */
export function rotateCameraRigAroundPivot(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  pivot: THREE.Vector3,
  horizontalAngle: number,
  verticalAngle: number,
): boolean {
  if (![horizontalAngle, verticalAngle, ...pivot.toArray()].every(Number.isFinite)) return false
  if (horizontalAngle === 0 && verticalAngle === 0) return false

  const up = camera.up.clone().normalize()
  if (up.lengthSq() === 0) return false
  const targetToCamera = camera.position.clone().sub(target)
  if (targetToCamera.lengthSq() === 0) return false
  const polar = Math.acos(THREE.MathUtils.clamp(targetToCamera.normalize().dot(up), -1, 1))
  const pitch = THREE.MathUtils.clamp(
    verticalAngle,
    MIN_POLAR_ANGLE - polar,
    Math.PI - MIN_POLAR_ANGLE - polar,
  )

  const yawRotation = new THREE.Quaternion().setFromAxisAngle(up, horizontalAngle)
  const right = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(camera.quaternion)
    .applyQuaternion(yawRotation)
    .normalize()
  const pitchRotation = new THREE.Quaternion().setFromAxisAngle(right, pitch)
  const rotation = pitchRotation.multiply(yawRotation)

  camera.position.sub(pivot).applyQuaternion(rotation).add(pivot)
  target.sub(pivot).applyQuaternion(rotation).add(pivot)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  return true
}

/**
 * Zoom a camera rig around a point on the pointer ray. Scaling both camera and
 * target around the same anchor preserves the cursor position and view heading.
 */
export function zoomCameraRigToAnchor(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  anchor: THREE.Vector3,
  requestedScale: number,
  minDistance = 0,
  maxDistance = Infinity,
): boolean {
  if (!Number.isFinite(requestedScale) || requestedScale <= 0) return false
  const distance = camera.position.distanceTo(target)
  if (!Number.isFinite(distance) || distance <= 0) return false
  const nextDistance = THREE.MathUtils.clamp(distance * requestedScale, minDistance, maxDistance)
  const scale = nextDistance / distance
  if (!Number.isFinite(scale) || Math.abs(scale - 1) < 1e-8) return false

  camera.position.sub(anchor).multiplyScalar(scale).add(anchor)
  target.sub(anchor).multiplyScalar(scale).add(anchor)
  camera.lookAt(target)
  camera.updateMatrixWorld()
  return true
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
  const bounds = visibleObjectBounds(object)
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
