import * as THREE from 'three'

/** Rendered surfaces stay on Three's default layer for backwards compatibility. */
export const SURFACE_PICK_LAYER = 0
/** Tool and annotation overlays live here and are never considered surface picks. */
export const VIEWER_OVERLAY_LAYER = 31

const excludedUVFTypes = new Set([
  'edge',
  'line',
  'overlay',
  'wireframeoverlay',
  'annotation',
  'annotationoverlay',
])

function hierarchyIsVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    current = current.parent
  }
  return true
}

function hierarchyAllowsPicking(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    const data = current.userData
    const uvfType = String(data.uvfType ?? '').toLowerCase()
    if (
      data.pickable === false ||
      data.viewerOverlay === true ||
      data.annotationOverlay === true ||
      data.uvfWireframeOverlay === true ||
      data.groupId === '__wireframe__' ||
      excludedUVFTypes.has(uvfType)
    ) {
      return false
    }
    current = current.parent
  }
  return true
}

export function putOnSurfacePickLayer(object: THREE.Object3D): void {
  object.layers.enable(SURFACE_PICK_LAYER)
  object.layers.disable(VIEWER_OVERLAY_LAYER)
}

export function putOnViewerOverlayLayer(object: THREE.Object3D): void {
  object.traverse((child) => {
    child.layers.disable(SURFACE_PICK_LAYER)
    child.layers.enable(VIEWER_OVERLAY_LAYER)
    child.userData.viewerOverlay = true
  })
}

/**
 * Shared surface-pick rule. Besides layer filtering, metadata is checked so a
 * mistakenly layered annotation or wireframe cannot steal a click.
 */
export function isSurfacePickable(
  object: THREE.Object3D,
  raycaster?: THREE.Raycaster,
): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || !hierarchyIsVisible(object)) return false
  if (raycaster && !raycaster.layers.test(object.layers)) return false
  if (!object.layers.isEnabled(SURFACE_PICK_LAYER) || object.layers.isEnabled(VIEWER_OVERLAY_LAYER)) {
    return false
  }

  if (!hierarchyAllowsPicking(object)) return false

  const materials = Array.isArray(object.material) ? object.material : [object.material]
  return materials.some((material) => material.visible && !('wireframe' in material && material.wireframe))
}
