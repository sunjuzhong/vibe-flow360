import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { Crosshair, Eye, EyeOff, Focus } from 'lucide-react'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js'
import { DEFAULT_COLORMAP, UVFLoader, applyFieldColoring, applyVectorVisualization, canUseLogFieldScale, createFieldHistogram, createScreenSpaceLIC, fieldCatalogForEntities, findFieldExtrema, formatFieldRange, probeFieldAtIntersection, resolveFieldScale, setEntityVisibility, setFieldFilterOverlay, setWireframeOverlay, updateWireframeOverlayForCamera, wireframeOverlayOpacity, type ColormapName, listColormaps } from '../../lib/uvf-three'
import type { UVFAsset, UVFAssetLRU, UVFEntityInfo, UVFFieldExtrema, UVFFieldFilter, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe, UVFFieldScale, UVFScreenSpaceLIC } from '../../lib/uvf-three'
import {
  configureCFDNavigationControls,
  configurePerspectiveCameraForBounds,
  fitPerspectiveCameraToObject,
  interpolateCameraPivot,
  rotateCameraRigAroundPivot,
  updatePerspectiveCameraClipping,
  zoomCameraRigToAnchor,
} from '../../lib/viewerCamera'
import { useViewerViewport } from '../../hooks/useViewerViewport'
import { adaptiveViewerPixelRatio, createViewerRenderScheduler, type ViewerRenderScheduler } from '../../lib/viewerRenderScheduler'
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
import { normalizeViewerFieldRange, resolveViewerFieldDomain, ViewerFieldRangeControl } from './ViewerFieldRangeControl'
import { viewerLoadingLabel, type ViewerLoadingState } from './viewerLoading'
import { useI18n } from '../../i18n'
import { createParameterEntityGroup, setParameterEntityVisibility, type ParameterEntity } from '../../lib/draftEntities'

export type MeshGroupData = {
  id: string
  name: string
  color: string
  visible: boolean
  triangles?: number
  vertices?: number
  entity_type?: string
  path?: string[]
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
  entity_id_prefix?: string
}

const EMPTY_VIEWER_MANIFESTS: ViewerManifest[] = []
const EMPTY_PARAMETER_ENTITIES: ParameterEntity[] = []
const EMPTY_VISIBILITY: Record<string, boolean> = {}
const EMPTY_ENTITY_APPEARANCES: Record<string, ViewerEntityAppearance> = {}

export function viewerManifestSetKey(manifests: readonly ViewerManifest[]): string {
  return manifests.map((item) => item.asset_url).filter(Boolean).join('|')
}

export function mergeViewerManifestMetadata(manifests: readonly ViewerManifest[]): ViewerManifest | null {
  const primary = manifests[0]
  if (!primary) return null
  const bounds = manifests.reduce((combined, item) => ({
    min: combined.min.map((value, index) => Math.min(value, item.bounding_box.min[index])) as [number, number, number],
    max: combined.max.map((value, index) => Math.max(value, item.bounding_box.max[index])) as [number, number, number],
  }), primary.bounding_box)
  return {
    ...primary,
    asset_url: viewerManifestSetKey(manifests),
    bounding_box: bounds,
    groups: manifests.flatMap((item) => item.groups),
    edges: manifests.flatMap((item) => item.edges ?? []),
    vertices: manifests.reduce((total, item) => total + item.vertices, 0),
    elements: manifests.reduce((total, item) => total + item.elements, 0),
    warnings: manifests.flatMap((item) => item.warnings ?? []),
  }
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

export type ViewerCameraState = {
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  zoom: number
}

export function captureViewerCameraState(camera: THREE.PerspectiveCamera, target: THREE.Vector3): ViewerCameraState {
  return {
    position: camera.position.toArray(),
    target: target.toArray(),
    up: camera.up.toArray(),
    zoom: camera.zoom,
  }
}

export function applyViewerCameraState(camera: THREE.PerspectiveCamera, target: THREE.Vector3, state: ViewerCameraState) {
  camera.position.fromArray(state.position)
  camera.up.fromArray(state.up)
  camera.zoom = state.zoom
  camera.updateProjectionMatrix()
  target.fromArray(state.target)
  camera.lookAt(target)
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

export type ViewerFieldPanelContext = {
  field: UVFFieldInfo | undefined
  range: [number, number] | null
}

export function shouldKeepPreviousAssetVisible(
  preserveCameraOnAssetChange: boolean,
  hasLoadedAsset: boolean,
  status: ViewerState['status'],
) {
  return preserveCameraOnAssetChange && hasLoadedAsset && status === 'loading'
}

type Props = {
  manifest: ViewerManifest | null
  additionalManifests?: ViewerManifest[]
  state: ViewerState
  onSelectionChange?: (selection: ViewerSelection) => void
  selection?: ViewerSelection
  entityVisibility?: Record<string, boolean>
  onEntityVisibilityChange?: (visibility: Record<string, boolean>) => void
  parameterEntities?: ParameterEntity[]
  parameterEntityVisibility?: Record<string, boolean>
  wireframe?: boolean
  onWireframeChange?: (wireframe: boolean) => void
  onFieldsDiscovered?: (fields: UVFFieldInfo[]) => void
  onEntitiesDiscovered?: (entities: UVFEntityInfo[]) => void
  selectedField?: string | null
  onSelectedFieldChange?: (field: string | null) => void
  fieldNames?: string[]
  fieldEntityIds?: string[]
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
  fieldPanelExtra?: React.ReactNode | ((context: ViewerFieldPanelContext) => React.ReactNode)
  showVectorControls?: boolean
  showEntityLegend?: boolean
  showWarnings?: boolean
  toolbar?: React.ReactNode
  topToolbar?: React.ReactNode
  floatingPanel?: React.ReactNode
  cameraCommand?: ViewerCameraCommand | null
  cameraState?: ViewerCameraState | null
  onCameraStateChange?: (state: ViewerCameraState) => void
  showNormals?: boolean
  entityAppearances?: Record<string, ViewerEntityAppearance>
  preserveCameraOnAssetChange?: boolean
  uvfAssetCache?: UVFAssetLRU
  onAssetReady?: (assetURL: string) => void
  fitSelectionWhenSelected?: boolean
}

export function Viewer3D({
  manifest,
  additionalManifests = EMPTY_VIEWER_MANIFESTS,
  state,
  onSelectionChange,
  selection,
  entityVisibility,
  onEntityVisibilityChange,
  parameterEntities = EMPTY_PARAMETER_ENTITIES,
  parameterEntityVisibility = EMPTY_VISIBILITY,
  wireframe,
  onWireframeChange,
  onFieldsDiscovered,
  onEntitiesDiscovered,
  selectedField: controlledSelectedField,
  onSelectedFieldChange,
  fieldNames,
  fieldEntityIds,
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
  fieldPanelExtra,
  showVectorControls = false,
  showEntityLegend = true,
  showWarnings = true,
  toolbar,
  topToolbar,
  floatingPanel,
  cameraCommand,
  cameraState,
  onCameraStateChange,
  showNormals = false,
  entityAppearances = EMPTY_ENTITY_APPEARANCES,
  preserveCameraOnAssetChange = false,
  uvfAssetCache,
  onAssetReady,
  fitSelectionWhenSelected = false,
}: Props) {
  const { t } = useI18n()
  const activeManifests = useMemo(
    () => manifest ? [manifest, ...additionalManifests.filter((item) => item.asset_url !== manifest.asset_url)] : [],
    [additionalManifests, manifest],
  )
  const displayManifest = useMemo(() => mergeViewerManifestMetadata(activeManifests), [activeManifests])
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const renderSchedulerRef = useRef<ViewerRenderScheduler | null>(null)
  const assetBoundsSphereRef = useRef<THREE.Sphere | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const assetRef = useRef<THREE.Object3D | null>(null)
  const parameterEntityGroupRef = useRef<THREE.Group | null>(null)
  const loadedAssetURLRef = useRef<string | null>(null)
  const assetDisposeRef = useRef<(() => void) | null>(null)
  const uvfAssetRef = useRef<UVFAsset | null>(null)
  const licRendererRef = useRef<UVFScreenSpaceLIC | null>(null)
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
  const wheelNavigationTimeoutRef = useRef<number | null>(null)
  const wheelAnchorRef = useRef<THREE.Vector3 | null>(null)
  const lastSurfacePivotRef = useRef<THREE.Vector3 | null>(null)
  const navigationDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    lastX: number
    lastY: number
    pivot: THREE.Vector3
    surface: boolean
    moved: boolean
  } | null>(null)
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)
  const [snapStatus, setSnapStatus] = useState<SnapStatusModel | null>(null)
  const [draggingControlPoint, setDraggingControlPoint] = useState<number | null>(null)
  const [cameraNavigating, setCameraNavigating] = useState(false)
  const cameraNavigatingRef = useRef(false)
  const applyingCameraStateRef = useRef(false)
  const cameraStateTimeoutRef = useRef<number | null>(null)
  const lastCameraStateEmissionRef = useRef(0)
  const onCameraStateChangeRef = useRef(onCameraStateChange)
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
  const [colormap, setColormap] = useState<ColormapName>(DEFAULT_COLORMAP)
  const [fieldScale, setFieldScale] = useState<UVFFieldScale>('auto')
  const [vectorLICEnabled, setVectorLICEnabled] = useState(false)
  const [vectorArrowsEnabled, setVectorArrowsEnabled] = useState(false)
  const [vectorArrowDensity, setVectorArrowDensity] = useState<'sparse' | 'standard' | 'dense'>('standard')
  const [fieldRangeOverride, setFieldRangeOverride] = useState<{ key: string; range: [number, number] } | null>(null)
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
  const onEntitiesDiscoveredRef = useRef(onEntitiesDiscovered)
  const onAssetReadyRef = useRef(onAssetReady)
  const onFieldHistogramChangeRef = useRef(onFieldHistogramChange)
  const onFieldExtremaChangeRef = useRef(onFieldExtremaChange)
  const onFieldFilterMatchCountRef = useRef(onFieldFilterMatchCount)
  const onCaptureRef = useRef(onCapture)
  const selectedField = controlledSelectedField === undefined
    ? internalSelectedField
    : controlledSelectedField
  const invalidateViewer = useCallback(() => renderSchedulerRef.current?.invalidate(), [])

  useEffect(() => {
    onCameraStateChangeRef.current = onCameraStateChange
  }, [onCameraStateChange])

  const emitCameraState = useCallback(() => {
    cameraStateTimeoutRef.current = null
    if (applyingCameraStateRef.current) return
    const callback = onCameraStateChangeRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!callback || !camera || !controls) return
    lastCameraStateEmissionRef.current = performance.now()
    callback(captureViewerCameraState(camera, controls.target))
  }, [])

  const scheduleCameraState = useCallback((immediate = false) => {
    if (!onCameraStateChangeRef.current || applyingCameraStateRef.current) return
    if (immediate) {
      if (cameraStateTimeoutRef.current !== null) window.clearTimeout(cameraStateTimeoutRef.current)
      emitCameraState()
      return
    }
    if (cameraStateTimeoutRef.current !== null) return
    const elapsed = performance.now() - lastCameraStateEmissionRef.current
    cameraStateTimeoutRef.current = window.setTimeout(emitCameraState, Math.max(0, 33 - elapsed))
  }, [emitCameraState])
  const fieldEntityScopeKey = fieldEntityIds?.join('\u0000') ?? ''
  const scopedFields = useMemo(() => {
    const asset = uvfAssetRef.current
    return asset ? fieldCatalogForEntities(asset, fieldEntityIds) : availableFields
  // The stable key prevents a parent-created array from recalculating field data on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetState.status, availableFields, fieldEntityScopeKey])
  const displayedFields = fieldNames
    ? scopedFields.filter((field) => fieldNames.includes(field.name))
    : scopedFields
  const activeField = displayedFields.find((field) => field.name === selectedField)
  const fieldDomain = useMemo(
    () => activeField ? resolveViewerFieldDomain(fieldRange, activeField.min, activeField.max) : null,
    [activeField, fieldRange],
  )
  const resolvedFieldScale = activeField
    ? resolveFieldScale(fieldScale, fieldDomain![0], fieldDomain![1])
    : 'linear'
  const baseFieldRange = useMemo(
    () => fieldDomain ? normalizeViewerFieldRange(fieldRange, fieldDomain[0], fieldDomain[1]) : null,
    [fieldDomain, fieldRange],
  )
  const fieldRangeKey = activeField && baseFieldRange
    ? `${activeField.name}|${baseFieldRange[0]}|${baseFieldRange[1]}`
    : ''
  const activeColorRange = useMemo(() => activeField && baseFieldRange && fieldDomain
    ? fieldRangeOverride?.key === fieldRangeKey
      ? normalizeViewerFieldRange(fieldRangeOverride.range, fieldDomain[0], fieldDomain[1])
      : baseFieldRange
    : null, [activeField, baseFieldRange, fieldDomain, fieldRangeKey, fieldRangeOverride])
  const effectiveWireframe = wireframe ?? wireframeOn
  const vectorArrowLimit = vectorArrowDensity === 'sparse' ? 120 : vectorArrowDensity === 'dense' ? 480 : 260
  const framePresentationRef = useRef({ selectedField, colormap, fieldRange: activeColorRange, fieldScale, fieldEntityIds, wireframe: effectiveWireframe, vectorLICEnabled, vectorArrowsEnabled, vectorArrowLimit })
  framePresentationRef.current = { selectedField, colormap, fieldRange: activeColorRange, fieldScale, fieldEntityIds, wireframe: effectiveWireframe, vectorLICEnabled, vectorArrowsEnabled, vectorArrowLimit }
  const precisionSelection = precision.assetURL === displayManifest?.asset_url ? precision.selection : 'default'
  const requestedLODLevel = precisionSelection === 'default' ? undefined : precisionSelection
  const unavailablePrecisionLevels = new Set(
    unavailablePrecision.assetURL === displayManifest?.asset_url ? unavailablePrecision.levels : [],
  )
  const activePrecisionNotice = precisionNotice.assetURL === displayManifest?.asset_url ? precisionNotice.message : ''
  const activeResourceRef = useMemo<ResourceRef | null>(() => {
    if (resourceRef) return resourceRef
    if (!manifest?.asset_url) return null
    return { id: manifest.asset_url, type: manifest.format || 'viewer-asset' }
  }, [manifest?.asset_url, manifest?.format, resourceRef])
  const fitTargetsSelection = fitSelectionWhenSelected && Boolean(selection?.groupId)
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
    ...(displayManifest?.groups ?? []).map((group) => [group.id, group.visible] as const),
    ...(displayManifest?.edges ?? []).map((edge) => [edge.id, true] as const),
  ], [displayManifest])
  const effectiveGroupVisibility = Object.fromEntries(
    manifestEntityVisibility.map(([entityId, defaultVisible]) => [
      entityId,
      entityVisibility?.[entityId] ?? groupVisibility[entityId] ?? defaultVisible,
    ]),
  )

  useEffect(() => {
    onFieldsDiscoveredRef.current = onFieldsDiscovered
    onEntitiesDiscoveredRef.current = onEntitiesDiscovered
    onFieldHistogramChangeRef.current = onFieldHistogramChange
    onFieldExtremaChangeRef.current = onFieldExtremaChange
    onFieldFilterMatchCountRef.current = onFieldFilterMatchCount
    onCaptureRef.current = onCapture
    onAssetReadyRef.current = onAssetReady
  }, [onAssetReady, onCapture, onEntitiesDiscovered, onFieldExtremaChange, onFieldFilterMatchCount, onFieldHistogramChange, onFieldsDiscovered])

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

  useEffect(() => {
    if (!selectedField || activeField || assetState.status !== 'ready') return
    if (controlledSelectedField === undefined) setInternalSelectedField(null)
    onSelectedFieldChange?.(null)
    setProbeToolActive(false)
    setProbeResult(null)
    onFieldProbe?.(null)
  }, [activeField, assetState.status, controlledSelectedField, onFieldProbe, onSelectedFieldChange, selectedField])

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
    if (fit) lastSurfacePivotRef.current = fit.center.clone()
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false })
    renderer.localClippingEnabled = true
    renderer.setSize(width, height, false)
    const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number }
    renderer.setPixelRatio(adaptiveViewerPixelRatio(
      window.devicePixelRatio,
      navigator.hardwareConcurrency,
      navigatorWithMemory.deviceMemory,
    ))
    container.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    configureCFDNavigationControls(controls)
    controls.addEventListener('change', () => {
      renderSchedulerRef.current?.invalidate()
      scheduleCameraState()
    })
    controls.addEventListener('start', () => {
      cameraNavigatingRef.current = true
      setCameraNavigating(true)
    })
    controls.addEventListener('end', () => {
      cameraNavigatingRef.current = false
      setCameraNavigating(false)
      scheduleCameraState(true)
    })

    scene.add(createEngineeringLightRig())

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    controlsRef.current = controls

    return { scene, camera, renderer }
  }, [scheduleCameraState])

  const updateGeometry = useCallback(async (
    manifests: ViewerManifest[],
    signal: AbortSignal,
    onProgress: (progress: number) => void,
    lodLevel?: number,
    preserveCamera = false,
  ) => {
    const scene = sceneRef.current
    if (!scene) return

    const previousRoot = assetRef.current
    const previousParameterGroup = parameterEntityGroupRef.current
    const previousDispose = assetDisposeRef.current
    const retainPrevious = preserveCamera && previousRoot !== null
    if (!retainPrevious) {
      previousDispose?.()
      assetDisposeRef.current = null
      uvfAssetRef.current = null
      meshesRef.current.clear()
      if (previousRoot) scene.remove(previousRoot)
      if (previousParameterGroup) scene.remove(previousParameterGroup)
      assetRef.current = null
      parameterEntityGroupRef.current = null
      setAssetStats(null)
      assetBoundsSphereRef.current = null
      setAvailableFields([])
      onEntitiesDiscoveredRef.current?.([])
      setInternalSelectedField(null)
    }

    const loadableManifests = manifests.filter((item) => item.asset_url)
    if (!loadableManifests.length) return
    const root = new THREE.Group()
    root.name = 'Viewer asset layers'
    const disposers: Array<() => void> = []
    const uvfAssets: UVFAsset[] = []
    const uvfAssetPrefixes = new Map<UVFAsset, string>()
    let nextDispose: (() => void) | null = () => disposers.forEach((dispose) => dispose())
    let nextUVFAsset: UVFAsset | null = null
    let nextAssetStats: ViewerAssetStats | null = { faces: 0, edges: 0, triangles: 0 }
    let nextPrecisionInfo = { levels: 1, currentLevel: 0 }
    const nextFieldMap = new Map<string, UVFFieldInfo>()
    const nextMeshes = new Map<string, THREE.Mesh>()
    try {
      for (let manifestIndex = 0; manifestIndex < loadableManifests.length; manifestIndex += 1) {
        const layerManifest = loadableManifests[manifestIndex]
        let layerRoot: THREE.Object3D
        if (layerManifest.format === 'flow360-uvf') {
          const asset = await (uvfAssetCache
            ? uvfAssetCache.acquire(layerManifest.asset_url, {
              signal,
              onProgress: ({ progress }) => onProgress((manifestIndex + progress) / loadableManifests.length),
            })
            : new UVFLoader().load(layerManifest.asset_url, {
              signal,
              lodLevel,
              onProgress: ({ progress }) => onProgress((manifestIndex + progress) / loadableManifests.length),
            }))
          const disposeAsset = uvfAssetCache
            ? () => uvfAssetCache.release(layerManifest.asset_url)
            : asset.dispose
          disposers.push(disposeAsset)
          if (signal.aborted) throw new DOMException('Viewer asset load was aborted', 'AbortError')
          layerRoot = asset.object
          uvfAssets.push(asset)
          uvfAssetPrefixes.set(asset, layerManifest.entity_id_prefix ?? '')
          nextAssetStats.faces += asset.faces
          nextAssetStats.edges += asset.edges
          nextAssetStats.triangles += asset.triangles
          const levels = commonPrecisionLevels(asset.entityLODs)
          nextPrecisionInfo = {
            levels: uvfAssets.length === 1 ? levels : Math.min(nextPrecisionInfo.levels, levels),
            currentLevel: Math.min(nextPrecisionInfo.currentLevel, asset.currentLOD),
          }
          for (const field of asset.fields) {
            const previous = nextFieldMap.get(field.name)
            nextFieldMap.set(field.name, previous
              ? { ...previous, min: Math.min(previous.min, field.min), max: Math.max(previous.max, field.max) }
              : field)
          }
        } else {
          const gltf = await new GLTFLoader().loadAsync(layerManifest.asset_url)
          if (signal.aborted) {
            disposeObject(gltf.scene)
            throw new DOMException('Viewer asset load was aborted', 'AbortError')
          }
          layerRoot = gltf.scene
          disposers.push(() => disposeObject(layerRoot))
        }
        const fallbackGroup = layerManifest.groups[0]
        layerRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return
          const embeddedEntityID = String(object.userData.entityId ?? object.userData.groupId ?? '')
          const embeddedGroupID = embeddedEntityID
            ? `${layerManifest.entity_id_prefix ?? ''}${embeddedEntityID}`
            : ''
          const group = layerManifest.groups.find((candidate) => candidate.id === embeddedGroupID)
            ?? layerManifest.groups.find((candidate) => object.name.toLowerCase().includes(candidate.name.toLowerCase()))
            ?? fallbackGroup
          const groupId = group?.id ?? embeddedGroupID ?? object.uuid
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
        root.add(layerRoot)
      }
    } catch (cause) {
      disposers.forEach((dispose) => dispose())
      throw cause
    }
    const nextFields = [...nextFieldMap.values()].sort((left, right) => left.name.localeCompare(right.name))
    if (uvfAssets.length) {
      nextUVFAsset = {
        object: root,
        faces: nextAssetStats.faces,
        edges: nextAssetStats.edges,
        vertices: uvfAssets.reduce((total, asset) => total + asset.vertices, 0),
        triangles: nextAssetStats.triangles,
        fields: nextFields,
        lodLevels: nextPrecisionInfo.levels,
        currentLOD: nextPrecisionInfo.currentLevel,
        entityLODs: Object.fromEntries(uvfAssets.flatMap((asset) => {
          const prefix = uvfAssetPrefixes.get(asset) ?? ''
          return Object.entries(asset.entityLODs).map(([entityId, info]) => [`${prefix}${entityId}`, info])
        })),
        entities: uvfAssets.flatMap((asset) => {
          const prefix = uvfAssetPrefixes.get(asset) ?? ''
          return asset.entities.map((entity) => ({
            ...entity,
            id: `${prefix}${entity.id}`,
            parentId: entity.parentId ? `${prefix}${entity.parentId}` : null,
            children: entity.children.map((child) => `${prefix}${child}`),
          }))
        }),
        getEntityObject: (entityId) => {
          for (const asset of uvfAssets) {
            const prefix = uvfAssetPrefixes.get(asset) ?? ''
            if (!prefix || entityId.startsWith(prefix)) {
              const object = asset.getEntityObject(prefix ? entityId.slice(prefix.length) : entityId)
              if (object) return object
            }
          }
          return undefined
        },
        dispose: () => disposers.forEach((dispose) => dispose()),
      }
    }
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
    let nextParameterGroup: THREE.Group | null = null
    if (parameterEntities.length) {
      const sourceBounds = new THREE.Box3(
        new THREE.Vector3(...displayManifest!.bounding_box.min),
        new THREE.Vector3(...displayManifest!.bounding_box.max),
      )
      nextParameterGroup = createParameterEntityGroup(parameterEntities, sourceBounds)
      nextParameterGroup.position.copy(root.position)
      nextParameterGroup.quaternion.copy(root.quaternion)
      nextParameterGroup.scale.copy(root.scale)
      disposers.push(() => disposeObject(nextParameterGroup!))
    }
    if (nextUVFAsset) {
      const presentation = framePresentationRef.current
      const nextField = nextFields.find((field) => field.name === presentation.selectedField)
      applyFieldColoring(nextUVFAsset, presentation.selectedField, presentation.colormap, {
        range: presentation.fieldRange,
        entityIds: presentation.fieldEntityIds,
        scale: nextField
          ? resolveFieldScale(presentation.fieldScale, nextField.min, nextField.max)
          : 'linear',
      })
      applyVectorVisualization(nextUVFAsset, presentation.selectedField, {
        lic: presentation.vectorLICEnabled,
        arrows: presentation.vectorArrowsEnabled,
        entityIds: presentation.fieldEntityIds,
        maxArrows: presentation.vectorArrowLimit,
      })
      setWireframeOverlay(nextUVFAsset, presentation.wireframe)
    }
    if (retainPrevious && previousRoot) {
      scene.remove(previousRoot)
      if (previousParameterGroup) scene.remove(previousParameterGroup)
      previousDispose?.()
    }
    scene.add(root)
    if (nextParameterGroup) scene.add(nextParameterGroup)
    assetRef.current = root
    parameterEntityGroupRef.current = nextParameterGroup
    assetDisposeRef.current = nextDispose
    uvfAssetRef.current = nextUVFAsset
    meshesRef.current = nextMeshes
    setAssetStats(nextAssetStats)
    setPrecisionInfo(nextPrecisionInfo)
    setAvailableFields(nextFields)
    onFieldsDiscoveredRef.current?.(nextFields)
    onEntitiesDiscoveredRef.current?.(nextUVFAsset?.entities ?? [])
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
  }, [displayManifest, fitCameraToObject, parameterEntities, uvfAssetCache])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { renderer, scene } = createScene(container)
    const navCube = new ViewerNavCubeController(renderer, navigateFromNavCube)
    navCubeRef.current = navCube
    const annotationOverlay = new ViewerOverlayLayer(scene, { layer: VIEWER_OVERLAY_LAYER })
    annotationOverlayRef.current = annotationOverlay

    const scheduler = createViewerRenderScheduler(() => {
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
        licRendererRef.current?.update(
          renderer,
          camera,
          renderer.domElement.width,
          renderer.domElement.height,
          cameraNavigatingRef.current,
        )
        renderer.render(scene, camera)
        licRendererRef.current?.composite(renderer)
        navCube.update(camera, controls?.target ?? new THREE.Vector3())
        navCube.renderOverlay()
      }
    })
    renderSchedulerRef.current = scheduler
    scheduler.invalidate()

    return () => {
      scheduler.dispose()
      if (renderSchedulerRef.current === scheduler) renderSchedulerRef.current = null
      if (cameraStateTimeoutRef.current !== null) window.clearTimeout(cameraStateTimeoutRef.current)
      cameraStateTimeoutRef.current = null
      if (navCubeAnimationRef.current !== null) cancelAnimationFrame(navCubeAnimationRef.current)
      navCubeAnimationRef.current = null
      if (pivotFeedbackTimeoutRef.current !== null) window.clearTimeout(pivotFeedbackTimeoutRef.current)
      pivotFeedbackTimeoutRef.current = null
      if (wheelNavigationTimeoutRef.current !== null) window.clearTimeout(wheelNavigationTimeoutRef.current)
      wheelNavigationTimeoutRef.current = null
      wheelAnchorRef.current = null
      navigationDragRef.current = null
      navCube.dispose()
      if (navCubeRef.current === navCube) navCubeRef.current = null
      annotationOverlay.dispose()
      if (annotationOverlayRef.current === annotationOverlay) annotationOverlayRef.current = null
      inputControllerRef.current = null
      renderer.dispose()
      licRendererRef.current?.dispose()
      licRendererRef.current = null
      controlsRef.current?.dispose()
      assetDisposeRef.current?.()
      assetDisposeRef.current = null
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement)
      }
    }
  }, [createScene, navigateFromNavCube])

  // React state and prop changes may mutate materials, visibility, overlays, or
  // tools. Coalesce them into a single frame instead of maintaining an idle loop.
  useEffect(() => invalidateViewer(), [
    activeColorRange,
    assetState.status,
    clipPlane,
    colormap,
    effectiveWireframe,
    entityAppearances,
    entityVisibility,
    fieldEntityScopeKey,
    fieldFilter,
    groupVisibility,
    hoveredGroup,
    invalidateViewer,
    overlays,
    parameterEntityVisibility,
    resolvedFieldScale,
    selectedField,
    showNormals,
    snapStatus,
    vectorArrowsEnabled,
    vectorArrowLimit,
    vectorLICEnabled,
  ])

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

  useEffect(() => {
    if (!cameraState || assetState.status !== 'ready') return
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls) return
    if (cameraStateTimeoutRef.current !== null) window.clearTimeout(cameraStateTimeoutRef.current)
    cameraStateTimeoutRef.current = null
    applyingCameraStateRef.current = true
    applyViewerCameraState(camera, controls.target, cameraState)
    controls.update()
    applyingCameraStateRef.current = false
  }, [assetState.status, cameraState])

  useViewerViewport({
    containerRef,
    rendererRef,
    cameraRef,
    onResize: fitAssetToViewport,
  })

  useEffect(() => {
    if (displayManifest && activeManifests.length && state.status === 'ready') {
      const controller = new AbortController()
      const preserveCamera = assetRef.current !== null && (
        loadedAssetURLRef.current === displayManifest.asset_url || preserveCameraOnAssetChange
      )
      setAssetState({ status: 'loading', message: 'Loading 3D resources…' })
      void updateGeometry(
        activeManifests,
        controller.signal,
        (progress) => setAssetState({ status: 'loading', message: 'Loading 3D resources…', progress }),
        requestedLODLevel,
        preserveCamera,
      )
        .then(() => {
          if (!controller.signal.aborted) {
            loadedAssetURLRef.current = displayManifest.asset_url
            onAssetReadyRef.current?.(displayManifest.asset_url)
            if (requestedLODLevel !== undefined) setPrecisionNotice({ assetURL: displayManifest.asset_url, message: '' })
            setAssetState({ status: 'ready' })
          }
        })
        .catch((cause) => {
          if (controller.signal.aborted) return
          if (requestedLODLevel !== undefined) {
            setUnavailablePrecision((current) => ({
              assetURL: displayManifest.asset_url,
              levels: current.assetURL === displayManifest.asset_url
                ? [...new Set([...current.levels, requestedLODLevel])]
                : [requestedLODLevel],
            }))
            setPrecision({ assetURL: displayManifest.asset_url, selection: 'default' })
            setPrecisionNotice({
              assetURL: displayManifest.asset_url,
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
  }, [activeManifests, displayManifest, preserveCameraOnAssetChange, requestedLODLevel, state.status, updateGeometry])

  useEffect(() => {
    if (!selection) return
    const selectedIds = new Set(selection.groupIds?.length ? selection.groupIds : [selection.groupId])
    for (const [, mesh] of meshesRef.current) {
      const groupId = String(mesh.userData.groupId ?? '')
      const mat = mesh.material as THREE.MeshPhongMaterial | THREE.MeshBasicMaterial
      const appearance = entityAppearances[groupId]
      const defaultColor = displayManifest?.groups.find((group) => group.id === groupId)?.color ?? '#6f8790'
      const style = resolveViewerMaterialStyle(
        defaultColor,
        appearance,
        selectedIds.has(groupId),
        effectiveGroupVisibility[groupId] !== false,
      )
      mat.color.set(mat.vertexColors ? 0xffffff : style.color)
      mat.opacity = style.opacity
      mat.transparent = style.opacity < 1
      mat.depthWrite = style.opacity >= 1
      if (mat instanceof THREE.MeshPhongMaterial) {
        mat.emissive.set(style.emissive)
        mat.emissiveIntensity = style.emissiveIntensity
      }
      mat.needsUpdate = true
    }
    const asset = uvfAssetRef.current
    if (!asset) return
    asset.object.traverse((object) => {
      if (object.userData.parameterEntity === true) return
      if (!(object instanceof THREE.Line) && object.userData.uvfWireframeOverlay !== true) return
      if (object.userData.uvfFieldFilterOverlay === true) return
      if (object.userData.uvfVectorVisualizationOverlay === true) return
      if (object.userData.uvfWireframeOverlay === true) object.userData.uvfWireframeSelected = false
      const lineObject = object as THREE.Object3D & { material: THREE.Material | THREE.Material[] }
      const materials = Array.isArray(lineObject.material) ? lineObject.material : [lineObject.material]
      materials.forEach((material) => {
        const lineMaterial = material as THREE.LineBasicMaterial
        if (!(lineMaterial.color instanceof THREE.Color)) return
        lineMaterial.color.set(0x30352d)
        material.opacity = wireframeOverlayOpacity(object) ?? 0.72
        material.needsUpdate = true
      })
    })
    asset.getEntityObject(selection.groupId ?? '')?.traverse((object) => {
      if (!(object instanceof THREE.Line) && object.userData.uvfWireframeOverlay !== true) return
      if (object.userData.uvfFieldFilterOverlay === true) return
      if (object.userData.uvfVectorVisualizationOverlay === true) return
      if (object.userData.uvfWireframeOverlay === true) object.userData.uvfWireframeSelected = true
      const lineObject = object as THREE.Object3D & { material: THREE.Material | THREE.Material[] }
      const materials = Array.isArray(lineObject.material) ? lineObject.material : [lineObject.material]
      materials.forEach((material) => {
        const lineMaterial = material as THREE.LineBasicMaterial
        if (!(lineMaterial.color instanceof THREE.Color)) return
        lineMaterial.color.set(0xd59a2d)
        material.opacity = wireframeOverlayOpacity(object, true) ?? 1
        material.needsUpdate = true
      })
    })
  }, [assetState.status, selection, displayManifest, entityVisibility, groupVisibility, entityAppearances])

  useEffect(() => {
    if (!displayManifest) return
    const entityIds = [
      ...displayManifest.groups.map((group) => group.id),
      ...(displayManifest.edges ?? []).map((edge) => edge.id),
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
  }, [assetState.status, displayManifest, entityVisibility, groupVisibility])

  useEffect(() => {
    setParameterEntityVisibility(parameterEntityGroupRef.current, parameterEntityVisibility)
  }, [assetState.status, parameterEntityVisibility])

  useEffect(() => {
    const clipping = clipPlane
      ? [new THREE.Plane(new THREE.Vector3(...clipPlane.normal).normalize(), clipPlane.constant)]
      : []
    const applyClipping = (root: THREE.Object3D | null) => root?.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        material.clippingPlanes = clipping
        material.clipShadows = clipping.length > 0
        material.needsUpdate = true
      })
    })
    applyClipping(assetRef.current)
    applyClipping(parameterEntityGroupRef.current)
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
    licRendererRef.current?.update(renderer, camera, renderer.domElement.width, renderer.domElement.height)
    renderer.render(scene, camera)
    licRendererRef.current?.composite(renderer)
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
          const meshGroupId = String(mesh.userData.groupId ?? mesh.userData.entityId ?? '')
          if (fieldEntityIds?.length && !fieldEntityIds.includes(meshGroupId)) return false
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

  const setNavigationActive = useCallback((active: boolean) => {
    cameraNavigatingRef.current = active
    setCameraNavigating(active)
    if (!active) scheduleCameraState(true)
  }, [scheduleCameraState])

  const cancelViewerInteraction = useCallback((pointerId?: number) => {
    const container = containerRef.current
    const navigationPointer = navigationDragRef.current?.pointerId
    const toolPointer = draggedControlPointRef.current?.pointerId
    if (pointerId === undefined || navigationPointer === pointerId) navigationDragRef.current = null
    if (pointerId === undefined || toolPointer === pointerId) {
      draggedControlPointRef.current = null
      setDraggingControlPoint(null)
    }
    for (const capturedPointer of [navigationPointer, toolPointer]) {
      if (capturedPointer === undefined || (pointerId !== undefined && capturedPointer !== pointerId)) continue
      if (container?.hasPointerCapture(capturedPointer)) container.releasePointerCapture(capturedPointer)
    }
    navCubeRef.current?.handlePointerCancel()
    inputControllerRef.current?.cancelPointer()
    inputControllerRef.current = null
    if (controlsRef.current) controlsRef.current.enabled = true
    setNavigationActive(false)
  }, [setNavigationActive])

  const pointerNavigationAnchor = useCallback((
    clientX: number,
    clientY: number,
    blankAtPointerDepth: boolean,
  ): { point: THREE.Vector3; surface: boolean } | null => {
    const container = containerRef.current
    const camera = cameraRef.current
    const controls = controlsRef.current
    const asset = assetRef.current
    if (!container || !camera || !controls || !asset) return null
    const raycaster = buildPointerRay({ clientX, clientY }, camera, container.getBoundingClientRect())
    const intersection = pickScene(raycaster, [asset])
    if (intersection) {
      lastSurfacePivotRef.current = intersection.point.clone()
      return { point: intersection.point.clone(), surface: true }
    }
    if (!blankAtPointerDepth) return { point: controls.target.clone(), surface: false }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()),
      controls.target,
    )
    return {
      point: raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? controls.target.clone(),
      surface: false,
    }
  }, [])

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
    if (intersection) lastSurfacePivotRef.current = intersection.point.clone()
    const nextTarget = intersection?.point.clone()
      ?? lastSurfacePivotRef.current?.clone()
      ?? controlsRef.current?.target.clone()
    if (!nextTarget) return
    animatePivotTo(nextTarget)
    if (intersection) showPivotFeedback(event.clientX, event.clientY)
  }

  const handleViewerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key.toLowerCase()
    if (key === 'escape') {
      if (probeToolActive) {
        setProbeToolActive(false)
        setProbeResult(null)
        onFieldProbe?.(null)
      }
      if (navCubeAnimationRef.current !== null) cancelAnimationFrame(navCubeAnimationRef.current)
      navCubeAnimationRef.current = null
      cancelViewerInteraction()
      setPivotFeedback(null)
      event.preventDefault()
      return
    }
    if (toolInput?.isActive?.() ?? false) return
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

  useEffect(() => {
    const handleWindowBlur = () => cancelViewerInteraction()
    window.addEventListener('blur', handleWindowBlur)
    return () => window.removeEventListener('blur', handleWindowBlur)
  }, [cancelViewerInteraction])

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.focus({ preventScroll: true })
    if (navCubeRef.current?.handlePointerDown(event.nativeEvent)) {
      if (controlsRef.current) controlsRef.current.enabled = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const toolIsActive = toolInput?.isActive?.() ?? false
    const controlPointIndex = toolIsActive
      ? nearestControlPointIndex(
        toolInput?.controlPoints,
        event.clientX,
        event.clientY,
        cameraRef.current,
        containerRef.current?.getBoundingClientRect(),
      )
      : null
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
    if (event.pointerType !== 'touch') {
      const anchor = pointerNavigationAnchor(event.clientX, event.clientY, false)
      const controls = controlsRef.current
      if (anchor && controls) {
        navigationDragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          lastX: event.clientX,
          lastY: event.clientY,
          pivot: anchor.point,
          surface: anchor.surface,
          moved: false,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }
    }
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
    const navigation = navigationDragRef.current
    if (navigation?.pointerId === event.pointerId) {
      navigationDragRef.current = null
      if (navigation.moved) setNavigationActive(false)
      inputControllerRef.current?.onPointerUp(pointerEvent(event))
      inputControllerRef.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
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
    const navigation = navigationDragRef.current
    if (navigation?.pointerId === event.pointerId) {
      if ((event.buttons & 1) === 0) {
        cancelViewerInteraction(event.pointerId)
        return
      }
      const camera = cameraRef.current
      const controls = controlsRef.current
      const container = containerRef.current
      if (!camera || !controls || !container) return
      const dx = event.clientX - navigation.lastX
      const dy = event.clientY - navigation.lastY
      inputControllerRef.current?.onPointerMove(pointerEvent(event))
      if (!navigation.moved) {
        if (Math.hypot(
          event.clientX - navigation.startX,
          event.clientY - navigation.startY,
        ) < 4) return
        navigation.moved = true
        setNavigationActive(true)
        if (navigation.surface) showPivotFeedback(navigation.startX, navigation.startY)
      }
      navigation.lastX = event.clientX
      navigation.lastY = event.clientY
      if (dx === 0 && dy === 0) return
      const radiansPerPixel = (Math.PI * 2 / Math.max(container.clientHeight, 1)) * controls.rotateSpeed
      rotateCameraRigAroundPivot(
        camera,
        controls.target,
        navigation.pivot,
        -dx * radiansPerPixel,
        -dy * radiansPerPixel,
      )
      controls.update()
      event.preventDefault()
      event.stopPropagation()
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

  const handleWheel = useCallback((event: WheelEvent) => {
    const camera = cameraRef.current
    const controls = controlsRef.current
    if (!camera || !controls || !controls.enabled || event.deltaY === 0) return
    const anchor = wheelAnchorRef.current
      ?? pointerNavigationAnchor(event.clientX, event.clientY, true)?.point
    if (!anchor) return
    wheelAnchorRef.current = anchor
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(containerRef.current?.clientHeight ?? 1, 1)
        : 1
    const delta = THREE.MathUtils.clamp(event.deltaY * unit, -240, 240)
    const scale = Math.exp(delta * 0.0015 * controls.zoomSpeed)
    if (!zoomCameraRigToAnchor(
      camera,
      controls.target,
      anchor,
      scale,
      controls.minDistance,
      controls.maxDistance,
    )) return
    controls.update()
    setNavigationActive(true)
    if (wheelNavigationTimeoutRef.current !== null) window.clearTimeout(wheelNavigationTimeoutRef.current)
    wheelNavigationTimeoutRef.current = window.setTimeout(() => {
      wheelNavigationTimeoutRef.current = null
      wheelAnchorRef.current = null
      setNavigationActive(false)
    }, 120)
  }, [pointerNavigationAnchor, setNavigationActive])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // React delegates wheel events from the root and browsers may treat that
    // listener as passive. A native non-passive capture listener guarantees
    // that trackpad/wheel gestures over the viewer never reach page scrolling
    // or platform rubber-band navigation.
    container.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => container.removeEventListener('wheel', handleWheel, { capture: true })
  }, [handleWheel])

  useEffect(() => {
    if (uvfAssetRef.current) {
      applyFieldColoring(uvfAssetRef.current, selectedField, colormap, {
        range: activeColorRange,
        entityIds: fieldEntityIds,
        scale: resolvedFieldScale,
      })
    }
  }, [assetState.status, selectedField, colormap, fieldEntityIds, activeColorRange, resolvedFieldScale])

  useEffect(() => {
    licRendererRef.current?.dispose()
    licRendererRef.current = null
    const asset = uvfAssetRef.current
    if (!asset) return
    applyVectorVisualization(asset, selectedField, {
      lic: vectorLICEnabled,
      arrows: vectorArrowsEnabled,
      entityIds: fieldEntityIds,
      maxArrows: vectorArrowLimit,
    })
    licRendererRef.current = vectorLICEnabled
      ? createScreenSpaceLIC(asset, selectedField, fieldEntityIds)
      : null
    return () => {
      licRendererRef.current?.dispose()
      licRendererRef.current = null
    }
  }, [assetState.status, selectedField, fieldEntityIds, vectorLICEnabled, vectorArrowsEnabled, vectorArrowLimit])

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
      data-viewer-format={displayManifest?.format ?? ''}
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
        onPointerCancel={(event) => cancelViewerInteraction(event.pointerId)}
        onLostPointerCapture={(event) => {
          if (
            navigationDragRef.current?.pointerId === event.pointerId
            || draggedControlPointRef.current?.pointerId === event.pointerId
          ) cancelViewerInteraction(event.pointerId)
        }}
        role="img"
        aria-label="3D geometry viewer"
        tabIndex={0}
        style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
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
          <ViewerToolbar
            displayControls={(toolbar || assetStats) ? (
              <>
                {toolbar}
                {assetStats && (
                  <>
                    <ViewerPrecisionControl
                      levels={precisionInfo.levels}
                      currentLevel={precisionInfo.currentLevel}
                      selection={precisionSelection}
                      unavailableLevels={unavailablePrecisionLevels}
                      onChange={(selection) => {
                        setPrecisionNotice({ assetURL: displayManifest?.asset_url ?? null, message: '' })
                        setPrecision({ assetURL: displayManifest?.asset_url ?? null, selection })
                      }}
                    />
                    <button
                      type="button"
                      className={`viewer-wireframe-toggle ${effectiveWireframe ? 'active' : ''}`}
                      onClick={handleWireframeToggle}
                      aria-label={t('Toggle wireframe overlay')}
                      aria-pressed={effectiveWireframe}
                      title={t('Toggle wireframe overlay')}
                    >
                      {t('Wire')}
                    </button>
                  </>
                )}
              </>
            ) : null}
          >
            <button
              className="viewer-top-toolbar-fit viewer-icon-tooltip"
              data-tooltip={fitTargetsSelection
                ? t('Fit selected visualization object in the viewport')
                : t('Fit visible surfaces in the viewport')}
              type="button"
              onClick={() => applyCameraCommand(fitTargetsSelection ? 'fit-selection' : 'fit')}
              aria-label={fitTargetsSelection ? t('Fit selected visualization object') : t('Fit visible surfaces')}
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
          </ViewerToolbar>
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
            {t('Field:')}
            <select
              value={selectedField ?? ''}
              onChange={(e) => selectField(e.target.value || null)}
            >
              <option value="">{t('None')}</option>
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
                  <option value="log" disabled={!fieldDomain || !canUseLogFieldScale(fieldDomain[0], fieldDomain[1])}>
                    Log10
                  </option>
                </select>
              </label>
            </div>
          )}
          {selectedField && activeField && activeColorRange && (
            <ViewerFieldRangeControl
              fieldName={activeField.name}
              min={fieldDomain![0]}
              max={fieldDomain![1]}
              range={activeColorRange}
              scale={resolvedFieldScale}
              colormap={colormap}
              onChange={(range) => setFieldRangeOverride({ key: fieldRangeKey, range })}
            />
          )}
          {typeof fieldPanelExtra === 'function'
            ? fieldPanelExtra({ field: activeField, range: activeColorRange })
            : fieldPanelExtra}
          {showVectorControls && activeField?.kind === 'vector' && (
            <div className="viewer-vector-controls" role="group" aria-label={t('Vector display')}>
              <span>{t('Vector display')}</span>
              <button
                type="button"
                className={vectorLICEnabled ? 'active' : ''}
                aria-pressed={vectorLICEnabled}
                onClick={() => setVectorLICEnabled((enabled) => !enabled)}
              >
                {t('LIC texture')}
              </button>
              <button
                type="button"
                className={vectorArrowsEnabled ? 'active' : ''}
                aria-pressed={vectorArrowsEnabled}
                onClick={() => setVectorArrowsEnabled((enabled) => !enabled)}
              >
                {t('Vector arrows')}
              </button>
              {vectorArrowsEnabled && (
                <label className="viewer-vector-density">
                  <span>{t('Arrow density')}</span>
                  <select
                    aria-label={t('Arrow density')}
                    value={vectorArrowDensity}
                    onChange={(event) => setVectorArrowDensity(event.target.value as 'sparse' | 'standard' | 'dense')}
                  >
                    <option value="sparse">{t('Sparse')}</option>
                    <option value="standard">{t('Standard')}</option>
                    <option value="dense">{t('Dense')}</option>
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      )}
      {floatingPanel && viewerReady && (
        <div className="viewer-field-panel viewer-floating-panel">
          {floatingPanel}
        </div>
      )}
      {showEntityLegend && displayManifest && (
        <div className="viewer-legend">
          <div className="viewer-legend-header">
            <span>Groups / Zones / Regions</span>
            <span className="viewer-hover-label">
              {hoveredGroup ? `Hover: ${displayManifest.groups.find((g) => g.id === hoveredGroup)?.name ?? hoveredGroup}` : ''}
            </span>
          </div>
          {displayManifest.groups.map((g) => (
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

export function ViewerToolbar({
  displayControls,
  children,
}: {
  displayControls?: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="viewer-toolbar-slot viewer-action-toolbar-slot" role="toolbar" aria-label={t('Common viewer actions')}>
      {displayControls && (
        <div className="viewer-display-controls" role="group" aria-label={t('Viewer display modes')}>
          {displayControls}
        </div>
      )}
      {children}
    </div>
  )
}

export function precisionFallbackNotice(requestedLevel: number, defaultLevel: number): string {
  return `Detail level L${requestedLevel} is unavailable for this resource. Restored manifest default L${defaultLevel}.`
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry
      material?: THREE.Material | THREE.Material[]
    }
    if (!renderable.geometry || !renderable.material) return
    renderable.geometry.dispose()
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material]
    materials.forEach((material) => material.dispose())
  })
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
