import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Eye, EyeOff } from 'lucide-react'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js'
import { UVFLoader, applyFieldColoring, canUseLogFieldScale, createFieldHistogram, findFieldExtrema, formatFieldRange, probeFieldAtIntersection, resolveFieldScale, setEntityVisibility, setWireframeOverlay, type ColormapName, listColormaps, sampleColormap } from '../../lib/uvf-three'
import type { UVFAsset, UVFFieldExtrema, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe, UVFFieldScale } from '../../lib/uvf-three'
import { configurePerspectiveCameraForBounds, fitPerspectiveCameraToObject, updatePerspectiveCameraClipping } from '../../lib/viewerCamera'
import { useViewerViewport } from '../../hooks/useViewerViewport'
import { resolveViewerMaterialStyle } from '../../lib/viewerMaterial'
import {
  VIEWER_OVERLAY_LAYER,
  ViewerInputController,
  ViewerOverlayLayer,
  buildPointerRay,
  pickScene,
  resolvePickCandidate,
  type ResourceRef,
  type ToolInputConsumer,
  type ViewerOverlayFrame,
  type ViewerPointerEvent,
} from '../../lib/viewer-tools'
import { commonPrecisionLevels, ViewerPrecisionControl, type ViewerPrecisionSelection } from './ViewerPrecisionControl'

export type MeshGroupData = {
  id: string
  name: string
  color: string
  visible: boolean
  triangles?: number
  vertices?: number
}

export type MeshEdgeData = {
  id: string
  name: string
  segments?: number
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
  edges?: MeshEdgeData[]
  vertices: number
  elements: number
  download_url?: string
  warnings?: string[]
}

export type ViewerSelection = {
  groupId: string | null
  groupIds?: string[]
}

export type ViewerEntityAppearance = { color: string; opacity: number }

export type ViewerClipPlane = {
  normal: [number, number, number]
  constant: number
}

export type ViewerCameraCommand = {
  type: 'fit' | 'fit-selection' | 'x' | 'y' | 'z' | 'iso'
  nonce: number
}

export type ViewerOverlayContent = Omit<ViewerOverlayFrame, 'resourceRef' | 'assetWorldMatrix'>

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
  entityVisibility?: Record<string, boolean>
  onEntityVisibilityChange?: (visibility: Record<string, boolean>) => void
  wireframe?: boolean
  onWireframeChange?: (wireframe: boolean) => void
  onFieldsDiscovered?: (fields: UVFFieldInfo[]) => void
  selectedField?: string | null
  onSelectedFieldChange?: (field: string | null) => void
  fieldNames?: string[]
  fieldRange?: [number, number] | null
  onFieldHistogramChange?: (histogram: UVFFieldHistogram | null) => void
  onFieldExtremaChange?: (extrema: UVFFieldExtrema | null) => void
  onFieldProbe?: (probe: UVFFieldProbe | null) => void
  focusTarget?: [number, number, number] | null
  clipPlane?: ViewerClipPlane | null
  projectId?: string
  resourceRef?: ResourceRef
  toolInput?: ToolInputConsumer
  overlays?: ViewerOverlayContent | null
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>
  captureRequest?: number
  onCapture?: (dataUrl: string) => void
  showFieldPanel?: boolean
  showEntityLegend?: boolean
  toolbar?: React.ReactNode
  cameraCommand?: ViewerCameraCommand | null
  showNormals?: boolean
  entityAppearances?: Record<string, ViewerEntityAppearance>
}

export function Viewer3D({
  manifest,
  state,
  onSelectionChange,
  selection,
  entityVisibility,
  onEntityVisibilityChange,
  wireframe,
  onWireframeChange,
  onFieldsDiscovered,
  selectedField: controlledSelectedField,
  onSelectedFieldChange,
  fieldNames,
  fieldRange,
  onFieldHistogramChange,
  onFieldExtremaChange,
  onFieldProbe,
  focusTarget,
  clipPlane,
  projectId,
  resourceRef,
  toolInput,
  overlays,
  onDoubleClick,
  captureRequest = 0,
  onCapture,
  showFieldPanel = true,
  showEntityLegend = true,
  toolbar,
  cameraCommand,
  showNormals = false,
  entityAppearances = {},
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const cameraBoundsRadiusRef = useRef<number | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const assetRef = useRef<THREE.Object3D | null>(null)
  const loadedAssetURLRef = useRef<string | null>(null)
  const assetDisposeRef = useRef<(() => void) | null>(null)
  const uvfAssetRef = useRef<UVFAsset | null>(null)
  const annotationOverlayRef = useRef<ViewerOverlayLayer | null>(null)
  const inputControllerRef = useRef<ViewerInputController | null>(null)
  const normalsOverlayRef = useRef<THREE.Group | null>(null)
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)
  const [assetState, setAssetState] = useState<ViewerState>({ status: 'idle' })
  const [assetStats, setAssetStats] = useState<{ faces: number; edges: number; triangles: number } | null>(null)
  const [precision, setPrecision] = useState<{ assetURL: string | null; selection: ViewerPrecisionSelection }>({
    assetURL: null,
    selection: 'default',
  })
  const [precisionInfo, setPrecisionInfo] = useState({ levels: 1, currentLevel: 0 })
  const [internalSelectedField, setInternalSelectedField] = useState<string | null>(null)
  const [colormap, setColormap] = useState<ColormapName>('viridis')
  const [fieldScale, setFieldScale] = useState<UVFFieldScale>('auto')
  const [availableFields, setAvailableFields] = useState<UVFFieldInfo[]>([])
  const [colormaps] = useState<ColormapName[]>(listColormaps())
  const [groupVisibility, setGroupVisibilityState] = useState<Record<string, boolean>>({})

  const [wireframeOn, setWireframeOn] = useState(false)
  const onFieldsDiscoveredRef = useRef(onFieldsDiscovered)
  const onFieldHistogramChangeRef = useRef(onFieldHistogramChange)
  const onFieldExtremaChangeRef = useRef(onFieldExtremaChange)
  const onCaptureRef = useRef(onCapture)
  const selectedField = controlledSelectedField === undefined
    ? internalSelectedField
    : controlledSelectedField
  const displayedFields = fieldNames
    ? availableFields.filter((field) => fieldNames.includes(field.name))
    : availableFields
  const activeField = displayedFields.find((field) => field.name === selectedField)
  const activeFieldRange = activeField ? formatFieldRange(activeField.min, activeField.max) : null
  const resolvedFieldScale = activeField
    ? resolveFieldScale(fieldScale, activeField.min, activeField.max)
    : 'linear'
  const effectiveWireframe = wireframe ?? wireframeOn
  const precisionSelection = precision.assetURL === manifest?.asset_url ? precision.selection : 'default'
  const requestedLODLevel = precisionSelection === 'default' ? undefined : precisionSelection
  const activeResourceRef = useMemo<ResourceRef | null>(() => {
    if (resourceRef) return resourceRef
    if (!manifest?.asset_url) return null
    return { id: manifest.asset_url, type: manifest.format || 'viewer-asset' }
  }, [manifest?.asset_url, manifest?.format, resourceRef])
  const manifestEntityVisibility = useMemo(() => [
    ...(manifest?.groups ?? []).map((group) => [group.id, group.visible] as const),
    ...(manifest?.edges ?? []).map((edge) => [edge.id, true] as const),
  ], [manifest])
  const effectiveGroupVisibility = Object.fromEntries(
    manifestEntityVisibility.map(([entityId, defaultVisible]) => [
      entityId,
      entityVisibility?.[entityId] ?? groupVisibility[entityId] ?? defaultVisible,
    ]),
  )

  useEffect(() => {
    onFieldsDiscoveredRef.current = onFieldsDiscovered
    onFieldHistogramChangeRef.current = onFieldHistogramChange
    onFieldExtremaChangeRef.current = onFieldExtremaChange
    onCaptureRef.current = onCapture
  }, [onCapture, onFieldExtremaChange, onFieldHistogramChange, onFieldsDiscovered])

  const selectField = (field: string | null) => {
    if (controlledSelectedField === undefined) setInternalSelectedField(field)
    onSelectedFieldChange?.(field)
  }

  const fitCameraToObject = useCallback((
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    object: THREE.Object3D,
  ) => {
    const fit = fitPerspectiveCameraToObject(camera, controls, object)
    cameraBoundsRadiusRef.current = fit?.radius ?? null
    return fit
  }, [])

  useEffect(() => {
    setGroupVisibilityState(Object.fromEntries(
      manifestEntityVisibility,
    ))
  }, [manifestEntityVisibility])

  const createScene = useCallback((container: HTMLDivElement) => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf4f4f0)

    const width = container.clientWidth || 400
    const height = container.clientHeight || 300
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 10000)
    camera.layers.enable(VIEWER_OVERLAY_LAYER)
    camera.position.set(3, 2.5, 4)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.localClippingEnabled = true
    renderer.setSize(width, height, false)
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
    lodLevel?: number,
    preserveCamera = false,
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
    setInternalSelectedField(null)

    if (!manifest.asset_url) return
    let root: THREE.Object3D
    if (manifest.format === 'flow360-uvf') {
      const asset = await new UVFLoader().load(manifest.asset_url, {
        signal,
        lodLevel,
        onProgress: ({ progress }) => onProgress(progress),
      })
      if (signal.aborted) {
        asset.dispose()
        return
      }
      root = asset.object
      assetDisposeRef.current = asset.dispose
      uvfAssetRef.current = asset
      setAssetStats({ faces: asset.faces, edges: asset.edges, triangles: asset.triangles })
      const switchableLevels = commonPrecisionLevels(asset.entityLODs)
      setPrecisionInfo({ levels: switchableLevels, currentLevel: asset.currentLOD })
      setAvailableFields(asset.fields)
      onFieldsDiscoveredRef.current?.(asset.fields)
      setInternalSelectedField(null)
    } else {
      const gltf = await new GLTFLoader().loadAsync(manifest.asset_url)
      if (signal.aborted) {
        disposeObject(gltf.scene)
        return
      }
      root = gltf.scene
      assetDisposeRef.current = () => disposeObject(root)
      uvfAssetRef.current = null
      setPrecisionInfo({ levels: 1, currentLevel: 0 })
      setAvailableFields([])
      onFieldsDiscoveredRef.current?.([])
      setInternalSelectedField(null)
    }
    const fallbackGroup = manifest.groups[0]
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const embeddedGroupID = String(object.userData.entityId ?? object.userData.groupId ?? '')
      const group = manifest.groups.find((candidate) => candidate.id === embeddedGroupID)
        ?? manifest.groups.find((candidate) =>
          object.name.toLowerCase().includes(candidate.name.toLowerCase()),
        )
        ?? fallbackGroup
      const groupId = group?.id ?? object.uuid
      object.userData.entityId = embeddedGroupID || groupId
      object.userData.groupId = groupId
      object.visible = group?.visible ?? true
      if (group) {
        const previous = Array.isArray(object.material) ? object.material : [object.material]
        previous.forEach((material) => material.dispose())
        object.material = new THREE.MeshPhongMaterial({
          color: new THREE.Color(group.color),
          transparent: false,
          opacity: 1,
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
    const controls = controlsRef.current
    if (camera && controls) {
      if (preserveCamera) {
        const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere())
        if (Number.isFinite(sphere.radius) && sphere.radius > 0) {
          cameraBoundsRadiusRef.current = sphere.radius
          configurePerspectiveCameraForBounds(camera, controls, sphere.radius)
        }
      } else {
        fitCameraToObject(camera, controls, root)
      }
    }
  }, [fitCameraToObject])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { renderer, scene } = createScene(container)
    const annotationOverlay = new ViewerOverlayLayer(scene, { layer: VIEWER_OVERLAY_LAYER })
    annotationOverlayRef.current = annotationOverlay

    let rafId: number
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const camera = cameraRef.current
      const controls = controlsRef.current
      controls?.update()
      if (camera && controls && cameraBoundsRadiusRef.current) {
        updatePerspectiveCameraClipping(camera, controls.target, cameraBoundsRadiusRef.current)
      }
      if (camera) renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      annotationOverlay.dispose()
      if (annotationOverlayRef.current === annotationOverlay) annotationOverlayRef.current = null
      inputControllerRef.current = null
      renderer.dispose()
      controlsRef.current?.dispose()
      assetDisposeRef.current?.()
      assetDisposeRef.current = null
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    }
  }, [createScene])

  const fitAssetToViewport = useCallback(() => {
    const asset = assetRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (asset && camera && controls) {
      fitCameraToObject(camera, controls, asset)
    }
  }, [fitCameraToObject])

  useEffect(() => {
    if (!cameraCommand || assetState.status !== 'ready') return
    const asset = assetRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!asset || !camera || !controls) return

    if (cameraCommand.type === 'fit') {
      fitCameraToObject(camera, controls, asset)
      return
    }

    const box = new THREE.Box3()
    if (cameraCommand.type === 'fit-selection' && selection?.groupId) {
      const selectedIds = selection.groupIds?.length ? selection.groupIds : [selection.groupId]
      for (const groupId of selectedIds) {
        const selectedEntity = uvfAssetRef.current?.getEntityObject(groupId)
        if (selectedEntity?.visible) box.expandByObject(selectedEntity)
      }
      for (const mesh of meshesRef.current.values()) {
        if (selectedIds.includes(mesh.userData.groupId) && mesh.visible) {
          box.expandByObject(mesh)
        }
      }
    }
    if (box.isEmpty()) box.setFromObject(asset)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.length() / 2, 0.001)
    const currentDirection = camera.position.clone().sub(controls.target).normalize()
    const directions: Record<'x' | 'y' | 'z' | 'iso', THREE.Vector3> = {
      x: new THREE.Vector3(1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      z: new THREE.Vector3(0, 0, 1),
      iso: new THREE.Vector3(1, 1, 1).normalize(),
    }
    const direction = cameraCommand.type === 'fit-selection'
      ? currentDirection
      : directions[cameraCommand.type]
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25
    camera.up.set(0, 0, 1)
    if (cameraCommand.type === 'z') camera.up.set(0, 1, 0)
    camera.position.copy(center).add(direction.multiplyScalar(distance))
    controls.target.copy(center)
    cameraBoundsRadiusRef.current = radius
    configurePerspectiveCameraForBounds(camera, controls, radius, distance)
    camera.lookAt(center)
    controls.update()
  }, [assetState.status, cameraCommand, fitCameraToObject, selection])

  useViewerViewport({
    containerRef,
    rendererRef,
    cameraRef,
    onResize: fitAssetToViewport,
  })

  useEffect(() => {
    if (manifest && state.status === 'ready') {
      const controller = new AbortController()
      const preserveCamera = loadedAssetURLRef.current === manifest.asset_url && assetRef.current !== null
      setAssetState({ status: 'loading', progress: 0 })
      void updateGeometry(
        manifest,
        controller.signal,
        (progress) => setAssetState({ status: 'loading', progress }),
        requestedLODLevel,
        preserveCamera,
      )
        .then(() => {
          if (!controller.signal.aborted) {
            loadedAssetURLRef.current = manifest.asset_url
            setAssetState({ status: 'ready' })
          }
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
  }, [manifest, requestedLODLevel, state.status, updateGeometry])

  useEffect(() => {
    if (!selection) return
    const selectedIds = new Set(selection.groupIds?.length ? selection.groupIds : [selection.groupId])
    for (const [, mesh] of meshesRef.current) {
      const groupId = String(mesh.userData.groupId ?? '')
      const mat = mesh.material as THREE.MeshPhongMaterial
      const appearance = entityAppearances[groupId]
      const defaultColor = manifest?.groups.find((group) => group.id === groupId)?.color ?? '#6f8790'
      const style = resolveViewerMaterialStyle(
        defaultColor,
        appearance,
        selectedIds.has(groupId),
        effectiveGroupVisibility[groupId] !== false,
      )
      mat.color.set(style.color)
      mat.opacity = style.opacity
      mat.transparent = style.opacity < 1
      mat.depthWrite = style.opacity >= 1
      mat.emissive.set(style.emissive)
      mat.emissiveIntensity = style.emissiveIntensity
      mat.needsUpdate = true
    }
    const asset = uvfAssetRef.current
    if (!asset) return
    asset.object.traverse((object) => {
      if (!(object instanceof THREE.Line)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (!(material instanceof THREE.LineBasicMaterial)) return
        material.color.set(0x30352d)
        material.opacity = 0.72
        material.needsUpdate = true
      })
    })
    asset.getEntityObject(selection.groupId ?? '')?.traverse((object) => {
      if (!(object instanceof THREE.Line)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (!(material instanceof THREE.LineBasicMaterial)) return
        material.color.set(0xd59a2d)
        material.opacity = 1
        material.needsUpdate = true
      })
    })
  }, [assetState.status, selection, manifest, entityVisibility, groupVisibility, entityAppearances])

  useEffect(() => {
    if (!manifest) return
    const entityIds = [
      ...manifest.groups.map((group) => group.id),
      ...(manifest.edges ?? []).map((edge) => edge.id),
    ]
    for (const entityId of entityIds) {
      const visible = effectiveGroupVisibility[entityId] !== false
      if (uvfAssetRef.current) {
        setEntityVisibility(uvfAssetRef.current, entityId, visible)
      } else {
        assetRef.current?.traverse((object) => {
          if (object.userData.groupId === entityId) object.visible = visible
        })
      }
    }
  }, [assetState.status, entityVisibility, groupVisibility, manifest])

  useEffect(() => {
    const clipping = clipPlane
      ? [new THREE.Plane(new THREE.Vector3(...clipPlane.normal).normalize(), clipPlane.constant)]
      : []
    assetRef.current?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        material.clippingPlanes = clipping
        material.clipShadows = clipping.length > 0
        material.needsUpdate = true
      })
    })
  }, [assetState.status, clipPlane])

  useEffect(() => {
    const layer = annotationOverlayRef.current
    const asset = assetRef.current
    if (!layer) return
    if (!asset || !activeResourceRef) {
      layer.clear()
      return
    }
    asset.updateMatrixWorld(true)
    layer.update({
      resourceRef: activeResourceRef,
      assetWorldMatrix: asset.matrixWorld,
      saved: overlays?.saved,
      draft: overlays?.draft,
      hover: overlays?.hover,
      visible: overlays?.visible,
    })
  }, [activeResourceRef, assetState.status, overlays])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (normalsOverlayRef.current) {
      scene.remove(normalsOverlayRef.current)
      disposeObject(normalsOverlayRef.current)
      normalsOverlayRef.current = null
    }
    if (!showNormals || !assetRef.current) return
    const overlay = new THREE.Group()
    overlay.name = '__normals__'
    for (const mesh of meshesRef.current.values()) {
      if (!mesh.visible || mesh.userData.groupId === '__wireframe__') continue
      const helper = new VertexNormalsHelper(mesh, 0.035, 0x3366cc)
      helper.renderOrder = 18
      overlay.add(helper)
    }
    scene.add(overlay)
    normalsOverlayRef.current = overlay
    return () => {
      scene.remove(overlay)
      disposeObject(overlay)
      if (normalsOverlayRef.current === overlay) normalsOverlayRef.current = null
    }
  }, [assetState.status, entityVisibility, groupVisibility, showNormals])

  useEffect(() => {
    if (captureRequest <= 0) return
    const renderer = rendererRef.current
    const scene = sceneRef.current
    const camera = cameraRef.current
    if (!renderer || !scene || !camera) return
    renderer.render(scene, camera)
    onCaptureRef.current?.(renderer.domElement.toDataURL('image/png'))
  }, [captureRequest])

  const toggleGroupVisibility = (groupId: string) => {
    const visible = !(effectiveGroupVisibility[groupId] ?? true)
    const next = { ...effectiveGroupVisibility, [groupId]: visible }
    setGroupVisibilityState(next)
    onEntityVisibilityChange?.(next)
    if (uvfAssetRef.current) {
      setEntityVisibility(uvfAssetRef.current, groupId, visible)
    } else {
      assetRef.current?.traverse((object) => {
        if (object.userData.groupId === groupId) object.visible = visible
      })
    }
    if (!visible && selection?.groupId === groupId) {
      onSelectionChange?.({ groupId: null })
    }
  }

  const resolvePointerPick = (event: ViewerPointerEvent) => {
    const container = containerRef.current
    const camera = cameraRef.current
    const asset = assetRef.current
    if (!container || !camera || !asset || !activeResourceRef) return null
    const rect = container.getBoundingClientRect()
    const raycaster = buildPointerRay(event, camera, rect)
    return resolvePickCandidate(pickScene(raycaster, [asset]), {
      projectId: projectId ?? 'viewer-local',
      resourceRef: activeResourceRef,
      assetRoot: asset,
    })
  }

  const meshForEntity = (entityId: string | undefined) => {
    if (!entityId) return undefined
    return Array.from(meshesRef.current.values()).find((mesh) =>
      String(mesh.userData.entityId ?? '') === entityId ||
      String(mesh.userData.groupId ?? '') === entityId,
    )
  }

  const createInputController = () => {
    return new ViewerInputController({
      resolvePick: resolvePointerPick,
      activeTool: toolInput,
      fieldProbe: {
        isActive: () => Boolean(selectedField && uvfAssetRef.current && onFieldProbe),
        allowMiss: true,
        onPick: (pick) => {
          if (!pick) {
            onFieldProbe?.(null)
            return false
          }
          const mesh = meshForEntity(pick.entityId)
          const asset = uvfAssetRef.current
          if (!selectedField || !asset || !mesh) return false
          onFieldProbe?.(probeFieldAtIntersection(
            asset,
            mesh,
            selectedField,
            pick.triangleIndex,
            new THREE.Vector3(...pick.worldPosition),
          ))
          return true
        },
      },
      selection: {
        allowMiss: true,
        onPick: (pick, event) => {
          if (!pick) {
            onSelectionChange?.({ groupId: null })
            setHoveredGroup(null)
            return true
          }
          const mesh = meshForEntity(pick.entityId)
          const groupId = String(mesh?.userData.groupId ?? pick.entityId ?? '')
          if (!groupId) return false
          const current = selection?.groupIds?.length
            ? selection.groupIds
            : selection?.groupId ? [selection.groupId] : []
          const additive = event.ctrlKey || event.metaKey || event.shiftKey
          const groupIds = additive
            ? current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]
            : [groupId]
          onSelectionChange?.({ groupId: groupIds.at(-1) ?? null, groupIds })
          setHoveredGroup(groupId)
          return true
        },
      },
      onHover: (pick) => {
        const mesh = meshForEntity(pick?.entityId)
        setHoveredGroup(mesh ? String(mesh.userData.groupId ?? '') || null : null)
      },
    })
  }

  const pointerEvent = (event: React.PointerEvent<HTMLDivElement>): ViewerPointerEvent => ({
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  })

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const controller = createInputController()
    inputControllerRef.current = controller
    controller.onPointerDown(pointerEvent(event))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    inputControllerRef.current?.onPointerUp(pointerEvent(event))
    inputControllerRef.current = null
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const controller = inputControllerRef.current ?? createInputController()
    inputControllerRef.current = controller
    controller.onPointerMove(pointerEvent(event))
  }

  const handlePointerLeave = () => {
    inputControllerRef.current?.onPointerLeave()
    inputControllerRef.current = null
    setHoveredGroup(null)
  }

  useEffect(() => {
    if (uvfAssetRef.current) {
      applyFieldColoring(uvfAssetRef.current, selectedField, colormap, {
        range: fieldRange,
        scale: resolvedFieldScale,
      })
    }
  }, [assetState.status, selectedField, colormap, fieldRange, resolvedFieldScale])

  useEffect(() => {
    if (uvfAssetRef.current) {
      onFieldHistogramChangeRef.current?.(
        selectedField ? createFieldHistogram(uvfAssetRef.current, selectedField) : null,
      )
      onFieldExtremaChangeRef.current?.(
        selectedField ? findFieldExtrema(uvfAssetRef.current, selectedField) : null,
      )
    } else {
      onFieldHistogramChangeRef.current?.(null)
      onFieldExtremaChangeRef.current?.(null)
    }
  }, [assetState.status, selectedField])

  useEffect(() => {
    const asset = uvfAssetRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!asset || !camera || !controls || !focusTarget) return
    asset.object.updateMatrixWorld(true)
    const target = asset.object.localToWorld(new THREE.Vector3(...focusTarget))
    const offset = camera.position.clone().sub(controls.target)
    controls.target.copy(target)
    camera.position.copy(target).add(offset)
    camera.lookAt(target)
    controls.update()
  }, [focusTarget])

  useEffect(() => {
    if (uvfAssetRef.current) {
      setWireframeOverlay(uvfAssetRef.current, effectiveWireframe)
    }
  }, [assetState.status, effectiveWireframe])

  const handleWireframeToggle = () => {
    const next = !effectiveWireframe
    if (wireframe === undefined) setWireframeOn(next)
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
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={onDoubleClick}
        onPointerCancel={() => {
          inputControllerRef.current?.cancelPointer()
          inputControllerRef.current = null
        }}
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
          <span>{assetStats.triangles.toLocaleString()} tris</span>
          <ViewerPrecisionControl
            levels={precisionInfo.levels}
            currentLevel={precisionInfo.currentLevel}
            selection={precisionSelection}
            onChange={(selection) => setPrecision({ assetURL: manifest?.asset_url ?? null, selection })}
          />
          <button
            className={`viewer-wireframe-toggle ${effectiveWireframe ? 'active' : ''}`}
            onClick={handleWireframeToggle}
            aria-label="Toggle wireframe overlay"
            aria-pressed={effectiveWireframe}
            title="Toggle wireframe"
          >
            Wire
          </button>
        </div>
      )}
      {toolbar && visibleState.status === 'ready' && (
        <div className="viewer-toolbar-slot">{toolbar}</div>
      )}
      {showFieldPanel && displayedFields.length > 0 && visibleState.status === 'ready' && (
        <div className="viewer-field-panel">
          <label className="viewer-field-label">
            Field:
            <select
              value={selectedField ?? ''}
              onChange={(e) => selectField(e.target.value || null)}
            >
              <option value="">None</option>
              {displayedFields.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name} ({f.kind}, {formatFieldRange(f.min, f.max).join('–')})
                </option>
              ))}
            </select>
          </label>
          {selectedField && (
            <div className="viewer-field-controls">
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
              <label className="viewer-field-label">
                Scale:
                <select
                  value={fieldScale}
                  onChange={(e) => setFieldScale(e.target.value as UVFFieldScale)}
                >
                  <option value="auto">Auto ({resolvedFieldScale === 'log' ? 'Log10' : 'Linear'})</option>
                  <option value="linear">Linear</option>
                  <option value="log" disabled={!activeField || !canUseLogFieldScale(activeField.min, activeField.max)}>
                    Log10
                  </option>
                </select>
              </label>
              <button
                className={`viewer-field-wire-toggle ${effectiveWireframe ? 'active' : ''}`}
                type="button"
                onClick={handleWireframeToggle}
                aria-pressed={effectiveWireframe}
                title="Overlay mesh edges on the field colors"
              >
                Wire overlay
              </button>
            </div>
          )}
          {selectedField && (
            <div className="viewer-colormap-bar">
              <span className="viewer-colormap-min">
                {activeFieldRange?.[0] ?? '—'}
              </span>
              <div
                className="viewer-colormap-gradient"
                style={{ background: buildGradientCSS(colormap) }}
              />
              <span className="viewer-colormap-max">
                {activeFieldRange?.[1] ?? '—'}
              </span>
            </div>
          )}
        </div>
      )}
      {showEntityLegend && manifest && (
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
                className={`viewer-legend-item ${(selection?.groupIds ?? [selection?.groupId]).includes(g.id) ? 'selected' : ''} ${effectiveGroupVisibility[g.id] === false ? 'hidden' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                onSelectionChange?.({ groupId: g.id })
              }}
            >
              <button
                type="button"
                className="viewer-group-visibility"
                aria-label={`${effectiveGroupVisibility[g.id] === false ? 'Show' : 'Hide'} ${g.name}`}
                aria-pressed={effectiveGroupVisibility[g.id] !== false}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleGroupVisibility(g.id)
                }}
              >
                {effectiveGroupVisibility[g.id] === false ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
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
