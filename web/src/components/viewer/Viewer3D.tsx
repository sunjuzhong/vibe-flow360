import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Flow360UVFLoader, applyFieldColoring, setWireframeOverlay, type ColormapName, listColormaps, sampleColormap } from '../../lib/uvf-three'
import type { UVFAsset, UVFFieldInfo } from '../../lib/uvf-three'

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
  wireframe?: boolean
  onWireframeChange?: (wireframe: boolean) => void
  onFieldsDiscovered?: (fields: UVFFieldInfo[]) => void
  toolbar?: React.ReactNode
}

export function Viewer3D({ manifest, state, onSelectionChange, selection, wireframe, onWireframeChange, onFieldsDiscovered, toolbar }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const assetRef = useRef<THREE.Object3D | null>(null)
  const assetDisposeRef = useRef<(() => void) | null>(null)
  const uvfAssetRef = useRef<UVFAsset | null>(null)
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)
  const [assetState, setAssetState] = useState<ViewerState>({ status: 'idle' })
  const [assetStats, setAssetStats] = useState<{ faces: number; edges: number } | null>(null)
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [colormap, setColormap] = useState<ColormapName>('viridis')
  const [availableFields, setAvailableFields] = useState<UVFFieldInfo[]>([])
  const [colormaps] = useState<ColormapName[]>(listColormaps())

  const [wireframeOn, setWireframeOn] = useState(false)

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

  const updateGeometry = useCallback(async (
    manifest: ViewerManifest,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ) => {
    const scene = sceneRef.current
    if (!scene) return

    assetDisposeRef.current?.()
    assetDisposeRef.current = null
    uvfAssetRef.current = null
    meshesRef.current.clear()
    if (assetRef.current) {
      scene.remove(assetRef.current)
      assetRef.current = null
    }
    setAssetStats(null)
    setAvailableFields([])
    setSelectedField(null)

    if (!manifest.asset_url) return
    let root: THREE.Object3D
    if (manifest.format === 'flow360-uvf') {
      const asset = await new Flow360UVFLoader().load(manifest.asset_url, {
        signal,
        onProgress: ({ progress }) => onProgress(progress),
      })
      if (signal.aborted) {
        asset.dispose()
        return
      }
      root = asset.object
      assetDisposeRef.current = asset.dispose
      uvfAssetRef.current = asset
      setAssetStats({ faces: asset.faces, edges: asset.edges })
      setAvailableFields(asset.fields)
      onFieldsDiscovered?.(asset.fields)
      setSelectedField(null)
    } else {
      const gltf = await new GLTFLoader().loadAsync(manifest.asset_url)
      if (signal.aborted) {
        disposeObject(gltf.scene)
        return
      }
      root = gltf.scene
      assetDisposeRef.current = () => disposeObject(root)
      uvfAssetRef.current = null
      setAvailableFields([])
      setSelectedField(null)
    }
    const fallbackGroup = manifest.groups[0]
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const embeddedGroupID = String(object.userData.groupId ?? '')
      const group = manifest.groups.find((candidate) => candidate.id === embeddedGroupID)
        ?? manifest.groups.find((candidate) =>
          object.name.toLowerCase().includes(candidate.name.toLowerCase()),
        )
        ?? fallbackGroup
      const groupId = group?.id ?? object.uuid
      object.userData.groupId = groupId
      if (group) {
        const previous = Array.isArray(object.material) ? object.material : [object.material]
        previous.forEach((material) => material.dispose())
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
      assetDisposeRef.current?.()
      assetDisposeRef.current = null
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    }
  }, [createScene])

  useEffect(() => {
    if (manifest && state.status === 'ready') {
      const controller = new AbortController()
      setAssetState({ status: 'loading', progress: 0 })
      void updateGeometry(
        manifest,
        controller.signal,
        (progress) => setAssetState({ status: 'loading', progress }),
      )
        .then(() => {
          if (!controller.signal.aborted) setAssetState({ status: 'ready' })
        })
        .catch((cause) => {
          if (controller.signal.aborted) return
          setAssetState({
            status: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          })
        })
      return () => controller.abort()
    }
    setAssetState(state)
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

  useEffect(() => {
    if (uvfAssetRef.current) {
      applyFieldColoring(uvfAssetRef.current, selectedField, colormap)
    }
  }, [selectedField, colormap])

  useEffect(() => {
    if (uvfAssetRef.current) {
      setWireframeOverlay(uvfAssetRef.current, wireframe ?? wireframeOn)
    }
  }, [wireframe, wireframeOn])

  const handleWireframeToggle = () => {
    const next = !wireframeOn
    setWireframeOn(next)
    onWireframeChange?.(next)
  }

  const visibleState = state.status === 'ready' ? assetState : state

  return (
    <div
      className="viewer-3d-container"
      data-viewer-format={manifest?.format ?? ''}
      data-viewer-faces={assetStats?.faces ?? ''}
      data-viewer-edges={assetStats?.edges ?? ''}
    >
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
      {visibleState.status === 'loading' && (
        <div className="viewer-overlay viewer-loading">
          <div className="viewer-spinner" />
          <p>Loading 3D preview... {Math.round(visibleState.progress * 100)}%</p>
        </div>
      )}
      {visibleState.status === 'error' && (
        <div className="viewer-overlay viewer-error">
          <span className="viewer-error-icon">⚠️</span>
          <p>{visibleState.message}</p>
        </div>
      )}
      {assetStats && visibleState.status === 'ready' && (
        <div className="viewer-asset-stats">
          <span>{assetStats.faces} faces</span>
          <span>{assetStats.edges} edges</span>
          <button
            className={`viewer-wireframe-toggle ${wireframeOn ? 'active' : ''}`}
            onClick={handleWireframeToggle}
            aria-label="Toggle wireframe overlay"
            aria-pressed={wireframeOn}
            title="Toggle wireframe"
          >
            Wire
          </button>
        </div>
      )}
      {toolbar && visibleState.status === 'ready' && (
        <div className="viewer-toolbar-slot">{toolbar}</div>
      )}
      {availableFields.length > 0 && visibleState.status === 'ready' && (
        <div className="viewer-field-panel">
          <label className="viewer-field-label">
            Field:
            <select
              value={selectedField ?? ''}
              onChange={(e) => setSelectedField(e.target.value || null)}
            >
              <option value="">None</option>
              {availableFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name} ({f.kind}, {f.min.toFixed(2)}–{f.max.toFixed(2)})
                </option>
              ))}
            </select>
          </label>
          {selectedField && (
            <label className="viewer-field-label">
              Colormap:
              <select
                value={colormap}
                onChange={(e) => setColormap(e.target.value as ColormapName)}
              >
                {colormaps.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          )}
          {selectedField && (
            <div className="viewer-colormap-bar">
              <span className="viewer-colormap-min">
                {availableFields.find((f) => f.name === selectedField)?.min.toFixed(2)}
              </span>
              <div
                className="viewer-colormap-gradient"
                style={{ background: buildGradientCSS(colormap) }}
              />
              <span className="viewer-colormap-max">
                {availableFields.find((f) => f.name === selectedField)?.max.toFixed(2)}
              </span>
            </div>
          )}
        </div>
      )}
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

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material.dispose())
  })
}

function buildGradientCSS(name: ColormapName): string {
  const stops = [0, 0.25, 0.5, 0.75, 1]
  const colors = stops.map((t) => {
    const c = sampleColormap(t, name)
    return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
  })
  return `linear-gradient(to right, ${stops.map((s, i) => `${colors[i]} ${s * 100}%`).join(', ')})`
}
