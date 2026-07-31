import * as THREE from 'three'

type CameraControls = {
  target: THREE.Vector3
  update: () => void
}

export type CameraFit = {
  center: THREE.Vector3
  radius: number
  distance: number
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
  camera.near = Math.max(0.001, distance - sphere.radius * 2)
  camera.far = Math.max(camera.near + 1, distance + sphere.radius * 4)
  camera.lookAt(sphere.center)
  camera.updateProjectionMatrix()
  controls.update()
  return { center: sphere.center.clone(), radius: sphere.radius, distance }
}
