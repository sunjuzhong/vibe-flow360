import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export type MeshGroupData = {
  id: string
  name: string
  color: string
  visible: boolean
  triangles?: number
  vertices?: number
}

export type BoundingBoxData = {
  min: [number, number, number]
  max: [number, number, number]
}

export type ViewerManifest = {
  asset_url: string
  format: string
  bounding_box: BoundingBoxData
  groups: MeshGroupData[]
  vertices: number
  elements: number
  download_url?: string
  warnings?: string[]
}

export type ViewerSelection = {
  groupId: string | null
}

export type ViewerState =
  | { status: 'idle' }
  | { status: 'loading'; progress: number }
  | { status: 'ready' }
  | { status: 'error'; message: string }

type Props = {
  manifest: ViewerManifest | null
  state: ViewerState
  onSelectionChange?: (selection: ViewerSelection) => void
  selection?: ViewerSelection
}

export function Viewer3D({ manifest, state, onSelectionChange, selection }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const assetRef = useRef<THREE.Object3D | null>(null)
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)

  const createScene = useCallback((container: HTMLDivElement) => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf4f4f0)

    const width = container.clientWidth || 400
    const height = container.clientHeight || 300
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 10000)
    camera.position.set(3, 2.5, 4)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const dir = new THREE.DirectionalLight(0xffffff, 0.8)
    dir.position.set(5, 10, 7)
    scene.add(dir)

    const grid = new THREE.GridHelper(10, 20, 0xc4c7bb, 0xd9dbd2)
    scene.add(grid)

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    controlsRef.current = controls

    return { scene, camera, renderer }
  }, [])

  const updateGeometry = useCallback(async (manifest: ViewerManifest) => {
    const scene = sceneRef.current
    if (!scene) return

    for (const [, mesh] of meshesRef.current) {
      scene.remove(mesh)
      mesh.geometry.dispose()
    }
    meshesRef.current.clear()
    if (assetRef.current) {
      scene.remove(assetRef.current)
      assetRef.current = null
    }

    if (!manifest.asset_url) return
    const gltf = await new GLTFLoader().loadAsync(manifest.asset_url)
    const root = gltf.scene
    const fallbackGroup = manifest.groups[0]
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const group = manifest.groups.find((candidate) =>
        object.name.toLowerCase().includes(candidate.name.toLowerCase()),
      ) ?? fallbackGroup
      const groupId = group?.id ?? object.uuid
      object.userData.groupId = groupId
      if (group) {
        object.material = new THREE.MeshPhongMaterial({
          color: new THREE.Color(group.color),
          transparent: true,
          opacity: group.visible ? 0.9 : 0.12,
          side: THREE.DoubleSide,
        })
      }
      meshesRef.current.set(`${groupId}-${object.uuid}`, object)
    })
    const bounds = new THREE.Box3().setFromObject(root)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const maxDim = Math.max(size.x, size.y, size.z, 0.001)
    const scale = 2 / maxDim
    root.scale.setScalar(scale)
    root.position.copy(center.multiplyScalar(-scale))
    scene.add(root)
    assetRef.current = root

    const camera = cameraRef.current
    if (camera) {
      const dist = 3.5
      const height = 2.2
      camera.position.set(dist, height, dist)
      camera.lookAt(0, 0, 0)
      controlsRef.current?.target.set(0, 0, 0)
      controlsRef.current?.update()
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { renderer, scene } = createScene(container)

    let rafId: number
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      renderer.render(scene, cameraRef.current!)
      controlsRef.current?.update()
    }
    animate()

    const handleResize = () => {
      if (!container) return
      const w = container.clientWidth
      const h = container.clientHeight
      renderer.setSize(w, h)
      if (cameraRef.current) {
        cameraRef.current.aspect = w / h
        cameraRef.current.updateProjectionMatrix()
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
      controlsRef.current?.dispose()
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    }
  }, [createScene])

  useEffect(() => {
    if (manifest && state.status === 'ready') {
      void updateGeometry(manifest)
    }
  }, [manifest, state.status, updateGeometry])

  useEffect(() => {
    if (!selection || !meshesRef.current.size) return
    for (const [, mesh] of meshesRef.current) {
      const groupId = String(mesh.userData.groupId ?? '')
      const mat = mesh.material as THREE.MeshPhongMaterial
      if (groupId === selection.groupId) {
        mat.opacity = 1.0
        mat.emissive = new THREE.Color(0xffff00)
        mat.emissiveIntensity = 0.2
      } else if (groupId !== '__wireframe__') {
        const group = manifest?.groups.find((g) => g.id === groupId)
        mat.opacity = group?.visible ? 0.85 : 0.15
        mat.emissive = new THREE.Color(0x000000)
        mat.emissiveIntensity = 0
      }
    }
  }, [selection, manifest])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container || !manifest) return
    const rect = container.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    const camera = cameraRef.current
    const scene = sceneRef.current
    if (!camera || !scene) return

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const meshes = Array.from(meshesRef.current.values())
    const intersects = raycaster.intersectObjects(meshes)
    if (intersects.length > 0) {
      const groupId = intersects[0].object.userData.groupId
      if (groupId !== '__wireframe__') {
        onSelectionChange?.({ groupId })
        setHoveredGroup(groupId)
      }
    } else {
      onSelectionChange?.({ groupId: null })
      setHoveredGroup(null)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container || !manifest) return
    const rect = container.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    )
    const camera = cameraRef.current
    const scene = sceneRef.current
    if (!camera || !scene) return

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)
    const meshes = Array.from(meshesRef.current.values())
    const intersects = raycaster.intersectObjects(meshes)
    if (intersects.length > 0) {
      const groupId = intersects[0].object.userData.groupId
      if (groupId !== '__wireframe__') {
        setHoveredGroup(groupId)
      }
    }
  }

  if (state.status === 'loading') {
    return (
      <div className="viewer-3d viewer-loading">
        <div className="viewer-spinner" />
        <p>Loading 3D preview... {Math.round(state.progress * 100)}%</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="viewer-3d viewer-error">
        <span className="viewer-error-icon">⚠️</span>
        <p>{state.message}</p>
      </div>
    )
  }

  return (
    <div className="viewer-3d-container">
      <div
        ref={containerRef}
        className="viewer-3d"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredGroup(null)}
        role="img"
        aria-label="3D geometry viewer"
        tabIndex={0}
      />
      {manifest && (
        <div className="viewer-legend">
          <div className="viewer-legend-header">
            <span>Groups / Zones / Regions</span>
            <span className="viewer-hover-label">
              {hoveredGroup ? `Hover: ${manifest.groups.find((g) => g.id === hoveredGroup)?.name ?? hoveredGroup}` : ''}
            </span>
          </div>
          {manifest.groups.map((g) => (
            <div
              key={g.id}
              className={`viewer-legend-item ${selection?.groupId === g.id ? 'selected' : ''} ${!g.visible ? 'hidden' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onSelectionChange?.({ groupId: g.id })
              }}
            >
              <span className="viewer-color-swatch" style={{ background: g.color }} />
              <span className="viewer-group-name">{g.name}</span>
              {g.vertices !== undefined && <span className="viewer-group-stats">{g.vertices} verts</span>}
              {g.triangles !== undefined && <span className="viewer-group-stats">{g.triangles} tris</span>}
            </div>
          ))}
        </div>
      )}
      {manifest?.warnings && manifest.warnings.length > 0 && (
        <div className="viewer-warnings">
          {manifest.warnings.map((w, i) => <span key={i}>{w}</span>)}
        </div>
      )}
    </div>
  )
}
