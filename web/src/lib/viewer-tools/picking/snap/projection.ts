import * as THREE from 'three'
import type { PointerViewport } from '../engine'
import type { ScreenPosition } from './types'

export function projectWorldToScreen(
  worldPosition: THREE.Vector3,
  camera: THREE.Camera,
  viewport: PointerViewport,
): ScreenPosition | null {
  const ndc = worldPosition.clone().project(camera)
  if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || !Number.isFinite(ndc.z)) return null
  if (ndc.z < -1 || ndc.z > 1) return null
  return {
    x: viewport.left + ((ndc.x + 1) / 2) * viewport.width,
    y: viewport.top + ((1 - ndc.y) / 2) * viewport.height,
  }
}

export function screenDistance(a: ScreenPosition, b: ScreenPosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function closestPointOnScreenPolyline(
  worldPoints: readonly THREE.Vector3[],
  camera: THREE.Camera,
  viewport: PointerViewport,
  pointer: ScreenPosition,
): { readonly worldPosition: THREE.Vector3; readonly screenDistancePx: number } | null {
  let closest: { worldPosition: THREE.Vector3; screenDistancePx: number } | null = null
  for (let index = 0; index < worldPoints.length - 1; index += 1) {
    const start = projectWorldToScreen(worldPoints[index], camera, viewport)
    const end = projectWorldToScreen(worldPoints[index + 1], camera, viewport)
    if (!start || !end) continue
    const dx = end.x - start.x
    const dy = end.y - start.y
    const lengthSquared = dx * dx + dy * dy
    const t = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((pointer.x - start.x) * dx + (pointer.y - start.y) * dy) / lengthSquared))
    const projected = { x: start.x + dx * t, y: start.y + dy * t }
    const distance = screenDistance(pointer, projected)
    if (!closest || distance < closest.screenDistancePx) {
      closest = {
        worldPosition: worldPoints[index].clone().lerp(worldPoints[index + 1], t),
        screenDistancePx: distance,
      }
    }
  }
  return closest
}
