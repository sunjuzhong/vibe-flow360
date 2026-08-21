import {
  AlertCircle,
  ArrowLeft,
  Cloud,
  FilePlus2,
  GitBranch,
  GitCompare,
  Info,
  MessageSquareText,
  PanelLeftOpen,
  RefreshCw,
  Sparkles,
  Tags,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  api,
  type Flow360Status,
  type Flow360DataResponse,
  type DraftRecord,
  type GeometryComparison,
  type GeometryDiagnosticReport,
  type ProjectInfo,
  type ProjectItem,
  type ProjectSyncManifest,
  type ResourceDetail,
  type ResourceNode,
} from '../api/client'
import CopilotPanel from '../components/CopilotPanel'
import DraftParametersDialog from '../components/DraftParametersDialog'
import DraftManagerPanel from '../components/DraftManagerPanel'
import GeometryWorkspace from '../components/GeometryWorkspace'
import InterventionPanel from '../components/InterventionPanel'
import LanguageSettings from '../components/LanguageSettings'
import InspectorDisclosure from '../components/InspectorDisclosure'
import PlanPanel from '../components/PlanPanel'
import { ProjectShellAction } from '../components/ProjectShellAction'
import ProjectContextBar from '../components/ProjectContextBar'
import ProjectLoadingOverlay from '../components/ProjectLoadingOverlay'
import ProjectDraftBar, { draftRecords } from '../components/ProjectDraftBar'
import Flow360IdLink from '../components/Flow360IdLink'
import ResourceDetailPanel, {
  resourceStatus,
  type ResourceDetailTab,
} from '../components/ResourceDetailPanel'
import ResourceTree, { ResourceIcon } from '../components/ResourceTree'
import SurfaceMeshWorkspace from '../components/SurfaceMeshWorkspace'
import VolumeMeshWorkspace from '../components/VolumeMeshWorkspace'
import CaseWorkspace from '../components/CaseWorkspace'
import { AnnotationPanel } from '../components/annotations'
import { useProjectAnnotations } from '../hooks/useProjectAnnotations'
import { useI18n } from '../i18n'
import type { ViewerState } from '../components/viewer/LazyViewer3D'
import { useFocusTrap } from '../lib/useFocusTrap'
import {
  remediationAgentAction,
  type SurfaceRemediationRecommendation,
} from '../lib/surfaceMeshAdvanced'
import {
  geometrySemanticAgentAction,
  type GeometrySemanticDraft,
} from '../lib/geometrySemantics'
import {
  geometryDiagnosticAgentAction,
  type GeometryReviewTemplateId,
} from '../lib/geometryAdvanced'
import {
  applyDraftEntityMutation,
  isDraftEntityValidationIssue,
  type DraftEntityMutation,
} from '../lib/draftEntities'

const allStages = ['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case']
const stageTypeSlugs: Record<string, string> = {
  Geometry: 'geometry',
  SurfaceMesh: 'surface-mesh',
  VolumeMesh: 'volume-mesh',
  Case: 'case',
}
const stageTypeBySlug = Object.fromEntries(Object.entries(stageTypeSlugs).map(([stage, slug]) => [slug, stage]))

export type ResourceStageLink = { stage: string; resource?: ProjectItem | ResourceNode; available?: boolean }

const assetTopologyKeys = [
  'bodies_face_edge_ids',
  'body_attribute_names',
  'body_group_tag',
  'body_ids',
  'edge_attribute_names',
  'edge_group_tag',
  'edge_ids',
  'face_attribute_names',
  'face_group_tag',
  'face_ids',
  'grouped_bodies',
  'grouped_edges',
  'grouped_faces',
  'global_bounding_box',
] as const

type ProjectPanel = 'resources' | 'details' | 'annotations' | 'parameters' | 'drafts'

export const initialProjectPanel = null

export function mergeDraftAssetTopology(
  sourceParams: Record<string, unknown> | undefined,
  draftParams: Record<string, unknown>,
): Record<string, unknown> {
  const sourceCache = objectValue(sourceParams?.private_attribute_asset_cache)
  const sourceInfo = objectValue(sourceCache.project_entity_info)
  if (Object.keys(sourceInfo).length === 0) return draftParams

  const draftCache = objectValue(draftParams.private_attribute_asset_cache)
  const draftInfo = objectValue(draftCache.project_entity_info)
  const mergedInfo = { ...draftInfo }
  for (const key of assetTopologyKeys) {
    if (!hasTopologyValue(draftInfo[key]) && hasTopologyValue(sourceInfo[key])) {
      mergedInfo[key] = sourceInfo[key]
    }
  }
  return {
    ...draftParams,
    private_attribute_asset_cache: {
      ...draftCache,
      project_entity_info: mergedInfo,
    },
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function hasTopologyValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasTopologyValue)
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  if (typeof value === 'string') return value.trim().length > 0
  return value !== undefined && value !== null
}

export function panelDismissesFromAmbientInteraction(panel: ProjectPanel | null): boolean {
  return panel !== 'parameters'
}

export function resourceContextLabel(projectName: string, resourceName: string, resourceType: string): string {
  return projectName.trim().toLocaleLowerCase() === resourceName.trim().toLocaleLowerCase()
    ? `${resourceType.replace('Mesh', ' Mesh')} resource`
    : resourceName
}

const resourceSuggestions: Record<string, string[]> = {
  Geometry: ['Review this Geometry’s modeling assumptions', 'Configure a Surface Mesh Draft', 'What inputs still need confirmation?'],
  SurfaceMesh: ['Assess the current surface mesh settings', 'Configure a Volume Mesh Draft', 'Explain the mesh parameter summary'],
  VolumeMesh: ['Configure a baseline Case Draft', 'Check the domain and boundary conditions', 'Give me a pre-solve checklist'],
  Case: ['Assess this Case setup', 'Are these results trustworthy?', 'Configure a Draft variation'],
}

function descendants(node: ResourceNode): number {
  return node.children.reduce((total, child) => total + 1 + descendants(child), 0)
}

function findNode(node: ResourceNode, id: string): ResourceNode | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findNode(child, id)
    if (found) return found
  }
  return null
}

export function resourceStageLinks(
  stages: string[],
  root: ResourceNode | null,
  items: ProjectItem[],
  selectedId: string,
): ResourceStageLink[] {
  const selectedNode = root ? findNode(root, selectedId) : null
  const byId = new Map(items.map((item) => [item.id, item]))
  const byStage = new Map<string, ProjectItem | ResourceNode>()
  let current = byId.get(selectedId) ?? selectedNode ?? null
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (stages.includes(current.type)) byStage.set(current.type, current)
    const parentId = 'parent_id' in current ? current.parent_id : byId.get(current.id)?.parent_id
    current = parentId ? byId.get(parentId) ?? (root ? findNode(root, parentId) : null) : null
  }
  return stages.map((stage) => ({ stage, resource: byStage.get(stage) }))
}

export function resourceCapabilityAvailable(resource: ProjectItem | ResourceNode | undefined): boolean {
  if (!resource) return false
  const status = 'status' in resource && typeof resource.status === 'string'
    ? resource.status.trim().toLowerCase()
    : 'state' in resource && typeof resource.state === 'string'
      ? resource.state.trim().toLowerCase()
      : ''
  return status === ''
    ? resource.type === 'Geometry'
    : ['completed', 'processed', 'success', 'uploaded'].includes(status)
}

function stageTypeFromQuery(value: string): string {
  return stageTypeBySlug[value.trim().toLowerCase()] ?? ''
}

function stageTypeSlug(stage: string): string {
  return stageTypeSlugs[stage] ?? stage.toLowerCase()
}

export function projectSyncProgress(manifest: ProjectSyncManifest | null) {
  if (!manifest?.total_resources) return 4
  const finished = manifest.synced_resources + manifest.failed_resources
  return Math.min(100, Math.max(4, Math.round((finished / manifest.total_resources) * 100)))
}

function positiveBytes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function declaredSizeBytes(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const record = value as Record<string, unknown>
  return Math.max(
    positiveBytes(record.size_bytes),
    positiveBytes(record.file_size),
    positiveBytes(record.storage_size_bytes),
    positiveBytes(record.total_size_bytes),
  )
}

export function resourceEstimatedSizeBytes(
  item: ProjectItem | null,
  detail: ResourceDetail | null,
  manifest: ProjectSyncManifest | null,
): number | undefined {
  if (!item) return undefined
  const syncedResource = manifest?.resources[`${item.type}/${item.id}`]
  const artifactBytes = Object.values(syncedResource?.artifacts ?? {})
    .reduce((total, artifact) => total + positiveBytes(artifact.size_bytes), 0)
  const itemBytes = declaredSizeBytes(item)
  const detailBytes = Math.max(declaredSizeBytes(detail?.info), declaredSizeBytes(detail?.summary))
  const resultBytes = detail?.results?.records?.reduce(
    (total, record) => total + positiveBytes(record.size_bytes),
    0,
  ) ?? 0
  const estimate = Math.max(artifactBytes, itemBytes, detailBytes, resultBytes)
  return estimate > 0 ? estimate : undefined
}

export function estimatedResourceLoadDurationMs(sizeBytes?: number): number {
  if (!sizeBytes || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return 12_000
  const estimatedThroughputBytesPerSecond = 6 * 1024 * 1024
  const duration = 3_000 + (sizeBytes / estimatedThroughputBytesPerSecond) * 1_000
  return Math.round(Math.min(60_000, Math.max(6_000, duration)))
}

export function resourceTransitionProgress(
  detailReady: boolean,
  detailFailed: boolean,
  viewerState?: ViewerState,
): { active: boolean; progress: number; phase: 'detail' | 'preview' | 'asset' | 'complete' } {
  if (detailFailed) return { active: false, progress: 100, phase: 'complete' }
  // A preview can become ready from cached visualization files before the
  // resource detail request has finished. Keep the entry transition in front
  // until both are stable so Case metrics do not briefly render from a partial
  // cache snapshot (for example, zero result artifacts).
  if (!detailReady) return { active: true, progress: 4, phase: 'detail' }
  if (viewerState?.status === 'ready' || viewerState?.status === 'error') {
    return { active: false, progress: 100, phase: 'complete' }
  }
  if (!viewerState || viewerState.status === 'idle') return { active: true, progress: 4, phase: 'preview' }
  const assetProgress = viewerState.progress
  return {
    active: true,
    progress: assetProgress !== undefined && Number.isFinite(assetProgress)
      ? 4 + Math.min(1, Math.max(0, assetProgress)) * 90
      : 4,
    phase: assetProgress !== undefined ? 'asset' : 'preview',
  }
}

export async function hydrateResourceDetail(
  fetchDetail: (cacheOnly: boolean) => Promise<Flow360DataResponse<ResourceDetail>>,
  cacheFirst: boolean,
  onSnapshot: (response: Flow360DataResponse<ResourceDetail>) => void,
): Promise<{ cachedLoaded: boolean; liveLoaded: boolean; error?: unknown }> {
  let cachedLoaded = false
  let cachedDetail: ResourceDetail | null = null
  if (cacheFirst) {
    try {
      const cached = await fetchDetail(true)
      onSnapshot(cached)
      cachedLoaded = true
      cachedDetail = cached.data
    } catch {
      // A cache miss is expected on the first visit.
    }
  }

  // Completed Flow360 resources are immutable. Once the local snapshot has
  // the canonical parameters and (for Cases) the result inventory, another
  // live detail fetch only repeats expensive remote SDK work.
  const cachedStatus = String(cachedDetail?.state?.status ?? '').toLowerCase()
  const terminalCached = ['completed', 'processed', 'success', 'succeeded', 'failed', 'error'].includes(cachedStatus)
  const hasCanonicalParams = Boolean(cachedDetail?.simulation_params)
  const hasCaseResults = cachedDetail?.type !== 'Case' || Array.isArray(cachedDetail.results?.records)
  const hasCriticalErrors = Object.keys(cachedDetail?.errors ?? {}).some((key) => key !== 'summary')
  const reusablePartialCase = cachedDetail?.type === 'Case'
    && Array.isArray(cachedDetail.results?.records)
    && Object.keys(cachedDetail.errors ?? {}).every((key) => key === 'summary' || key === 'simulation_params')
  if (cachedDetail && terminalCached && hasCaseResults
    && ((hasCanonicalParams && !hasCriticalErrors) || reusablePartialCase)) {
    return { cachedLoaded: true, liveLoaded: false }
  }

  try {
    const live = await fetchDetail(false)
    onSnapshot(live)
    return { cachedLoaded, liveLoaded: true }
  } catch (error) {
    return { cachedLoaded, liveLoaded: false, error }
  }
}

export function geometryContextId(items: ProjectItem[], selectedId: string | null | undefined) {
  let current = items.find((item) => item.id === selectedId)
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    if (current.type === 'Geometry') return current.id
    visited.add(current.id)
    current = items.find((item) => item.id === current?.parent_id)
  }
  return items.find((item) => item.type === 'Geometry')?.id ?? null
}

export function draftSourceResource(
  items: ProjectItem[],
  draft: DraftRecord | null,
  detail: ResourceDetail | null,
): ProjectItem | null {
  if (!draft) return null
  const info = detail?.id === draft.id ? detail.info : undefined
  const candidates = [
    info?.source_id,
    info?.source_item_id,
    info?.root_resource_id,
    draft.source_id,
    draft.source_item_id,
  ]
  const sourceId = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return sourceId ? items.find((item) => item.id === sourceId.trim()) ?? null : null
}

export function draftSourceNode(
  root: ResourceNode | null,
  items: ProjectItem[],
  draft: DraftRecord | null,
  detail: ResourceDetail | null,
): ResourceNode | null {
  const source = draftSourceResource(items, draft, detail)
  if (!source) return null
  return root ? findNode(root, source.id) ?? { id: source.id, name: source.name, type: source.type, children: [] } : null
}

export function isDraftDetailFor(draftId: string, detail: ResourceDetail | null | undefined) {
  return Boolean(draftId && detail?.id === draftId && detail.type === 'Draft')
}

export function draftCreationBase(
  items: ProjectItem[],
  resource: ProjectItem,
  detail: ResourceDetail | null,
): { source: ProjectItem; simulationParams?: Record<string, unknown> } {
  const status = String(detail?.state?.status ?? detail?.info?.status ?? '').trim().toLowerCase()
  const parent = resource.parent_id ? items.find((item) => item.id === resource.parent_id) : undefined
  if (detail?.id === resource.id && status === 'error' && parent && detail.simulation_params) {
    return { source: parent, simulationParams: detail.simulation_params }
  }
  return { source: resource }
}

export function projectDraftResourcePath(projectId: string, resourceId: string, draftId = '', viewType = ''): string {
  const path = `/projects/${projectId}/resources/${resourceId}`
  const params = new URLSearchParams()
  if (draftId) params.set('draft', draftId)
  if (viewType) params.set('type', stageTypeSlug(viewType))
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export function projectDraftRootPath(projectId: string, root: Pick<ResourceNode, 'id'>, draftId: string): string {
  return projectDraftResourcePath(projectId, root.id, draftId)
}

export function projectResourceSelectionPath(projectId: string, resourceId: string, draftId = '', viewType = ''): string {
  return projectDraftResourcePath(projectId, resourceId, draftId, viewType)
}

export function resolveActiveDraftId(
  drafts: DraftRecord[],
  currentDraftId: string,
  requestedDraftId: string,
): string {
  if (requestedDraftId && drafts.some((draft) => draft.id === requestedDraftId)) return requestedDraftId
  if (drafts.some((draft) => draft.id === currentDraftId)) return currentDraftId
  return drafts[0]?.id ?? ''
}

export default function ProjectPage() {
  const { t } = useI18n()
  const { projectId = '', '*': projectPath = '' } = useParams()
  const [searchParams] = useSearchParams()
  const requestedDraftId = searchParams.get('draft')?.trim() ?? ''
  const requestedViewType = stageTypeFromQuery(searchParams.get('type') ?? '')
  const requestedPlanId = searchParams.get('plan')?.trim() ?? ''
  const requestedPlanMode = searchParams.get('planMode') === 'review' ? 'review' : 'run'
  const resourceId = projectPath.startsWith('resources/') ? projectPath.slice('resources/'.length) : ''
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const resourceIdRef = useRef(resourceId)
  resourceIdRef.current = resourceId
  const [flowStatus, setFlowStatus] = useState<Flow360Status | null>(null)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [root, setRoot] = useState<ResourceNode | null>(null)
  const [items, setItems] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<ResourceDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const detailRequestRef = useRef(0)
  const [drafts, setDrafts] = useState<DraftRecord[]>([])
  const [draftsLoading, setDraftsLoading] = useState(true)
  const [draftsError, setDraftsError] = useState('')
  const [activeDraftId, setActiveDraftId] = useState('')
  const [draftDetail, setDraftDetail] = useState<ResourceDetail | null>(null)
  const [draftDetailLoading, setDraftDetailLoading] = useState(false)
  const [draftDetailError, setDraftDetailError] = useState('')
  const draftDetailRequestRef = useRef(0)
  const [chatOpen, setChatOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [initialPlanId, setInitialPlanId] = useState('')
  const [planEntryMode, setPlanEntryMode] = useState<'review' | 'run'>('run')
  const openedRequestedPlan = useRef('')
  const [interventionOpen, setInterventionOpen] = useState(false)
  const [interventionPlanId, setInterventionPlanId] = useState('')
  const [activePanel, setActivePanel] = useState<ProjectPanel | null>(initialProjectPanel)
  const [detailTab, setDetailTab] = useState<ResourceDetailTab>('overview')
  const [projectDataSource, setProjectDataSource] = useState<'live' | 'cache'>('live')
  const [projectCachedAt, setProjectCachedAt] = useState('')
  const [cacheWarning, setCacheWarning] = useState('')
  const [detailDataSource, setDetailDataSource] = useState<'live' | 'cache'>('live')
  const [detailCachedAt, setDetailCachedAt] = useState('')
  const [syncManifest, setSyncManifest] = useState<ProjectSyncManifest | null>(null)
  const [syncing, setSyncing] = useState(true)
  const [syncError, setSyncError] = useState('')
  const [syncNonce, setSyncNonce] = useState(0)
  const [viewerLoad, setViewerLoad] = useState<{ resourceId: string; state: ViewerState } | null>(null)
  const annotations = useProjectAnnotations(projectId)

  useEffect(() => {
    const requestKey = `${requestedPlanId}:${requestedPlanMode}`
    if (!requestedPlanId || openedRequestedPlan.current === requestKey) return
    openedRequestedPlan.current = requestKey
    setChatOpen(false)
    setInitialPlanId(requestedPlanId)
    setPlanEntryMode(requestedPlanMode)
    setPlanOpen(true)
  }, [requestedPlanId, requestedPlanMode])
  const closePanel = useCallback(() => setActivePanel(null), [])
  const closePanelFromAmbientInteraction = useCallback(() => {
    if (panelDismissesFromAmbientInteraction(activePanel)) closePanel()
  }, [activePanel, closePanel])
  const panelRef = useFocusTrap<HTMLElement>(
    activePanel !== null,
    closePanelFromAmbientInteraction,
    'button[aria-label^="Close"]',
  )

  useEffect(() => {
    if (!activePanel) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusTimer = window.setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>('button[aria-label^="Close"]')
        ?.focus()
    }, 0)
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closePanelFromAmbientInteraction()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleEscape)
      previouslyFocused?.focus()
    }
  }, [activePanel, closePanelFromAmbientInteraction, panelRef])

  const loadProject = useCallback(async (cacheOnly = false, showLoading = true) => {
    if (showLoading) setLoading(true)
    setError('')
    setCacheWarning('')
    let cachedLoaded = false
    let cachedAt = ''
    try {
      const [cachedInfo, cachedTree, cachedItems] = await Promise.all([
        api.projectInfo(projectId, true),
        api.projectTree(projectId, true),
        api.projectItems(projectId, true),
      ])
      setProject(cachedInfo.data)
      setRoot(cachedTree.data.root)
      setItems(cachedItems.data.items)
      setProjectDataSource('cache')
      cachedAt = cachedInfo.cachedAt || cachedTree.cachedAt || cachedItems.cachedAt || ''
      setProjectCachedAt(cachedAt)
      cachedLoaded = true
      if (!resourceIdRef.current) {
        navigateRef.current(projectDraftResourcePath(projectId, cachedTree.data.root.id, requestedDraftId), { replace: true })
      }
      if (showLoading) setLoading(false)
      return true
    } catch {
      // A cache miss is expected on the first visit.
    }
    if (cacheOnly) {
      if (showLoading) setLoading(false)
      return false
    }
    try {
      const [info, tree, itemList] = await Promise.all([
        api.projectInfo(projectId),
        api.projectTree(projectId),
        api.projectItems(projectId),
      ])
      setProject(info.data)
      setRoot(tree.data.root)
      setItems(itemList.data.items)
      const cachedResponse = [info, tree, itemList].find((response) => response.source === 'cache')
      setProjectDataSource(cachedResponse ? 'cache' : 'live')
      setProjectCachedAt(cachedResponse?.cachedAt || '')
      if (cachedResponse) {
        setCacheWarning(`Live refresh failed. Showing the Go snapshot saved ${new Date(cachedResponse.cachedAt || cachedAt).toLocaleString()}.`)
      }
      if (!resourceIdRef.current) {
        navigateRef.current(projectDraftResourcePath(projectId, tree.data.root.id, requestedDraftId), { replace: true })
      }
      return true
    } catch (cause) {
      const message = String(cause).replace('Error: ', '')
      if (cachedLoaded) {
        setCacheWarning(`Live refresh failed. Showing the Go snapshot saved ${new Date(cachedAt).toLocaleString()}.`)
      } else {
        setError(message)
      }
      return false
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [projectId, requestedDraftId])

  useEffect(() => {
    api.flow360Status().then(setFlowStatus).catch(() => setFlowStatus({ available: false }))
  }, [])

  const loadDrafts = useCallback(async () => {
    setDraftsLoading(true)
    setDraftsError('')
    try {
      const response = await api.projectDrafts(projectId)
      const next = draftRecords(response.data)
      setDrafts(next)
      setActiveDraftId((current) => resolveActiveDraftId(next, current, requestedDraftId))
    } catch (cause) {
      setDraftsError(String(cause).replace('Error: ', ''))
    } finally {
      setDraftsLoading(false)
    }
  }, [projectId, requestedDraftId])

  useEffect(() => {
    void loadDrafts()
  }, [loadDrafts])

  useEffect(() => {
    const handleOpenIntervention = (event: Event) => {
      const detail = (event as CustomEvent<{ planId?: string }>).detail
      setInterventionPlanId(detail?.planId ?? '')
      setInterventionOpen(true)
    }
    window.addEventListener('vibesim:open-intervention', handleOpenIntervention)
    return () => {
      window.removeEventListener('vibesim:open-intervention', handleOpenIntervention)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const wait = () => new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, 500)
    })
    const synchronize = async () => {
      setSyncError('')
      setError('')
      let inventoryLoaded = await loadProject(true)
      if (cancelled) return
      setSyncing(!inventoryLoaded)
      try {
        let manifest = await api.startProjectSync(projectId, syncNonce > 0)
        if (cancelled) return
        setSyncManifest(manifest)
        while (!cancelled && manifest.status === 'syncing') {
          if (!inventoryLoaded && manifest.total_resources > 0) {
            inventoryLoaded = await loadProject(true)
            if (inventoryLoaded) setSyncing(false)
          }
          await wait()
          if (cancelled) return
          manifest = await api.projectSyncStatus(projectId)
          setSyncManifest(manifest)
        }
        if (cancelled) return
        if (manifest.status === 'partial') {
          setSyncError(
            `Project metadata sync completed with ${Object.keys(manifest.failures).length} failures. Local successful snapshots remain available.`,
          )
        }
        if (manifest.status === 'failed') {
          setSyncError('Project synchronization failed. Trying the most recent local mirror.')
        }
      } catch (cause) {
        if (cancelled) return
        setSyncError(String(cause).replace('Error: ', ''))
      } finally {
        if (!cancelled) {
          setSyncing(false)
          await loadProject(inventoryLoaded, !inventoryLoaded)
        }
      }
    }
    void synchronize()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [loadProject, projectId, syncNonce])

  const selected = useMemo(() => {
    if (!root) return null
    return findNode(root, resourceId) ?? root
  }, [root, resourceId])

  const activeDraft = useMemo(
    () => drafts.find((draft) => draft.id === activeDraftId) ?? null,
    [activeDraftId, drafts],
  )
  const activeDraftSource = useMemo(
    () => draftSourceNode(root, items, activeDraft, draftDetail),
    [activeDraft, draftDetail, items, root],
  )
  const draftMode = Boolean(requestedDraftId && activeDraft)
  const copilotScopeType = draftMode ? 'draft' : selected ? 'resource' : 'project'
  const copilotScopeId = draftMode ? activeDraft?.id : selected?.id

  useEffect(() => {
    if (!draftMode || !root || resourceId === root.id) return
    navigate(projectDraftRootPath(projectId, root, activeDraft?.id ?? ''), { replace: true })
  }, [activeDraft?.id, draftMode, navigate, projectId, resourceId, root])

  const loadDraftDetail = useCallback(async () => {
    const requestId = ++draftDetailRequestRef.current
    if (!activeDraftId) {
      setDraftDetail(null)
      setDraftDetailError('')
      return
    }
    setDraftDetailLoading(true)
    setDraftDetailError('')
    setDraftDetail(null)
    try {
      const response = await api.resourceDetail('Draft', activeDraftId, false, projectId)
      if (requestId !== draftDetailRequestRef.current) return
      if (!isDraftDetailFor(activeDraftId, response.data)) throw new Error('Flow360 returned a different Draft than the one requested.')
      setDraftDetail(response.data)
    } catch (cause) {
      if (requestId !== draftDetailRequestRef.current) return
      setDraftDetail(null)
      setDraftDetailError(String(cause).replace('Error: ', ''))
    } finally {
      if (requestId === draftDetailRequestRef.current) setDraftDetailLoading(false)
    }
  }, [activeDraftId, projectId])

  useEffect(() => {
    void loadDraftDetail()
  }, [loadDraftDetail])

  const stageLinks = useMemo<ResourceStageLink[]>(
    () => {
      if (!selected) return []
      if (draftMode && activeDraftSource) return [{ stage: activeDraftSource.type, resource: activeDraftSource, available: resourceCapabilityAvailable(activeDraftSource) }]
      return resourceStageLinks(allStages, root, items, selected.id)
        .filter((link) => Boolean(link.resource))
        .map((link) => ({ ...link, available: resourceCapabilityAvailable(link.resource) }))
    },
    [activeDraftSource, draftMode, items, root, selected],
  )
  const stages = useMemo(() => stageLinks.map((link) => link.stage), [stageLinks])
  const availableStageLinks = useMemo(() => stageLinks.filter((link) => link.resource && link.available !== false), [stageLinks])
  const defaultViewType = availableStageLinks.some((link) => link.stage === selected?.type) ? selected?.type ?? '' : availableStageLinks.at(-1)?.stage ?? ''
  const requestedStageLink = availableStageLinks.find((link) => link.stage === requestedViewType)
  const activeStageType = requestedStageLink?.stage ?? defaultViewType
  const activeStageLink = availableStageLinks.find((link) => link.stage === activeStageType)
  const activeResource = activeStageLink?.resource ?? null
  const activeResourceNode = root && activeResource ? findNode(root, activeResource.id) : null
  const selectedStage = Math.max(0, stages.indexOf(activeStageType))

  const selectCapability = (link: ResourceStageLink) => {
    if (!selected || !link.resource || link.available === false) return
    navigate(projectResourceSelectionPath(projectId, selected.id, draftMode ? activeDraft?.id ?? '' : '', link.stage))
  }

  useEffect(() => {
    if (!selected || !activeStageType || !activeResource) return
    const invalidRequestedType = Boolean(requestedViewType && requestedViewType !== activeStageType)
    const implicitUnavailableDefault = !requestedViewType && selected.type !== activeStageType
    if (!invalidRequestedType && !implicitUnavailableDefault) return
    navigate(projectResourceSelectionPath(projectId, selected.id, draftMode ? activeDraft?.id ?? '' : '', activeStageType), { replace: true })
  }, [activeDraft?.id, activeResource, activeStageType, draftMode, navigate, projectId, requestedViewType, selected])
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selected?.id) ?? null,
    [items, selected],
  )
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeResource?.id) ?? null,
    [activeResource, items],
  )

  const parentItem = useMemo(
    () => items.find((item) => item.id === selectedItem?.parent_id) ?? null,
    [items, selectedItem],
  )

  const contextGeometryId = useMemo(
    () => geometryContextId(items, selectedItem?.id),
    [items, selectedItem],
  )
  const activeContextGeometryId = useMemo(
    () => geometryContextId(items, activeItem?.id),
    [activeItem, items],
  )
  const workspaceDetail = useMemo(() => (
    detail && draftMode && draftDetail?.simulation_params
      ? {
          ...detail,
          simulation_params: mergeDraftAssetTopology(detail.simulation_params, draftDetail.simulation_params),
        }
      : detail
  ), [detail, draftDetail?.simulation_params, draftMode])
  const mutateDraftEntity = useCallback(async (mutation: DraftEntityMutation) => {
    if (!draftMode || !activeDraft || !draftDetail?.simulation_params) {
      throw new Error('Open an editable Draft before changing Draft entities.')
    }
    const next = applyDraftEntityMutation(draftDetail.simulation_params, mutation)
    const validation = await api.validateDraftParameters(activeDraft.id, next)
    const blockingIssue = validation.issues.find((issue) => (
      issue.level === 'error' && isDraftEntityValidationIssue(issue)
    ))
    if (blockingIssue) {
      throw new Error(`${blockingIssue.path ? `${blockingIssue.path}: ` : ''}${blockingIssue.message}`)
    }
    const response = await api.updateDraftParameters(activeDraft.id, next, projectId)
    setDraftDetail((current) => current ? { ...current, simulation_params: response.simulation_params } : current)
  }, [activeDraft, draftDetail?.simulation_params, draftMode, projectId])
  const surfaceMeshVersions = useMemo(
    () => items.filter((item) => (
      item.type === 'SurfaceMesh'
      && (!activeContextGeometryId || item.parent_id === activeContextGeometryId)
    )),
    [activeContextGeometryId, items],
  )

  const selectResource = (resource: ResourceNode | ProjectItem) => {
    navigate(projectResourceSelectionPath(projectId, resource.id, draftMode ? activeDraft?.id ?? '' : ''))
    setActivePanel(null)
  }

  const openDraftContext = (draftId: string) => {
    const target = drafts.find((draft) => draft.id === draftId)
    if (!target || !root) return
    setActiveDraftId(draftId)
    setActivePanel(null)
    navigate(projectDraftRootPath(projectId, root, draftId))
  }

  const renameDraft = async (draftId: string, name: string) => {
    const canonical = await api.renameDraft(draftId, name, projectId)
    setDrafts((current) => current.map((draft) => draft.id === draftId ? { ...draft, ...canonical } : draft))
    setDraftDetail((current) => current
      ? { ...current, info: { ...current.info, name: canonical.name } }
      : current)
  }

  const createDraftFromResource = async (name: string) => {
    if (!activeResource || !activeItem || !root) throw new Error('A source Resource is required to create a Draft.')
    const selectedDetail = detail?.id === activeResource.id
      ? detail
      : (await api.resourceDetail(activeResource.type, activeResource.id, false, projectId)).data
    const creation = draftCreationBase(items, activeItem, selectedDetail)
    const created = await api.createConfiguredDraft(projectId, {
      source_id: creation.source.id,
      name,
      ...(creation.simulationParams
        ? { simulation_params: creation.simulationParams }
        : { patch: {} }),
    })
    setActiveDraftId(created.id)
    await loadDrafts()
    setActivePanel(null)
    navigate(projectDraftRootPath(projectId, root, created.id))
  }

  const copyDraft = async (draft: DraftRecord, name: string) => {
    if (!root) throw new Error('The source Resource for this Draft is unavailable.')
    const sourceDetail = draft.id === draftDetail?.id
      ? draftDetail
      : (await api.resourceDetail('Draft', draft.id, false, projectId)).data
    const source = draftSourceResource(items, draft, sourceDetail)
    if (!source) throw new Error('The source Resource for this Draft is unavailable.')
    if (!sourceDetail?.simulation_params) throw new Error('The Draft SimulationParams are unavailable.')
    const created = await api.createConfiguredDraft(projectId, {
      source_id: source.id,
      name,
      simulation_params: sourceDetail.simulation_params,
    })
    setActiveDraftId(created.id)
    await loadDrafts()
    setActivePanel(null)
    navigate(projectDraftRootPath(projectId, root, created.id))
  }

  const deleteDraft = async (draftId: string) => {
    await api.deleteDraft(draftId, true, projectId)
    await loadDrafts()
    if (draftId === activeDraftId) {
      setActiveDraftId('')
      navigate(projectDraftResourcePath(projectId, root?.id ?? ''))
    }
  }

  const handleViewerLoadStateChange = useCallback((state: ViewerState) => {
    if (!activeResource) return
    setViewerLoad({ resourceId: activeResource.id, state })
  }, [activeResource])

  const loadDetail = useCallback(async (cacheFirst = true) => {
    if (!activeResource) return
    const requestId = ++detailRequestRef.current
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    const result = await hydrateResourceDetail(
      (cacheOnly) => api.resourceDetail(activeResource.type, activeResource.id, cacheOnly, projectId),
      cacheFirst,
      (response) => {
        if (requestId !== detailRequestRef.current) return
        setDetail(response.data)
        setDetailDataSource(response.source)
        setDetailCachedAt(response.cachedAt || '')
      },
    )
    if (requestId !== detailRequestRef.current) return
    if (result.error && !result.cachedLoaded) {
      setDetailError(String(result.error).replace('Error: ', ''))
    }
    setDetailLoading(false)
  }, [activeResource, projectId])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  const currentViewerState = viewerLoad && viewerLoad.resourceId === activeResource?.id ? viewerLoad.state : undefined
  const resourceTransition = resourceTransitionProgress(
    Boolean(activeResource && detail?.id === activeResource.id && !detailLoading),
    Boolean(detailError),
    currentViewerState,
  )
  const projectTransitionActive = !project && (loading || syncing)
  const transitionActive = projectTransitionActive || Boolean(activeResource && resourceTransition.active)
  const transitionProgress = projectTransitionActive
    ? 6 + projectSyncProgress(syncManifest) * 0.26
    : resourceTransition.progress
  const estimatedLoadDurationMs = estimatedResourceLoadDurationMs(
    resourceEstimatedSizeBytes(activeItem, detail, syncManifest),
  )
  const transitionTitle = projectTransitionActive
    ? t('Opening Project')
    : resourceTransition.phase === 'detail'
      ? t('Loading resource details')
      : resourceTransition.phase === 'asset'
        ? t('Loading 3D resource files')
        : t('Preparing interactive 3D preview')
  const transitionDetail = projectTransitionActive
    ? (syncManifest?.current_resource
        ? t('Synchronizing {resource}').replace('{resource}', syncManifest.current_resource)
        : t('Reading Project metadata and resource inventory…'))
    : resourceTransition.phase === 'detail'
      ? t('Reading {type} metadata and parameters…').replace('{type}', activeResource?.type ?? t('resource'))
      : resourceTransition.phase === 'asset'
        ? t('Downloading and decoding the geometry buffers…')
        : t('Preparing the visualization manifest…')

  useEffect(() => {
    if (!selected || !detail) return
    const status = resourceStatus(detail).toLowerCase()
    if (['completed', 'processed', 'success', 'failed', 'error'].includes(status)) return
    const timer = window.setInterval(() => {
      void loadDetail(false)
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [detail, loadDetail, selected])

  return (
    <div className={`project-page ${chatOpen ? 'chat-visible' : ''}`}>
      <header className="project-shell-header">
        <Link className="project-shell-brand" to="/" aria-label="Return to workspace">
          <span><Sparkles size={16} /></span>
          <strong>Vibe Flow360</strong>
        </Link>
        <div className="project-shell-context">
          <Link to="/" aria-label="Back to workspace"><ArrowLeft size={15} /></Link>
          <div>
            <span>Project</span>
            <strong>{project?.name || (loading ? 'Loading Project…' : projectId)}</strong>
          </div>
        </div>
        <div className="project-shell-actions">
          <ProjectShellAction
            label="Resources"
            icon={<PanelLeftOpen size={15} />}
            className={activePanel === 'resources' ? 'active' : ''}
            onClick={() => setActivePanel((panel) => panel === 'resources' ? null : 'resources')}
            aria-expanded={activePanel === 'resources'}
          />
          {selected && (
            <ProjectShellAction
              label="Details"
              accessibleLabel="Open resource details"
              icon={<Info size={15} />}
              className={activePanel === 'details' ? 'active' : ''}
              onClick={() => {
                setDetailTab('overview')
                setActivePanel((panel) => panel === 'details' ? null : 'details')
              }}
              aria-expanded={activePanel === 'details'}
            />
          )}
          <ProjectShellAction
            label="Annotations"
            icon={<Tags size={15} />}
            className={activePanel === 'annotations' ? 'active' : ''}
            onClick={() => setActivePanel((panel) => panel === 'annotations' ? null : 'annotations')}
            aria-expanded={activePanel === 'annotations'}
          />
          <ProjectShellAction
            label="Sync"
            accessibleLabel="Synchronize Project"
            icon={<RefreshCw size={15} className={syncing ? 'spin' : ''} />}
            className="compact-hide"
            onClick={() => setSyncNonce((value) => value + 1)}
            disabled={loading || syncing}
          />
          {items.some((item) => item.type === 'Case') && (
            <ProjectShellAction
              label="Compare"
              accessibleLabel="Compare Cases"
              icon={<GitCompare size={15} />}
              className="compact-hide"
              onClick={() => navigate(`/projects/${projectId}/compare`)}
            />
          )}
          <ProjectShellAction
            label="Ask AI"
            icon={<MessageSquareText size={15} />}
            className="ai"
            onClick={() => setChatOpen(true)}
          />
          <LanguageSettings compact />
          <div className={`project-connection ${flowStatus?.available ? 'online' : ''}`} title={
            flowStatus?.available
              ? `${flowStatus.environment || 'production'} · ${flowStatus.profile || 'default'}`
              : 'Flow360 offline'
          }>
            <span />
            <Cloud size={13} />
          </div>
        </div>
      </header>

      <ProjectLoadingOverlay
        sessionKey={`${projectId}:${selected?.id ?? (resourceId || 'project')}`}
        active={transitionActive}
        progress={transitionProgress}
        estimatedDurationMs={estimatedLoadDurationMs}
        title={transitionTitle}
        detail={transitionDetail}
        completeTitle={t('Ready')}
        completeDetail={t('Project workspace is ready.')}
      />

      {syncing && (
        <div className="project-sync-state">
          <div className="project-sync-heading">
            <RefreshCw size={22} className="spin" />
            <div>
              <strong>Synchronizing Project</strong>
              <span>
                {syncManifest?.current_resource
                  ? `Reading ${syncManifest.current_resource}`
                  : 'Reading Project metadata and resource inventory…'}
              </span>
            </div>
            <em>{syncManifest?.artifact_policy ?? 'metadata-only'}</em>
          </div>
          <div className="project-sync-progress" role="progressbar"
            aria-valuemin={0}
            aria-valuemax={syncManifest?.total_resources || 1}
            aria-valuenow={(syncManifest?.synced_resources ?? 0) + (syncManifest?.failed_resources ?? 0)}
          >
            <span style={{ width: `${projectSyncProgress(syncManifest)}%` }} />
          </div>
          <div className="project-sync-counts">
            <span>{syncManifest?.synced_resources ?? 0}/{syncManifest?.total_resources ?? '—'} resources</span>
            <span>{syncManifest?.failed_resources ?? 0} failed</span>
          </div>
        </div>
      )}
      {loading && !project && <div className="project-load-state"><RefreshCw size={22} className="spin" /> Loading Project resources…</div>}
      {!syncing && syncError && <div className="project-cache-warning"><AlertCircle size={14} />{syncError}</div>}
      {!syncing && syncManifest && Object.keys(syncManifest.failures).length > 0 && (
        <details className="project-sync-failures">
          <summary>
            <AlertCircle size={14} />
            {Object.keys(syncManifest.failures).length} synchronization failures
          </summary>
          <ul>
            {Object.entries(syncManifest.failures).map(([resource, message]) => (
              <li key={resource}>
                <strong>{resource}</strong>
                <span>{message}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => setSyncNonce((value) => value + 1)}>Retry complete synchronization</button>
        </details>
      )}
      {!syncing && !loading && error && (
        <div className="project-load-state error">
          <AlertCircle size={22} />
          <strong>Could not load this Project</strong>
          <span>{error}</span>
          <button onClick={() => setSyncNonce((value) => value + 1)}>Retry synchronization</button>
          <Link to="/">Back to workspace</Link>
        </div>
      )}
      {cacheWarning && <div className="project-cache-warning"><AlertCircle size={14} />{cacheWarning}</div>}

      {!loading && !error && project && root && selected && (
        <div className="project-workbench">
          {activePanel && (panelDismissesFromAmbientInteraction(activePanel)
            ? <button className="project-panel-scrim" onClick={closePanel} aria-label="Close panel" />
            : <div className="project-panel-scrim" aria-hidden="true" />)}
          {activePanel === 'resources' && (
          <aside ref={panelRef} className="resource-sidebar project-drawer project-drawer-left" role="dialog" aria-modal="true" aria-label="Project resources" tabIndex={-1}>
            <div className="workbench-panel-title">
              <GitBranch size={15} /><span>Project resources</span>
              <button onClick={closePanel} aria-label="Close resources"><X size={15} /></button>
            </div>
            <ResourceTree
              root={root}
              items={items}
              selected={selected.id}
              environment={flowStatus?.environment}
              projectId={projectId}
              onSelect={selectResource}
            />
          </aside>
          )}

          <main className="resource-workspace project-canvas">
            <ProjectContextBar
              resourceName={resourceContextLabel(project.name, selected.name, selected.type)}
              resourceType={selected.type}
              resourceId={selected.id}
              environment={flowStatus?.environment}
              projectId={projectId}
              status={resourceStatus(detail)}
              stages={stages}
              selectedStage={selectedStage}
              stageLinks={stageLinks}
              onStageSelect={selectCapability}
              resourceIcon={<ResourceIcon type={selected.type} size={17} />}
              draftControls={(
                <ProjectDraftBar
                  mode={draftMode ? 'draft' : 'resource'}
                  drafts={drafts}
                  selectedId={activeDraftId}
                  selectedDetail={draftDetail}
                  loading={draftsLoading}
                  detailLoading={draftDetailLoading}
                  error={draftsError}
                  onSelect={openDraftContext}
                  onEnter={openDraftContext}
                  onCreate={() => {
                    setActivePanel('drafts')
                  }}
                  onConfigure={() => setActivePanel('parameters')}
                  onReviewRun={() => {
                    setActivePanel(null)
                    setChatOpen(false)
                    setInitialPlanId('')
                    setPlanEntryMode('run')
                    setPlanOpen(true)
                  }}
                  onRename={renameDraft}
                  onManage={() => setActivePanel('drafts')}
                  onRefresh={() => void Promise.all([loadDrafts(), loadDraftDetail()])}
                />
              )}
            />

            {activeResource?.type === 'Geometry' && (
              <GeometryWorkspace
                key={activeResource.id}
                detail={workspaceDetail}
                resourceId={activeResource.id}
                projectId={projectId}
                resourceRef={{ id: activeResource.id, type: activeResource.type }}
                annotationsModel={annotations}
                geometryVersions={items
                  .filter((item) => item.type === 'Geometry')
                  .map((item) => ({ id: item.id, name: item.name }))}
                onCreateSemanticPlan={async (draft: GeometrySemanticDraft) => {
                  if (!project) throw new Error('Project context is required to create a Geometry Draft review.')
                  const result = await api.planFromAction(geometrySemanticAgentAction({
                    project,
                    geometryId: activeResource.id,
                    geometryName: activeResource.name,
                    draft,
                  }))
                  const plan = result.results.find((item) => item.plan)?.plan
                  if (!plan) throw new Error(result.results.find((item) => item.error)?.error ?? 'Draft review creation failed')
                  setInitialPlanId(plan.id)
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
                onCreateAdvancedPlan={async (
                  report: GeometryDiagnosticReport,
                  comparison: GeometryComparison | null,
                  templateId: GeometryReviewTemplateId,
                ) => {
                  if (!project) throw new Error('Project context is required to create an advanced Geometry Draft review.')
                  const result = await api.planFromAction(geometryDiagnosticAgentAction({
                    project,
                    geometryId: activeResource.id,
                    geometryName: activeResource.name,
                    report,
                    comparison,
                    templateId,
                  }))
                  const plan = result.results.find((item) => item.plan)?.plan
                  if (!plan) throw new Error(result.results.find((item) => item.error)?.error ?? 'Draft review creation failed')
                  setInitialPlanId(plan.id)
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
                onPlanSurfaceMesh={() => createDraftFromResource(`${activeResource.name} Draft`)}
                onMutateDraftEntity={draftMode ? mutateDraftEntity : undefined}
                onViewerLoadStateChange={handleViewerLoadStateChange}
              />
            )}
            {activeResource?.type === 'SurfaceMesh' && (
              <SurfaceMeshWorkspace
                key={activeResource.id}
                detail={workspaceDetail}
                resourceId={activeResource.id}
                projectId={projectId}
                resourceRef={{ id: activeResource.id, type: activeResource.type }}
                annotationsModel={annotations}
                geometryResourceId={activeContextGeometryId}
                versions={surfaceMeshVersions}
                onCreateRemediationPlan={async (recommendation: SurfaceRemediationRecommendation) => {
                  if (!project || !activeContextGeometryId) {
                    throw new Error('The parent Geometry is required to create a SurfaceMesh Draft repair.')
                  }
                  const geometry = items.find((item) => item.id === activeContextGeometryId)
                  const result = await api.planFromAction(remediationAgentAction({
                    recommendation,
                    project,
                    geometryId: activeContextGeometryId,
                    geometryName: geometry?.name ?? 'Geometry',
                  }))
                  const plan = result.results.find((item) => item.plan)?.plan
                  if (!plan) throw new Error(result.results.find((item) => item.error)?.error ?? 'Draft review creation failed')
                  setInitialPlanId(plan.id)
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
                onPlanVolumeMesh={() => createDraftFromResource(`${activeResource.name} Draft`)}
                onMutateDraftEntity={draftMode ? mutateDraftEntity : undefined}
                onViewerLoadStateChange={handleViewerLoadStateChange}
              />
            )}
            {activeResource?.type === 'VolumeMesh' && (
              <VolumeMeshWorkspace
                key={activeResource.id}
                detail={workspaceDetail}
                resourceId={activeResource.id}
                projectId={projectId}
                resourceRef={{ id: activeResource.id, type: activeResource.type }}
                annotationsModel={annotations}
                geometryResourceId={activeContextGeometryId}
                onPlanCase={() => createDraftFromResource(`${activeResource.name} Draft`)}
                onMutateDraftEntity={draftMode ? mutateDraftEntity : undefined}
                onViewerLoadStateChange={handleViewerLoadStateChange}
                onShowLogs={() => {
                  setDetailTab('logs')
                  setActivePanel('details')
                }}
              />
            )}
            {activeResource?.type === 'Case' && (
              <CaseWorkspace
                key={activeResource.id}
                detail={workspaceDetail}
                resourceId={activeResource.id}
                projectId={projectId}
                resourceRef={{ id: activeResource.id, type: activeResource.type }}
                annotationsModel={annotations}
                geometryResourceId={activeContextGeometryId}
                onPlanCase={() => createDraftFromResource(`${activeResource.name} Draft`)}
                onMutateDraftEntity={draftMode ? mutateDraftEntity : undefined}
                onViewerLoadStateChange={handleViewerLoadStateChange}
              />
            )}

          </main>

          {activePanel === 'details' && (
          <aside ref={panelRef} className="resource-inspector project-drawer project-drawer-right" role="dialog" aria-modal="true" aria-label="Resource details" tabIndex={-1}>
            <div className="workbench-panel-title">
              <Info size={15} /><span>Resource details</span>
              <button onClick={closePanel} aria-label="Close details"><X size={15} /></button>
            </div>
            <InspectorDisclosure label="Resource">
              <dl>
                <div><dt>Name</dt><dd>{selected.name}</dd></div>
                <div><dt>Type</dt><dd><span className="type-badge">{selected.type}</span></dd></div>
                <div><dt>ID</dt><dd className="mono-value">
                  <Flow360IdLink environment={flowStatus?.environment} projectId={projectId} resourceId={selected.id} resourceType={selected.type} />
                </dd></div>
                <div><dt>Parent</dt><dd>{parentItem
                  ? <Flow360IdLink environment={flowStatus?.environment} projectId={projectId} resourceId={parentItem.id} resourceType={parentItem.type}>{parentItem.type} · {parentItem.id}</Flow360IdLink>
                  : 'None'}</dd></div>
                <div><dt>Children</dt><dd>{selected.children.length}</dd></div>
                <div><dt>Status</dt><dd><span className={`status-pill status-${resourceStatus(detail).toLowerCase()}`}>{resourceStatus(detail)}</span></dd></div>
              </dl>
              <button type="button" className="geometry-plan-action" onClick={() => setActivePanel('drafts')}>
                <FilePlus2 size={14} /> Manage Drafts
              </button>
            </InspectorDisclosure>
            <InspectorDisclosure label="Project">
              <dl>
                <div><dt>ID</dt><dd className="mono-value"><Flow360IdLink environment={flowStatus?.environment} projectId={projectId} /></dd></div>
                <div><dt>Solver</dt><dd>{project.solver_version}</dd></div>
                <div><dt>Root type</dt><dd>{project.root_item.type}</dd></div>
                <div><dt>Tags</dt><dd>{project.tags.length ? project.tags.join(', ') : 'None'}</dd></div>
              </dl>
            </InspectorDisclosure>
            {draftMode && activeDraft && (
              <InspectorDisclosure label="ACTIVE DRAFT">
                <dl>
                  <div><dt>Name</dt><dd>{activeDraft.name || 'Untitled Draft'}</dd></div>
                  <div><dt>ID</dt><dd className="mono-value"><Flow360IdLink environment={flowStatus?.environment} projectId={projectId} resourceId={activeDraft.id} resourceType="Draft" /></dd></div>
                  <div><dt>Source</dt><dd>{String(activeDraft.source_type || draftDetail?.info?.source_type || 'Project resource')}</dd></div>
                  <div><dt>Status</dt><dd><span className={`status-pill status-${resourceStatus(draftDetail).toLowerCase()}`}>{resourceStatus(draftDetail)}</span></dd></div>
                </dl>
              </InspectorDisclosure>
            )}
            <ResourceDetailPanel
              detail={detail}
              loading={detailLoading}
              error={detailError}
              resourceType={activeResource?.type ?? selected.type}
              resourceId={activeResource?.id ?? selected.id}
              environment={flowStatus?.environment}
              projectId={projectId}
              resourceItems={items}
              onRetry={() => void loadDetail(false)}
              dataSource={detailDataSource}
              cachedAt={detailCachedAt}
              initialTab={detailTab}
            />
          </aside>
          )}

          {activePanel === 'drafts' && selected && (
            <DraftManagerPanel
              ref={panelRef}
              drafts={drafts}
              selectedId={activeDraftId}
              resource={{
                id: selected.id,
                name: selected.name,
                type: selected.type,
                parent_id: selectedItem?.parent_id ?? null,
              }}
              onClose={closePanel}
              onSelect={(draftId) => {
                openDraftContext(draftId)
                closePanel()
              }}
              onCreate={createDraftFromResource}
              onCopy={copyDraft}
              onRename={renameDraft}
              onDelete={deleteDraft}
            />
          )}

          {activePanel === 'annotations' && (
          <aside ref={panelRef} className="resource-inspector project-drawer project-drawer-right" role="dialog" aria-modal="true" aria-label="Project annotations" tabIndex={-1}>
            <div className="workbench-panel-title">
              <Tags size={15} /><span>Project annotations</span>
              <button onClick={closePanel} aria-label="Close annotations"><X size={15} /></button>
            </div>
            <AnnotationPanel
              model={annotations}
              onFocus={(annotation) => {
                const source = items.find((item) => item.id === annotation.resourceRef.id)
                if (source) {
                  selectResource(source)
                  closePanel()
                }
              }}
            />
          </aside>
          )}

          {activePanel === 'parameters' && activeDraft && (
            <DraftParametersDialog
              ref={panelRef}
              draftId={activeDraft.id}
              draftName={activeDraft.name}
              detail={draftDetail}
              loading={draftDetailLoading}
              error={draftDetailError}
              project={project ?? undefined}
              resource={activeDraftSource ?? undefined}
              onClose={closePanel}
              onRetry={() => void loadDraftDetail()}
              onParametersSynced={(simulationParams) => setDraftDetail((current) => current
                ? { ...current, simulation_params: simulationParams }
                : current)}
              onReviewRun={() => {
                setActivePanel(null)
                setChatOpen(false)
                setInitialPlanId('')
                setPlanEntryMode('run')
                setPlanOpen(true)
              }}
            />
          )}
        </div>
      )}

      <CopilotPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        projectId={projectId}
        projectName={project?.name}
        scopeType={copilotScopeType}
        scopeId={copilotScopeId}
        resourceId={activeResource?.id}
        resourceType={activeResource?.type}
        resourceName={activeResource?.name}
        onOpenPlan={(plan) => {
          setChatOpen(false)
          if (selected?.id === plan.source_id) {
            setInitialPlanId(plan.id)
            setPlanEntryMode('review')
            setPlanOpen(true)
            return
          }
          navigate(`/projects/${projectId}/resources/${encodeURIComponent(plan.source_id)}?plan=${encodeURIComponent(plan.id)}&planMode=review`)
        }}
        draftParameters={draftMode ? draftDetail?.simulation_params : undefined}
        onApplyDraftPatch={draftMode && activeDraft ? async (patch) => {
          const response = await api.patchDraftParameters(activeDraft.id, patch, projectId)
          setDraftDetail((current) => current ? { ...current, simulation_params: response.simulation_params } : current)
        } : undefined}
        contextLabel={draftMode && activeDraft
          ? `${activeDraft.name} · based on ${selected?.name || activeDraft.source_type || 'Resource'}`
          : selected
            ? `${activeResource?.type ?? selected.type} · ${activeResource?.name ?? selected.name}`
            : `Project · ${project?.name || projectId}`}
        context={JSON.stringify({
          project_id: project?.id ?? projectId,
          project_name: project?.name,
          solver_version: project?.solver_version,
          scope_type: copilotScopeType,
          scope_id: copilotScopeId,
          source_id: activeResource?.id,
          source_type: activeResource?.type,
          source_name: activeResource?.name,
          source_status: resourceStatus(detail),
          simulation_params: draftMode ? draftDetail?.simulation_params : detail?.simulation_params,
          resource_info: detail?.info,
          resource_state: detail?.state,
          resource_summary: detail?.summary,
          result_artifacts: detail?.results?.records,
          partial_errors: detail?.errors,
          project_resources: items.map(({ id, name, type, parent_id }) => ({ id, name, type, parent_id })),
          project_drafts: drafts.map(({ id, name, status, source_id, source_type }) => ({
            id, name, status, source_id, source_type,
          })),
          active_draft: draftMode && activeDraft ? {
            id: activeDraft.id,
            name: activeDraft.name,
            status: resourceStatus(draftDetail),
            source_id: activeDraft.source_id,
            source_type: activeDraft.source_type,
            simulation_params: draftDetail?.simulation_params,
          } : undefined,
          project_resource_count: items.length,
          project_draft_count: drafts.length,
          branch_resource_count: selected ? descendants(selected) + 1 : undefined,
          active_capability_type: activeStageType,
          context_resource_id: selected?.id,
          context_resource_type: selected?.type,
          execution_boundary: 'Read-only workbench. Propose Draft changes and validation, but do not claim execution.',
        })}
        suggestions={activeResource ? resourceSuggestions[activeResource.type] ?? [] : []}
      />
      {project && (draftMode ? activeDraftSource : activeResourceNode) && (
        <PlanPanel
          open={planOpen}
          onClose={() => {
            setPlanOpen(false)
            setInitialPlanId('')
            setPlanEntryMode('run')
          }}
          project={project}
          resource={(draftMode ? activeDraftSource : activeResourceNode)!}
          detail={draftMode ? draftDetail : detail}
          draftId={draftMode ? activeDraft?.id : undefined}
          draftName={draftMode ? activeDraft?.name : undefined}
          initialPlanId={initialPlanId}
          entryMode={planEntryMode}
          onEnterRun={() => setPlanEntryMode('run')}
          onSubmitted={() => {
            void Promise.all([loadProject(), loadDrafts()])
          }}
        />
      )}
      {project && (
        <InterventionPanel
          open={interventionOpen}
          onClose={() => setInterventionOpen(false)}
          projectId={project.id}
          resourceId={selected?.id}
          planId={interventionPlanId}
          onOpenPlan={(planId) => {
            setInterventionOpen(false)
            setInitialPlanId(planId)
            setPlanOpen(true)
          }}
        />
      )}
    </div>
  )
}
