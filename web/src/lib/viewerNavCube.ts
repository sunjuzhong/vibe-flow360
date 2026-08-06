import * as THREE from 'three'

export type NavCubeVector = readonly [number, number, number]

export type NavCubeTarget = {
  name: string
  kind: 'face' | 'edge' | 'corner'
  direction: NavCubeVector
  upCandidates: NavCubeVector[]
  label?: string
  labelColor?: number
}

export type NavCubeOrientation = {
  direction: THREE.Vector3
  up: THREE.Vector3
}

type InteractiveMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>

const CUBE_COLOR = 0xffffff
const HIGHLIGHT_COLOR = 0x3584ff
const X_COLOR = 0xff0000
const Y_COLOR = 0x00b82c
const Z_COLOR = 0x1748e8
const AXES: NavCubeVector[] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
]

const vector = (value: NavCubeVector) => new THREE.Vector3(...value)
const tuple = (value: THREE.Vector3): NavCubeVector => [value.x, value.y, value.z]
const normalizedTuple = (value: NavCubeVector): NavCubeVector => tuple(vector(value).normalize())

function normalName(direction: NavCubeVector) {
  return direction.map((component, index) => {
    if (component === 0) return ''
    return `${component < 0 ? 'n' : 'p'}${['x', 'y', 'z'][index]}`
  }).join('')
}

function upCandidates(direction: NavCubeVector): NavCubeVector[] {
  const eye = vector(direction).normalize()
  const candidates: NavCubeVector[] = []
  for (const axis of AXES) {
    const projected = vector(axis).sub(eye.clone().multiplyScalar(vector(axis).dot(eye)))
    if (projected.lengthSq() < 1e-8) continue
    projected.normalize()
    if (candidates.some((candidate) => vector(candidate).distanceToSquared(projected) < 1e-8)) continue
    candidates.push(tuple(projected))
  }
  return candidates
}

export const NAV_CUBE_TARGETS: NavCubeTarget[] = (() => {
  const faces: Array<[NavCubeVector, string, number]> = [
    [[-1, 0, 0], '-X', 0x111111],
    [[0, -1, 0], '-Y', 0x111111],
    [[0, 0, -1], '-Z', 0x111111],
    [[0, 0, 1], '+Z', Z_COLOR],
    [[0, 1, 0], '+Y', Y_COLOR],
    [[1, 0, 0], '+X', X_COLOR],
  ]
  const result: NavCubeTarget[] = faces.map(([direction, label, labelColor]) => ({
    name: `${normalName(direction)}CubeFace`,
    kind: 'face',
    direction,
    upCandidates: upCandidates(direction),
    label,
    labelColor,
  }))

  for (let zeroAxis = 0; zeroAxis < 3; zeroAxis += 1) {
    const otherAxes = [0, 1, 2].filter((axis) => axis !== zeroAxis)
    for (const firstSign of [-1, 1]) {
      for (const secondSign of [-1, 1]) {
        const direction = [0, 0, 0] as [number, number, number]
        direction[otherAxes[0]] = firstSign
        direction[otherAxes[1]] = secondSign
        const normalized = normalizedTuple(direction)
        result.push({
          name: `${normalName(normalized)}Edge`,
          kind: 'edge',
          direction: normalized,
          upCandidates: upCandidates(normalized),
        })
      }
    }
  }

  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const direction = normalizedTuple([x, y, z])
        result.push({
          name: `${normalName(direction)}Corner`,
          kind: 'corner',
          direction,
          upCandidates: upCandidates(direction),
        })
      }
    }
  }
  return result
})()

export function chooseNavCubeUp(
  currentDirection: THREE.Vector3,
  currentUp: THREE.Vector3,
  target: NavCubeTarget,
) {
  const targetDirection = vector(target.direction).normalize()
  const rotation = new THREE.Quaternion().setFromUnitVectors(currentDirection.clone().normalize(), targetDirection)
  const rotatedUp = currentUp.clone().normalize().applyQuaternion(rotation)
  let selected = vector(target.upCandidates[0]).normalize()
  let selectedZ = selected.z
  let selectedAngle = selected.angleTo(rotatedUp)
  for (const candidateValue of target.upCandidates.slice(1)) {
    const candidate = vector(candidateValue).normalize()
    const angle = candidate.angleTo(rotatedUp)
    if (candidate.z > selectedZ + 1e-8 || (Math.abs(candidate.z - selectedZ) < 1e-8 && angle < selectedAngle)) {
      selected = candidate
      selectedZ = candidate.z
      selectedAngle = angle
    }
  }
  return selected
}

function createLabelTexture(label: string, color: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) return new THREE.CanvasTexture(canvas)
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.font = '700 150px Arial'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`
  context.fillText(label, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function shapeMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: CUBE_COLOR,
    depthTest: true,
    depthWrite: true,
    metalness: 0.15,
    opacity: 0.78,
    reflectivity: 0.1,
    roughness: 0.18,
    specularColor: 0xffffff,
    specularIntensity: 1,
    transparent: true,
  })
}

function cylinderBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, color: number) {
  const direction = end.clone().sub(start)
  const geometry = new THREE.CylinderGeometry(radius, radius, direction.length(), 8)
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  ))
  geometry.translate(...start.clone().add(end).multiplyScalar(0.5).toArray())
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, depthTest: false }))
}

function createAxisLabel(label: string, color: number, position: THREE.Vector3) {
  const material = new THREE.SpriteMaterial({ map: createLabelTexture(label, color), depthTest: false, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.position.copy(position)
  sprite.scale.set(3.2, 3.2, 1)
  return sprite
}

export class ViewerNavCubeController {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-11, 11, 11, -11, 0.1, 100)
  private readonly root = new THREE.Group()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private readonly interactive = new Map<InteractiveMesh, NavCubeTarget>()
  private highlighted: InteractiveMesh | null = null
  private pointerDownTarget: InteractiveMesh | null = null
  private readonly size = 180
  private readonly inset = 8

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly onNavigate: (orientation: NavCubeOrientation) => void,
  ) {
    this.root.name = 'navCube'
    this.scene.name = 'navCubeScene'
    this.scene.add(this.root, new THREE.AmbientLight(0xfafafa, 0.35))
    const light = new THREE.DirectionalLight(0xffffff, Math.PI)
    light.position.set(4, 6, 8)
    this.camera.add(light)
    this.scene.add(this.camera)
    this.createCube()
    this.createAxes()
    this.camera.position.set(14, 14, 14)
    this.camera.up.set(0, 0, 1)
    this.camera.lookAt(0, 0, 0)
  }

  private createCube() {
    const halfLength = 5
    const radius = 1.5
    const faceLength = 7
    const halfFace = faceLength / 2

    for (const target of NAV_CUBE_TARGETS) {
      let mesh: InteractiveMesh
      if (target.kind === 'face') {
        const normal = vector(target.direction)
        const geometry = new THREE.PlaneGeometry(faceLength, faceLength)
        geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal))
        geometry.translate(...normal.clone().multiplyScalar(halfLength).toArray())
        mesh = new THREE.Mesh(geometry, shapeMaterial())
        const label = new THREE.Mesh(
          geometry.clone().translate(...normal.clone().multiplyScalar(0.025).toArray()),
          new THREE.MeshBasicMaterial({
            map: createLabelTexture(target.label ?? '', target.labelColor ?? 0x111111),
            side: THREE.FrontSide,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          }),
        )
        label.name = `${target.name}Label`
        this.root.add(label)
      } else if (target.kind === 'edge') {
        const direction = target.direction
        const zeroAxis = direction.findIndex((component) => Math.abs(component) < 1e-8)
        const edgeDirection = new THREE.Vector3()
        edgeDirection.setComponent(zeroAxis, 1)
        const center = vector(direction).multiplyScalar(halfFace * Math.SQRT2)
        const geometry = new THREE.CylinderGeometry(radius, radius, faceLength, 8)
        geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), edgeDirection))
        geometry.translate(...center.toArray())
        mesh = new THREE.Mesh(geometry, shapeMaterial())
      } else {
        const center = vector(target.direction).multiplyScalar(halfFace * Math.sqrt(3))
        const geometry = new THREE.SphereGeometry(radius, 8, 6)
        geometry.translate(...center.toArray())
        mesh = new THREE.Mesh(geometry, shapeMaterial())
      }
      mesh.name = target.name
      this.root.add(mesh)
      this.interactive.set(mesh, target)
    }
  }

  private createAxes() {
    const origin = new THREE.Vector3(-5, -5, -5)
    const definitions: Array<[string, number, THREE.Vector3]> = [
      ['X', X_COLOR, new THREE.Vector3(7.3, -5, -5)],
      ['Y', Y_COLOR, new THREE.Vector3(-5, 7.3, -5)],
      ['Z', Z_COLOR, new THREE.Vector3(-5, -5, 7.3)],
    ]
    for (const [label, color, end] of definitions) {
      this.root.add(cylinderBetween(origin, end, 0.13, color))
      const direction = end.clone().sub(origin).normalize()
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.65, 1.8, 12),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      )
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction)
      cone.position.copy(end)
      this.root.add(cone)
      this.root.add(createAxisLabel(label, color, end.clone().add(direction.multiplyScalar(2.1))))
    }
  }

  update(parentCamera: THREE.Camera, orbitCenter: THREE.Vector3) {
    const direction = parentCamera.position.clone().sub(orbitCenter).normalize()
    this.camera.position.copy(direction.multiplyScalar(24))
    this.camera.quaternion.copy(parentCamera.quaternion)
  }

  renderOverlay() {
    const rect = this.renderer.domElement.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const viewportX = rect.width - this.size - this.inset
    const viewportY = rect.height - this.size - this.inset
    const previousViewport = this.renderer.getViewport(new THREE.Vector4())
    const previousScissor = this.renderer.getScissor(new THREE.Vector4())
    const previousScissorTest = this.renderer.getScissorTest()
    const previousAutoClear = this.renderer.autoClear

    this.renderer.setScissorTest(true)
    this.renderer.setViewport(viewportX, viewportY, this.size, this.size)
    this.renderer.setScissor(viewportX, viewportY, this.size, this.size)
    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.render(this.scene, this.camera)

    this.renderer.setViewport(previousViewport)
    this.renderer.setScissor(previousScissor)
    this.renderer.setScissorTest(previousScissorTest)
    this.renderer.autoClear = previousAutoClear
  }

  private overlayRect() {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const left = rect.right - this.size - this.inset
    const top = rect.top + this.inset
    return { left, top, right: left + this.size, bottom: top + this.size }
  }

  private intersection(event: PointerEvent) {
    const rect = this.overlayRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      return null
    }
    this.pointer.set(
      ((event.clientX - rect.left) / this.size) * 2 - 1,
      ((event.clientY - rect.top) / this.size) * -2 + 1,
    )
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const hit = this.raycaster.intersectObjects(Array.from(this.interactive.keys()), false)[0]
    return hit?.object instanceof THREE.Mesh ? hit.object as InteractiveMesh : null
  }

  private setHighlight(mesh: InteractiveMesh | null) {
    if (mesh === this.highlighted) return
    if (this.highlighted) this.highlighted.material.color.set(CUBE_COLOR)
    this.highlighted = mesh
    if (this.highlighted) this.highlighted.material.color.set(HIGHLIGHT_COLOR)
    this.renderer.domElement.style.cursor = mesh ? 'pointer' : ''
  }

  handlePointerMove(event: PointerEvent) {
    const mesh = this.intersection(event)
    this.setHighlight(mesh)
    return Boolean(mesh || this.pointerDownTarget)
  }

  handlePointerDown(event: PointerEvent) {
    const mesh = this.intersection(event)
    this.pointerDownTarget = mesh
    this.setHighlight(mesh)
    return Boolean(mesh)
  }

  handlePointerUp(event: PointerEvent, parentCamera: THREE.Camera, orbitCenter: THREE.Vector3) {
    const mesh = this.intersection(event)
    const captured = Boolean(this.pointerDownTarget)
    const shouldNavigate = Boolean(mesh && mesh === this.pointerDownTarget)
    this.pointerDownTarget = null
    this.setHighlight(mesh)
    if (!mesh || !shouldNavigate) return Boolean(mesh || captured)
    const target = this.interactive.get(mesh)
    if (!target) return false
    const currentDirection = parentCamera.position.clone().sub(orbitCenter).normalize()
    this.onNavigate({
      direction: vector(target.direction).normalize(),
      up: chooseNavCubeUp(currentDirection, parentCamera.up, target),
    })
    return true
  }

  handlePointerCancel() {
    this.pointerDownTarget = null
    this.setHighlight(null)
  }

  clearHighlight() {
    this.setHighlight(null)
  }

  dispose() {
    this.renderer.domElement.style.cursor = ''
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
        if (object instanceof THREE.Mesh) object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose()
          material.dispose()
        }
      }
    })
    this.interactive.clear()
  }
}
