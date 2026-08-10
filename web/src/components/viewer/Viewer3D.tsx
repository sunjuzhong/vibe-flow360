import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Crosshair, Eye, EyeOff, Focus } from 'lucide-react'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js'
import { UVFLoader, applyFieldColoring, canUseLogFieldScale, createFieldHistogram, findFieldExtrema, formatFieldRange, probeFieldAtIntersection, resolveFieldScale, setEntityVisibility, setFieldFilterOverlay, setWireframeOverlay, updateWireframeOverlayForCamera, wireframeOverlayOpacity, type ColormapName, listColormaps, sampleColormap } from '../../lib/uvf-three'
import type { UVFAsset, UVFAssetLRU, UVFFieldExtrema, UVFFieldFilter, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe, UVFFieldScale } from '../../lib/uvf-three'
import {
  configureCFDNavigationControls,
  configurePerspectiveCameraForBounds,
  fitPerspectiveCameraToObject,
  interpolateCameraPivot,
  updatePerspectiveCameraClipping,
} from '../../lib/viewerCamera'
import { useViewerViewport } from '../../hooks/useViewerViewport'
import { resolveViewerMaterialStyle } from '../../lib/viewerMaterial'
import { ViewerNavCubeController, type NavCubeOrientation } from '../../lib/viewerNavCube'
import {
  VIEWER_OVERLAY_LAYER,
  ViewerInputController,
  ViewerOverlayLayer,
  DefaultSnapResolver,
  applySnapCandidate,
  buildPointerRay,
  createSnapCycleState,
  cycleSnapCandidate,
  pickScene,
  replaceSnapCandidates,
  resolveFreePoint,
  resolvePickCandidate,
  selectedSnapCandidate,
  setSnapBypassed,
  snapPolicyFromPickPolicy,
  snapStatusModel,
  type CadTopologyProvider,
  type CadTopologyCandidates,
  type OverlayAnnotation,
  type PickResult,
  type ResourceRef,
  type SnapCycleState,
  type SnapStatusModel,
  type ToolInputConsumer,
  type ViewerOverlayFrame,
  type ViewerPointerEvent,
} from '../../lib/viewer-tools'
import { commonPrecisionLevels, ViewerPrecisionControl, type ViewerPrecisionSelection } from './ViewerPrecisionControl'
import { viewerLoadingLabel, type ViewerLoadingState } from './viewerLoading'
import { useI18n } from '../../i18n'

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

export type ViewerAssetStats = {
  faces: number
  edges: number
  triangles: number
}

export type ViewerEntityAppearance = { color: string; opacity: number }

export type ViewerClipPlane = {
  normal: [number, number, number]
  constant: number
}

export type ViewerCameraCommand = {
  type: 'fit' | 'fit-selection' | 'x' | '-x' | 'y' | '-y' | 'z' | '-z' | 'iso'
  nonce: number
}

export type ViewerOverlayContent = Omit<ViewerOverlayFrame, 'resourceRef' | 'assetWorldMatrix'>

export function createEngineeringLightRig() {
  const rig = new THREE.Group()
  rig.name = 'engineering-viewer-light-rig'

  // CFD review needs readable geometry from every direction. The hemisphere
  // light keeps normals legible without flattening them, while the low fill
  // prevents the underside from becoming a black silhouette.
  const ambient = new THREE.AmbientLight(0xffffff, 0.25)
  ambient.name = 'ambient-fill'
  rig.add(ambient)

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xd9e2e8, 0.7)
  hemisphere.name = 'sky-ground-fill'
  hemisphere.position.set(0, 0, 1)
  rig.add(hemisphere)

  const key = new THREE.DirectionalLight(0xffffff, 0.55)
  key.name = 'upper-key'
  key.position.set(5, 8, 10)
  rig.add(key)

  const lowerFill = new THREE.DirectionalLight(0xe8f1ff, 0.4)
  lowerFill.name = 'lower-fill'
  lowerFill.position.set(-4, -6, -5)
  rig.add(lowerFill)

  const rim = new THREE.DirectionalLight(0xf4f7ff, 0.25)
  rim.name = 'side-rim'
  rim.position.set(-7, 4, 2)
  rig.add(rim)

  return rig
}

export function ViewerNavCube({
  onCommand,
}: {
  onCommand: (type: ViewerCameraCommand['type']) => void
}) {
  return (
    <div className="viewer-navigation" aria-label="3D view navigation">
      <div className="viewer-navcube" role="group" aria-label="NavCube orientation controls">
        <button type="button" onClick={() => onCommand('x')} aria-label="View from positive X">+X</button>
        <button type="button" onClick={() => onCommand('-x')} aria-label="View from negative X">−X</button>
        <button type="button" onClick={() => onCommand('y')} aria-label="View from positive Y">+Y</button>
        <button type="button" onClick={() => onCommand('-y')} aria-label="View from negative Y">−Y</button>
        <button type="button" onClick={() => onCommand('z')} aria-label="View from positive Z">+Z</button>
        <button type="button" onClick={() => onCommand('-z')} aria-label="View from negative Z">−Z</button>
        <button type="button" onClick={() => onCommand('iso')} aria-label="Isometric view">ISO</button>
      </div>
    </div>
  )
}

function nearestControlPointIndex(
  points: readonly PickResult[] | undefined,
  clientX: number,
  clientY: number,
  camera: THREE.Camera | null,
  viewport: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'> | undefined,
  threshold = 14,
): number | null {
  if (!points?.length || !camera || !viewport?.width || !viewport.height) return null
  let nearestIndex: number | null = null
  let nearestDistanceSquared = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const projected = new THREE.Vector3(...point.worldPosition).project(camera)
    if (projected.z < -1 || projected.z > 1) continue
    const x = viewport.left + (projected.x + 1) * viewport.width / 2
    const y = viewport.top + (1 - projected.y) * viewport.height / 2
    const distanceSquared = (clientX - x) ** 2 + (clientY - y) ** 2
    if (distanceSquared <= threshold ** 2 && distanceSquared < nearestDistanceSquared) {
      nearestIndex = index
      nearestDistanceSquared = distanceSquared
    }
  }
  return nearestIndex
}

export type ViewerState =
  | { status: 'idle' }
  | ViewerLoadingState
  | { status: 'ready' }
  | { status: 'error'; message: string }

export function shouldKeepPreviousAssetVisible(
  preserveCameraOnAssetChange: boolean,
  hasLoadedAsset: boolean,
  status: ViewerState['status'],
) {
  return preserveCameraOnAssetChange && hasLoadedAsset && status === 'loading'
}

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
  fieldFilter?: UVFFieldFilter | null
  onFieldFilterMatchCount?: (count: number) => void
  onAssetStatsChange?: (stats: ViewerAssetStats | null) => void
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
  showWarnings?: boolean
  toolbar?: React.ReactNode
  topToolbar?: React.ReactNode
  floatingPanel?: React.ReactNode
  cameraCommand?: ViewerCameraCommand | null
  showNormals?: boolean
  entityAppearances?: Record<string, ViewerEntityAppearance>
  preserveCameraOnAssetChange?: boolean
  uvfAssetCache?: UVFAssetLRU
  onAssetReady?: (assetURL: string) => void
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
  fieldFilter,
  onFieldFilterMatchCount,
  onAssetStatsChange,
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
  showWarnings = true,
  toolbar,
  topToolbar,
  floatingPanel,
  cameraCommand,
  showNormals = false,
  entityAppearances = {},
  preserveCameraOnAssetChange = false,
  uvfAssetCache,
  onAssetReady,
}: Props) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const assetBoundsSphereRef = useRef<THREE.Sphere | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const assetRef = useRef<THREE.Object3D | null>(null)
  const loadedAssetURLRef = useRef<string | null>(null)
  const assetDisposeRef = useRef<(() => void) | null>(null)
  const uvfAssetRef = useRef<UVFAsset | null>(null)
  const annotationOverlayRef = useRef<ViewerOverlayLayer | null>(null)
  const inputControllerRef = useRef<ViewerInputController | null>(null)
  const draggedControlPointRef = useRef<{ index: number; pointerId: number } | null>(null)
  const snapResolverRef = useRef(new DefaultSnapResolver())
  const snapCycleRef = useRef<SnapCycleState>(createSnapCycleState())
  const cadTopologyRef = useRef<{ asset: THREE.Object3D; provider: CadTopologyProvider } | null>(null)
  const normalsOverlayRef = useRef<THREE.Group | null>(null)
  const navCubeRef = useRef<ViewerNavCubeController | null>(null)
  const navCubeAnimationRef = useRef<number | null>(null)
  const pivotFeedbackTimeoutRef = useRef<number | null>(null)
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)
  const [snapStatus, setSnapStatus] = useState<SnapStatusModel | null>(null)
  const [draggingControlPoint, setDraggingControlPoint] = useState<number | null>(null)
  const [cameraNavigating, setCameraNavigating] = useState(false)
  const [pivotFeedback, setPivotFeedback] = useState<{ x: number; y: number; id: number } | null>(null)
  const [assetState, setAssetState] = useState<ViewerState>({ status: 'idle' })
  const [assetStats, setAssetStats] = useState<ViewerAssetStats | null>(null)
  const [precision, setPrecision] = useState<{ assetURL: string | null; selection: ViewerPrecisionSelection }>({
    assetURL: null,
    selection: 'default',
  })
  const [precisionInfo, setPrecisionInfo] = useState({ levels: 1, currentLevel: 0 })
  const [precisionNotice, setPrecisionNotice] = useState<{ assetURL: string | null; message: string }>({
    assetURL: null,
    message: '',
  })
  const [unavailablePrecision, setUnavailablePrecision] = useState<{ assetURL: string | null; levels: number[] }>({
    assetURL: null,
    levels: [],
  })
  const [internalSelectedField, setInternalSelectedField] = useState<string | null>(null)
  const [colormap, setColormap] = useState<ColormapName>('viridis')
  const [fieldScale, setFieldScale] = useState<UVFFieldScale>('auto')
  const [availableFields, setAvailableFields] = useState<UVFFieldInfo[]>([])
  const [colormaps] = useState<ColormapName[]>(listColormaps())
  const [groupVisibility, setGroupVisibilityState] = useState<Record<string, boolean>>({})
  const [probeToolActive, setProbeToolActive] = useState(false)
  const [probeResult, setProbeResult] = useState<{
    surfaceId: string
    surfaceName: string
    field: UVFFieldProbe | null
  } | null>(null)

  const [wireframeOn, setWireframeOn] = useState(false)
  const onFieldsDiscoveredRef = useRef(onFieldsDiscovered)
  const onAssetReadyRef = useRef(onAssetReady)
  const onFieldHistogramChangeRef = useRef(onFieldHistogramChange)
  const onFieldExtremaChangeRef = useRef(onFieldExtremaChange)
  const onFieldFilterMatchCountRef = useRef(onFieldFilterMatchCount)
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
  const framePresentationRef = useRef({ selectedField, colormap, fieldRange, fieldScale, wireframe: effectiveWireframe })
  framePresentationRef.current = { selectedField, colormap, fieldRange, fieldScale, wireframe: effectiveWireframe }
  const precisionSelection = precision.assetURL === manifest?.asset_url ? precision.selection : 'default'
  const requestedLODLevel = precisionSelection === 'default' ? undefined : precisionSelection
  const unavailablePrecisionLevels = new Set(
    unavailablePrecision.assetURL === manifest?.asset_url ? unavailablePrecision.levels : [],
  )
  const activePrecisionNotice = precisionNotice.assetURL === manifest?.asset_url ? precisionNotice.message : ''
  const activeResourceRef = useMemo<ResourceRef | null>(() => {
    if (resourceRef) return resourceRef
    if (!manifest?.asset_url) return null
    return { id: manifest.asset_url, type: manifest.format || 'viewer-asset' }
  }, [manifest?.asset_url, manifest?.format, resourceRef])
  const snapIndicatorAnnotations = useMemo<readonly OverlayAnnotation[]>(() => {
    const indicator = snapStatus?.indicator
    if (!indicator || snapStatus.mode === 'surface' || snapStatus.mode === 'unavailable') return []
    return [{
      annotationId: '__snap_candidate__',
      coordinateFrame: { kind: 'world' },
      state: 'hover',
      primitives: [
        { kind: 'point', key: 'snap-point', position: indicator.position, color: '#22d3ee', size: 8 },
        { kind: 'label', key: 'snap-label', position: indicator.position, text: indicator.label, color: '#67e8f9' },
      ],
    }]
  }, [snapStatus])
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
    onFieldFilterMatchCountRef.current = onFieldFilterMatchCount
    onCaptureRef.current = onCapture
    onAssetReadyRef.current = onAssetReady
  }, [onAssetReady, onCapture, onFieldExtremaChange, onFieldFilterMatchCount, onFieldHistogramChange, onFieldsDiscovered])

  useEffect(() => {
    onAssetStatsChange?.(assetStats)
    return () => onAssetStatsChange?.(null)
  }, [assetStats, onAssetStatsChange])

  const selectField = (field: string | null) => {
    if (controlledSelectedField === undefined) setInternalSelectedField(field)
    onSelectedFieldChange?.(field)
    if (!field) setProbeToolActive(false)
    setProbeResult(null)
    onFieldProbe?.(null)
  }

  const toggleProbeTool = () => {
    const next = !probeToolActive
    setProbeToolActive(next)
    setProbeResult(null)
    onFieldProbe?.(null)
  }

  const fitCameraToObject = useCallback((
    camera: THREE.PerspectiveCamera,
    controls: OrbitControls,
    object: THREE.Object3D,
  ) => {
    const fit = fitPerspectiveCameraToObject(camera, controls, object)
    assetBoundsSphereRef.current = fit
      ? new THREE.Sphere(fit.center.clone(), fit.radius)
      : null
    return fit
  }, [])

  const navigateFromNavCube = useCallback(({ direction, up }: NavCubeOrientation) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    if (navCubeAnimationRef.current !== null) cancelAnimationFrame(navCubeAnimationRef.current)

    const center = controls.target.clone()
    const distance = Math.max(camera.position.distanceTo(center), 0.001)
    const startDirection = camera.position.clone().sub(center).normalize()
    const startUp = camera.up.clone().normalize()
    const rotation = new THREE.Quaternion().setFromUnitVectors(startDirection, direction.clone().normalize())
    const startedAt = performance.now()
    const duration = 260
    const animateCamera = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / duration)
      const progress = linear * linear * (3 - 2 * linear)
      const stepRotation = new THREE.Quaternion().identity().slerp(rotation, progress)
      const stepDirection = startDirection.clone().applyQuaternion(stepRotation).normalize()
      const stepUp = startUp.clone().lerp(up, progress)
      if (stepUp.lengthSq() < 1e-8) stepUp.copy(up)
      camera.position.copy(center).add(stepDirection.multiplyScalar(distance))
      camera.up.copy(stepUp.normalize())
      camera.lookAt(center)
      controls.update()
      if (linear < 1) {
        navCubeAnimationRef.current = requestAnimationFrame(animateCamera)
      } else {
        navCubeAnimationRef.current = null
      }
    }
    navCubeAnimationRef.current = requestAnimationFrame(animateCamera)
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
    configureCFDNavigationControls(controls)
    controls.addEventListener('start', () => setCameraNavigating(true))
    controls.addEventListener('end', () => setCameraNavigating(false))

    scene.add(createEngineeringLightRig())

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

    const previousRoot = assetRef.current
    const previousDispose = assetDisposeRef.current
    const retainPrevious = preserveCamera && previousRoot !== null
    if (!retainPrevious) {
      previousDispose?.()
      assetDisposeRef.current = null
      uvfAssetRef.current = null
      meshesRef.current.clear()
      if (previousRoot) scene.remove(previousRoot)
      assetRef.current = null
      setAssetStats(null)
      assetBoundsSphereRef.current = null
      setAvailableFields([])
      setInternalSelectedField(null)
    }

    if (!manifest.asset_url) return
    let root: THREE.Object3D
    let nextDispose: (() => void) | null = null
    let nextUVFAsset: UVFAsset | null = null
    let nextAssetStats: ViewerAssetStats | null = null
    let nextPrecisionInfo = { levels: 1, currentLevel: 0 }
    let nextFields: UVFFieldInfo[] = []
    const nextMeshes = new Map<string, THREE.Mesh>()
    if (manifest.format === 'flow360-uvf') {
      const asset = await (uvfAssetCache
        ? uvfAssetCache.acquire(manifest.asset_url, {
          signal,
          onProgress: ({ progress }) => onProgress(progress),
        })
        : new UVFLoader().load(manifest.asset_url, {
          signal,
          lodLevel,
          onProgress: ({ progress }) => onProgress(progress),
        }))
      const disposeAsset = uvfAssetCache
        ? () => uvfAssetCache.release(manifest.asset_url)
        : asset.dispose
      if (signal.aborted) {
        disposeAsset()
        return
      }
      root = asset.object
      nextDispose = disposeAsset
      nextUVFAsset = asset
      nextAssetStats = { faces: asset.faces, edges: asset.edges, triangles: asset.triangles }
      nextPrecisionInfo = { levels: commonPrecisionLevels(asset.entityLODs), currentLevel: asset.currentLOD }
      nextFields = asset.fields
    } else {
      const gltf = await new GLTFLoader().loadAsync(manifest.asset_url)
      if (signal.aborted) {
        disposeObject(gltf.scene)
        return
      }
      root = gltf.scene
      nextDispose = () => disposeObject(root)
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
      nextMeshes.set(`${groupId}-${object.uuid}`, object)
    })
    if (root.userData.viewerNormalized !== true) {
      const bounds = new THREE.Box3().setFromObject(root)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z, 0.001)
      const scale = 2 / maxDim
      root.scale.setScalar(scale)
      root.position.copy(center.multiplyScalar(-scale))
      root.userData.viewerNormalized = true
    }
    if (nextUVFAsset) {
      const presentation = framePresentationRef.current
      const nextField = nextFields.find((field) => field.name === presentation.selectedField)
      applyFieldColoring(nextUVFAsset, presentation.selectedField, presentation.colormap, {
        range: presentation.fieldRange,
        scale: nextField
          ? resolveFieldScale(presentation.fieldScale, nextField.min, nextField.max)
          : 'linear',
      })
      setWireframeOverlay(nextUVFAsset, presentation.wireframe)
    }
    if (retainPrevious && previousRoot) {
      scene.remove(previousRoot)
      previousDispose?.()
    }
    scene.add(root)
    assetRef.current = root
    assetDisposeRef.current = nextDispose
    uvfAssetRef.current = nextUVFAsset
    meshesRef.current = nextMeshes
    setAssetStats(nextAssetStats)
    setPrecisionInfo(nextPrecisionInfo)
    setAvailableFields(nextFields)
    onFieldsDiscoveredRef.current?.(nextFields)
    setInternalSelectedField(null)
    const assetBoundsSphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere())
    assetBoundsSphereRef.current = Number.isFinite(assetBoundsSphere.radius) && assetBoundsSphere.radius > 0
      ? assetBoundsSphere
      : null

    const camera = cameraRef.current
    const controls = controlsRef.current
    if (camera && controls) {
      if (preserveCamera) {
        const sphere = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere())
        if (Number.isFinite(sphere.radius) && sphere.radius > 0) {
          assetBoundsSphereRef.current = sphere
          configurePerspectiveCameraForBounds(camera, controls, sphere.radius, undefined, sphere)
        }
      } else {
        fitCameraToObject(camera, controls, root)
      }
    }
  }, [fitCameraToObject, uvfAssetCache])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { renderer, scene } = createScene(container)
    const navCube = new ViewerNavCubeController(renderer, navigateFromNavCube)
    navCubeRef.current = navCube
    const annotationOverlay = new ViewerOverlayLayer(scene, { layer: VIEWER_OVERLAY_LAYER })
    annotationOverlayRef.current = annotationOverlay

    let rafId: number
    const animate = () => {
      rafId = requestAnimationFrame(animate)
      const camera = cameraRef.current
      const controls = controlsRef.current
      controls?.update()
      const assetBoundsSphere = assetBoundsSphereRef.current
      if (camera && assetBoundsSphere) {
        updatePerspectiveCameraClipping(camera, assetBoundsSphere.center, assetBoundsSphere.radius)
      }
      if (camera && uvfAssetRef.current) {
        updateWireframeOverlayForCamera(uvfAssetRef.current, camera, renderer.domElement.clientHeight)
      }
      if (camera) {
        renderer.render(scene, camera)
        navCube.update(camera, controls?.target ?? new THREE.Vector3())
        navCube.renderOverlay()
      }
    }
    animate()

    return () => {
      cancelAnimationFrame(rafId)
      if (navCubeAnimationRef.current !== null) cancelAnimationFrame(navCubeAnimationRef.current)
      navCubeAnimationRef.current = null
      if (pivotFeedbackTimeoutRef.current !== null) window.clearTimeout(pivotFeedbackTimeoutRef.current)
      pivotFeedbackTimeoutRef.current = null
      navCube.dispose()
      if (navCubeRef.current === navCube) navCubeRef.current = null
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
  }, [createScene, navigateFromNavCube])

  const fitAssetToViewport = useCallback(() => {
    const asset = assetRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (asset && camera && controls) {
      fitCameraToObject(camera, controls, asset)
    }
  }, [fitCameraToObject])

  const applyCameraCommand = useCallback((type: ViewerCameraCommand['type']) => {
    if (assetState.status !== 'ready') return
    const asset = assetRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!asset || !camera || !controls) return

    if (type === 'fit') {
      fitCameraToObject(camera, controls, asset)
      return
    }

    const box = new THREE.Box3()
    if (type === 'fit-selection' && selection?.groupId) {
      const selectedIds = selection.groupIds?.length ? selection.groupIds : [selection.groupId]
      for (const groupId of selectedIds) {
        const selectedEntity = uvfAssetRef.current?.getEntityObject(groupId)
        if (selectedEntity?.visible) box.expandByObject(selectedEntity)
      }
      for (const mesh of meshesRef.current.values()) {
        if (selectedIds.includes(mesh.userData.groupId) && mesh.visible) box.expandByObject(mesh)
      }
    }
    if (box.isEmpty()) box.setFromObject(asset)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.length() / 2, 0.001)
    const directions: Record<Exclude<ViewerCameraCommand['type'], 'fit' | 'fit-selection'>, THREE.Vector3> = {
      x: new THREE.Vector3(1, 0, 0),
      '-x': new THREE.Vector3(-1, 0, 0),
      y: new THREE.Vector3(0, 1, 0),
      '-y': new THREE.Vector3(0, -1, 0),
      z: new THREE.Vector3(0, 0, 1),
      '-z': new THREE.Vector3(0, 0, -1),
      iso: new THREE.Vector3(1, 1, 1).normalize(),
    }
    const direction = type === 'fit-selection'
      ? camera.position.clone().sub(controls.target).normalize()
      : directions[type]
    const distance = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25
    camera.up.set(0, 0, 1)
    if (type === 'z' || type === '-z') camera.up.set(0, 1, 0)
    camera.position.copy(center).add(direction.multiplyScalar(distance))
    controls.target.copy(center)
    const assetBoundsSphere = assetBoundsSphereRef.current
    configurePerspectiveCameraForBounds(camera, controls, radius, distance, assetBoundsSphere ?? undefined)
    camera.lookAt(center)
    controls.update()
  }, [assetState.status, fitCameraToObject, selection])

  useEffect(() => {
    if (!cameraCommand) return
    applyCameraCommand(cameraCommand.type)
  }, [applyCameraCommand, cameraCommand])

  useViewerViewport({
    containerRef,
    rendererRef,
    cameraRef,
    onResize: fitAssetToViewport,
  })

  useEffect(() => {
    if (manifest && state.status === 'ready') {
      const controller = new AbortController()
      const preserveCamera = assetRef.current !== null && (
        loadedAssetURLRef.current === manifest.asset_url || preserveCameraOnAssetChange
      )
      setAssetState({ status: 'loading', message: 'Loading 3D resources…' })
      void updateGeometry(
        manifest,
        controller.signal,
        (progress) => setAssetState({ status: 'loading', message: 'Loading 3D resources…', progress }),
        requestedLODLevel,
        preserveCamera,
      )
        .then(() => {
          if (!controller.signal.aborted) {
            loadedAssetURLRef.current = manifest.asset_url
            onAssetReadyRef.current?.(manifest.asset_url)
            if (requestedLODLevel !== undefined) setPrecisionNotice({ assetURL: manifest.asset_url, message: '' })
            setAssetState({ status: 'ready' })
          }
        })
        .catch((cause) => {
          if (controller.signal.aborted) return
          if (requestedLODLevel !== undefined) {
            setUnavailablePrecision((current) => ({
              assetURL: manifest.asset_url,
              levels: current.assetURL === manifest.asset_url
                ? [...new Set([...current.levels, requestedLODLevel])]
                : [requestedLODLevel],
            }))
            setPrecision({ assetURL: manifest.asset_url, selection: 'default' })
            setPrecisionNotice({
              assetURL: manifest.asset_url,
              message: precisionFallbackNotice(requestedLODLevel, precisionInfo.currentLevel),
            })
            setAssetState({ status: 'loading', message: 'Selected precision is unavailable. Restoring manifest default…' })
            return
          }
          setAssetState({
            status: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
          })
        })
      return () => controller.abort()
    }
    setAssetState(state)
  }, [manifest, preserveCameraOnAssetChange, requestedLODLevel, state.status, updateGeometry])

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
      if (object.userData.uvfFieldFilterOverlay === true) return
      if (object.userData.uvfWireframeOverlay === true) object.userData.uvfWireframeSelected = false
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (!(material instanceof THREE.LineBasicMaterial)) return
        material.color.set(0x30352d)
        material.opacity = wireframeOverlayOpacity(object) ?? 0.72
        material.needsUpdate = true
      })
    })
    asset.getEntityObject(selection.groupId ?? '')?.traverse((object) => {
      if (!(object instanceof THREE.Line)) return
      if (object.userData.uvfFieldFilterOverlay === true) return
      if (object.userData.uvfWireframeOverlay === true) object.userData.uvfWireframeSelected = true
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        if (!(material instanceof THREE.LineBasicMaterial)) return
        material.color.set(0xd59a2d)
        material.opacity = wireframeOverlayOpacity(object, true) ?? 1
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
      hover: [...(overlays?.hover ?? []), ...snapIndicatorAnnotations],
      visible: overlays?.visible,
    })
  }, [activeResourceRef, assetState.status, overlays, snapIndicatorAnnotations])

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
    const intersection = pickScene(raycaster, [asset])
    const basePick = resolvePickCandidate(intersection, {
      projectId: projectId ?? 'viewer-local',
      resourceRef: activeResourceRef,
      assetRoot: asset,
    })
    const toolInteractionActive = Boolean(toolInput) && (
      (toolInput?.isActive?.() ?? true) || Boolean(toolInput?.controlPoints?.length)
    )
    if (!intersection || !basePick) {
      if (snapStatus) setSnapStatus(null)
      snapCycleRef.current = createSnapCycleState()
      if (!toolInteractionActive) return basePick
      const controls = controlsRef.current
      return resolveFreePoint(raycaster, {
        projectId: projectId ?? 'viewer-local',
        resourceRef: activeResourceRef,
        assetRoot: asset,
        planePoint: controls?.target.clone() ?? new THREE.Vector3(),
        planeNormal: camera.getWorldDirection(new THREE.Vector3()),
        fallbackDistance: controls ? camera.position.distanceTo(controls.target) : undefined,
      })
    }
    if (!toolInteractionActive) {
      if (snapStatus) setSnapStatus(null)
      snapCycleRef.current = createSnapCycleState()
      return basePick
    }
    if (cadTopologyRef.current?.asset !== asset) {
      cadTopologyRef.current = { asset, provider: createCadTopologyProvider(asset) }
    }
    const resolution = snapResolverRef.current.resolve({
      intersection,
      camera,
      screenPosition: { x: event.clientX, y: event.clientY },
      viewport: rect,
      context: {
        cadTopology: cadTopologyRef.current.provider,
        isObjectEligible: (object) => object.visible && object.layers.test(raycaster.layers),
        isTopologyEntityVisible: (entityId) => effectiveGroupVisibility[entityId] !== false,
      },
      toolPolicy: toolInput?.pickPolicy ? snapPolicyFromPickPolicy(toolInput.pickPolicy) : undefined,
      altKey: event.altKey,
    })
    let cycle = replaceSnapCandidates(snapCycleRef.current, resolution.candidates)
    cycle = setSnapBypassed(cycle, Boolean(event.altKey))
    snapCycleRef.current = cycle
    const status = snapStatusModel(cycle)
    setSnapStatus((current) => sameSnapStatus(current, status) ? current : status)
    const selected = selectedSnapCandidate(cycle)
    if (!selected) return basePick
    return applySnapCandidate(basePick, selected, (worldPosition) => {
      asset.updateWorldMatrix(true, false)
      const local = asset.worldToLocal(worldPosition)
      return [local.x, local.y, local.z]
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
        isActive: () => Boolean(probeToolActive && selectedField && uvfAssetRef.current),
        allowMiss: true,
        onPick: (pick) => {
          if (!pick) {
            setProbeResult(null)
            onFieldProbe?.(null)
            return false
          }
          const mesh = meshForEntity(pick.entityId)
          const asset = uvfAssetRef.current
          if (!selectedField || !asset || !mesh) return false
          const field = probeFieldAtIntersection(
            asset,
            mesh,
            selectedField,
            pick.triangleIndex,
            new THREE.Vector3(...pick.worldPosition),
          )
          setProbeResult({
            surfaceId: String(mesh.userData.entityId ?? mesh.userData.groupId ?? pick.entityId),
            surfaceName: mesh.name || String(mesh.userData.entityId ?? mesh.userData.groupId ?? pick.entityId),
            field,
          })
          onFieldProbe?.(field)
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
    altKey: event.altKey,
  })

  const animatePivotTo = useCallback((nextTarget: THREE.Vector3) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    if (navCubeAnimationRef.current !== null) cancelAnimationFrame(navCubeAnimationRef.current)
    const startPosition = camera.position.clone()
    const startTarget = controls.target.clone()
    const startedAt = performance.now()
    const duration = 180
    const animateCamera = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / duration)
      const progress = linear * linear * (3 - 2 * linear)
      const frame = interpolateCameraPivot(startPosition, startTarget, nextTarget, progress)
      camera.position.copy(frame.position)
      controls.target.copy(frame.target)
      camera.lookAt(frame.target)
      controls.update()
      if (linear < 1) navCubeAnimationRef.current = requestAnimationFrame(animateCamera)
      else navCubeAnimationRef.current = null
    }
    navCubeAnimationRef.current = requestAnimationFrame(animateCamera)
  }, [])

  const showPivotFeedback = (clientX: number, clientY: number) => {
    const parentRect = containerRef.current?.parentElement?.getBoundingClientRect()
    if (!parentRect) return
    setPivotFeedback({ x: clientX - parentRect.left, y: clientY - parentRect.top, id: Date.now() })
    if (pivotFeedbackTimeoutRef.current !== null) window.clearTimeout(pivotFeedbackTimeoutRef.current)
    pivotFeedbackTimeoutRef.current = window.setTimeout(() => {
      setPivotFeedback(null)
      pivotFeedbackTimeoutRef.current = null
    }, 900)
  }

  const handleDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (toolInput?.isActive?.() ?? false) {
      onDoubleClick?.(event)
      return
    }
    const container = containerRef.current
    const camera = cameraRef.current
    const asset = assetRef.current
    if (!container || !camera || !asset) return
    event.preventDefault()
    const raycaster = buildPointerRay({
      clientX: event.clientX,
      clientY: event.clientY,
    }, camera, container.getBoundingClientRect())
    const intersection = pickScene(raycaster, [asset])
    const nextTarget = intersection?.point.clone()
      ?? new THREE.Box3().setFromObject(asset).getCenter(new THREE.Vector3())
    animatePivotTo(nextTarget)
    if (intersection) showPivotFeedback(event.clientX, event.clientY)
  }

  const handleViewerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (toolInput?.isActive?.() ?? false) return
    const key = event.key.toLowerCase()
    if (key === 'escape') {
      if (probeToolActive) {
        setProbeToolActive(false)
        setProbeResult(null)
        onFieldProbe?.(null)
      }
      if (navCubeAnimationRef.current !== null) cancelAnimationFrame(navCubeAnimationRef.current)
      navCubeAnimationRef.current = null
      inputControllerRef.current?.cancelPointer()
      inputControllerRef.current = null
      setPivotFeedback(null)
      event.preventDefault()
      return
    }
    if (key === 'f') {
      applyCameraCommand('fit')
      event.preventDefault()
      return
    }
    if (key === 'x' || key === 'y' || key === 'z') {
      applyCameraCommand(`${event.shiftKey ? '-' : ''}${key}` as ViewerCameraCommand['type'])
      event.preventDefault()
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !(toolInput?.isActive?.() ?? false)) return
      if (snapCycleRef.current.candidates.length < 2) return
      event.preventDefault()
      snapCycleRef.current = cycleSnapCandidate(snapCycleRef.current, event.shiftKey ? -1 : 1)
      setSnapStatus(snapStatusModel(snapCycleRef.current))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toolInput])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    if (navCubeRef.current?.handlePointerDown(event.nativeEvent)) {
      if (controlsRef.current) controlsRef.current.enabled = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const controlPointIndex = nearestControlPointIndex(
      toolInput?.controlPoints,
      event.clientX,
      event.clientY,
      cameraRef.current,
      containerRef.current?.getBoundingClientRect(),
    )
    if (controlPointIndex !== null && toolInput?.onControlPointChange) {
      draggedControlPointRef.current = { index: controlPointIndex, pointerId: event.pointerId }
      setDraggingControlPoint(controlPointIndex)
      if (controlsRef.current) controlsRef.current.enabled = false
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.button !== 0) return
    const controller = createInputController()
    inputControllerRef.current = controller
    controller.onPointerDown(pointerEvent(event))
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (camera && controls && navCubeRef.current?.handlePointerUp(event.nativeEvent, camera, controls.target)) {
      controls.enabled = true
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const dragged = draggedControlPointRef.current
    if (dragged?.pointerId === event.pointerId) {
      const pick = resolvePointerPick(pointerEvent(event))
      if (pick) {
        toolInput?.onControlPointChange?.(dragged.index, pick)
        toolInput?.onControlPointCommit?.(dragged.index, pick)
      }
      draggedControlPointRef.current = null
      setDraggingControlPoint(null)
      if (controlsRef.current) controlsRef.current.enabled = true
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      event.preventDefault()
      return
    }
    if (event.button !== 0) return
    inputControllerRef.current?.onPointerUp(pointerEvent(event))
    inputControllerRef.current = null
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (navCubeRef.current?.handlePointerMove(event.nativeEvent)) {
      inputControllerRef.current?.onPointerLeave()
      inputControllerRef.current = null
      setHoveredGroup(null)
      event.preventDefault()
      return
    }
    const dragged = draggedControlPointRef.current
    if (dragged?.pointerId === event.pointerId) {
      const pick = resolvePointerPick(pointerEvent(event))
      if (pick) toolInput?.onControlPointChange?.(dragged.index, pick)
      event.preventDefault()
      return
    }
    if (event.buttons !== 0) return
    const controller = inputControllerRef.current ?? createInputController()
    inputControllerRef.current = controller
    controller.onPointerMove(pointerEvent(event))
  }

  const handlePointerLeave = () => {
    navCubeRef.current?.clearHighlight()
    if (draggedControlPointRef.current) return
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
    const timeout = window.setTimeout(() => {
      const count = uvfAssetRef.current ? setFieldFilterOverlay(uvfAssetRef.current, fieldFilter ?? null) : 0
      onFieldFilterMatchCountRef.current?.(count)
    }, fieldFilter?.enabled ? 80 : 0)
    return () => window.clearTimeout(timeout)
  }, [assetState.status, fieldFilter])

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
  const retainingLoadedAsset = shouldKeepPreviousAssetVisible(
    preserveCameraOnAssetChange,
    assetRef.current !== null,
    visibleState.status,
  )
  const viewerReady = visibleState.status === 'ready' || retainingLoadedAsset

  return (
    <div
      className="viewer-3d-container"
      data-viewer-format={manifest?.format ?? ''}
      data-viewer-faces={assetStats?.faces ?? ''}
      data-viewer-edges={assetStats?.edges ?? ''}
      data-viewer-status={visibleState.status}
    >
      <div
        ref={containerRef}
        className={`viewer-3d ${draggingControlPoint !== null ? 'viewer-tool-point-dragging' : ''} ${cameraNavigating ? 'viewer-camera-navigating' : ''} ${probeToolActive ? 'viewer-probe-active' : ''}`}
        onPointerDownCapture={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleViewerKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={() => {
          navCubeRef.current?.handlePointerCancel()
          draggedControlPointRef.current = null
          setDraggingControlPoint(null)
          if (controlsRef.current) controlsRef.current.enabled = true
          inputControllerRef.current?.cancelPointer()
          inputControllerRef.current = null
        }}
        role="img"
        aria-label="3D geometry viewer"
        tabIndex={0}
      />
      {pivotFeedback && (
        <span
          key={pivotFeedback.id}
          className="viewer-pivot-feedback"
          style={{ left: pivotFeedback.x, top: pivotFeedback.y }}
          aria-hidden="true"
        />
      )}
      {visibleState.status === 'loading' && !retainingLoadedAsset && (
        <div className="viewer-overlay viewer-loading" role="status" aria-live="polite">
          <div className="viewer-spinner" />
          <p>{viewerLoadingLabel(visibleState)}</p>
        </div>
      )}
      {visibleState.status === 'error' && (
        <div className="viewer-overlay viewer-error">
          <span className="viewer-error-icon">⚠️</span>
          <p>{visibleState.message}</p>
        </div>
      )}
      {activePrecisionNotice && viewerReady && (
        <div className="viewer-precision-notice" role="status">{activePrecisionNotice}</div>
      )}
      {viewerReady && (
        <>
          <ViewerNavCube onCommand={applyCameraCommand} />
          {(toolbar || assetStats) && (
            <div className="viewer-view-toolbar" role="toolbar" aria-label="Viewer display modes">
              {toolbar}
              {assetStats && (
                <>
                  <ViewerPrecisionControl
                    levels={precisionInfo.levels}
                    currentLevel={precisionInfo.currentLevel}
                    selection={precisionSelection}
                    unavailableLevels={unavailablePrecisionLevels}
                    onChange={(selection) => {
                      setPrecisionNotice({ assetURL: manifest?.asset_url ?? null, message: '' })
                      setPrecision({ assetURL: manifest?.asset_url ?? null, selection })
                    }}
                  />
                  <button
                    type="button"
                    className={`viewer-wireframe-toggle ${effectiveWireframe ? 'active' : ''}`}
                    onClick={handleWireframeToggle}
                    aria-label="Toggle wireframe overlay"
                    aria-pressed={effectiveWireframe}
                    title="Toggle wireframe overlay"
                  >
                    Wire
                  </button>
                </>
              )}
            </div>
          )}
          <div className="viewer-toolbar-slot viewer-action-toolbar-slot" role="toolbar" aria-label="Common viewer actions">
            <button
              className="viewer-top-toolbar-fit viewer-icon-tooltip"
              data-tooltip={t('Fit visible surfaces in the viewport')}
              type="button"
              onClick={() => applyCameraCommand('fit')}
              aria-label={t('Fit visible surfaces')}
            >
              <Focus size={14} /> <span>{t('Fit')}</span>
            </button>
            {displayedFields.length > 0 && (
              <button
                className={`viewer-probe-toggle viewer-icon-tooltip ${probeToolActive ? 'active' : ''}`}
                data-tooltip={selectedField
                  ? t('Click a visible surface to inspect its surface and field value')
                  : t('Select a field before using Probe')}
                type="button"
                onClick={toggleProbeTool}
                disabled={!selectedField}
                aria-label={t('Probe surface and field')}
                aria-pressed={probeToolActive}
              >
                <Crosshair size={14} /> <span>{t('Probe')}</span>
              </button>
            )}
            {topToolbar}
          </div>
        </>
      )}
      {snapStatus && viewerReady && (
        <div className={`viewer-snap-status viewer-snap-status-${snapStatus.mode}`} role="status" aria-live="polite">
          <strong>{snapStatus.label}</strong>
          {snapStatus.candidateCount > 1 && (
            <span>{snapStatus.candidateIndex + 1}/{snapStatus.candidateCount} · Tab cycles · Alt bypasses</span>
          )}
        </div>
      )}
      {probeToolActive && probeResult && viewerReady && (
        <div className="viewer-probe-result" role="status" aria-live="polite">
          <div><span>{t('Surface')}</span><strong>{probeResult.surfaceName}</strong></div>
          <small>{probeResult.surfaceId}</small>
          <div><span>{t('Field')}</span><strong>{probeResult.field?.fieldName ?? selectedField ?? '—'}</strong></div>
          <div><span>{t('Value')}</span><strong>{probeResult.field ? probeResult.field.value.toPrecision(7) : t('Unavailable at this point')}</strong></div>
          <div><span>{t('Position')}</span><strong className="viewer-probe-position">{probeResult.field?.position.map((value) => value.toPrecision(5)).join(', ') ?? '—'}</strong></div>
        </div>
      )}
      {showFieldPanel && displayedFields.length > 0 && viewerReady && (
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
                  <option value="auto">{`Auto (${resolvedFieldScale === 'log' ? 'Log10' : 'Linear'})`}</option>
                  <option value="linear">Linear</option>
                  <option value="log" disabled={!activeField || !canUseLogFieldScale(activeField.min, activeField.max)}>
                    Log10
                  </option>
                </select>
              </label>
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
      {floatingPanel && viewerReady && (
        <div className="viewer-field-panel viewer-floating-panel">
          {floatingPanel}
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
      {showWarnings && manifest?.warnings && manifest.warnings.length > 0 && (
        <div className="viewer-warnings">
          {manifest.warnings.map((w, i) => <span key={i}>{w}</span>)}
        </div>
      )}
    </div>
  )
}

export function precisionFallbackNotice(requestedLevel: number, defaultLevel: number): string {
  return `Detail level L${requestedLevel} is unavailable for this resource. Restored manifest default L${defaultLevel}.`
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

function sameSnapStatus(left: SnapStatusModel | null, right: SnapStatusModel): boolean {
  return left?.mode === right.mode
    && left.label === right.label
    && left.candidateIndex === right.candidateIndex
    && left.candidateCount === right.candidateCount
    && left.confidence === right.confidence
    && left.indicator?.position.join(',') === right.indicator?.position.join(',')
}

function createCadTopologyProvider(asset: THREE.Object3D): CadTopologyProvider {
  let cache: CadTopologyCandidates | null = null
  return {
    candidatesForIntersection: () => {
      if (cache) return cache
      asset.updateWorldMatrix(true, true)
      const vertices: NonNullable<CadTopologyCandidates['vertices']>[number][] = []
      const edges: NonNullable<CadTopologyCandidates['edges']>[number][] = []
      const features: NonNullable<CadTopologyCandidates['features']>[number][] = []
      asset.traverse((object) => {
        const entityId = topologyEntityId(object)
        if (!entityId || object.userData.viewerOverlay === true) return
        if (object instanceof THREE.Points) {
          const position = object.geometry.getAttribute('position')
          for (let index = 0; index < position.count; index += 1) {
            vertices.push({
              id: `${entityId}:vertex:${index}`,
              worldPosition: new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld),
              object,
              visible: object.visible,
            })
          }
        }
        if (object instanceof THREE.Line) {
          const position = object.geometry.getAttribute('position')
          const worldPoints = Array.from({ length: position.count }, (_, index) =>
            new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld))
          if (worldPoints.length > 1) edges.push({ id: entityId, worldPoints, object, visible: object.visible })
        }
        const classification = object.userData.featureClassification
        const confidence = Number(object.userData.featureConfidence)
        if (classification === 'convex' || classification === 'concave' || classification === 'sharp') {
          features.push({
            id: entityId,
            worldPosition: object.getWorldPosition(new THREE.Vector3()),
            classification,
            confidence: Number.isFinite(confidence) ? confidence : 1,
            object,
            visible: object.visible,
          })
        }
      })
      cache = { vertices, edges, features }
      return cache
    },
  }
}

function topologyEntityId(object: THREE.Object3D): string {
  const id = object.userData.entityId ?? object.userData.groupId ?? object.userData.topologyId
  return id === undefined || id === null ? '' : String(id)
}
