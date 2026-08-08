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

const allStages = ['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case']

type ProjectPanel = 'resources' | 'details' | 'annotations' | 'parameters' | 'drafts'

export const initialProjectPanel = null

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

export function projectSyncProgress(manifest: ProjectSyncManifest | null) {
  if (!manifest?.total_resources) return 4
  const finished = manifest.synced_resources + manifest.failed_resources
  return Math.min(100, Math.max(4, Math.round((finished / manifest.total_resources) * 100)))
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
    draft.source_id,
    draft.source_item_id,
    info?.source_id,
    info?.source_item_id,
    info?.root_resource_id,
  ]
  const sourceId = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0)
  return sourceId ? items.find((item) => item.id === sourceId.trim()) ?? null : null
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

export function projectDraftResourcePath(projectId: string, resourceId: string, draftId = ''): string {
  const path = `/projects/${projectId}/resources/${resourceId}`
  return draftId ? `${path}?draft=${encodeURIComponent(draftId)}` : path
}

export function projectDraftRootPath(projectId: string, root: Pick<ResourceNode, 'id'>, draftId: string): string {
  return projectDraftResourcePath(projectId, root.id, draftId)
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
  const { projectId = '', '*': projectPath = '' } = useParams()
  const [searchParams] = useSearchParams()
  const requestedDraftId = searchParams.get('draft')?.trim() ?? ''
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
  const [drafts, setDrafts] = useState<DraftRecord[]>([])
  const [draftsLoading, setDraftsLoading] = useState(true)
  const [draftsError, setDraftsError] = useState('')
  const [activeDraftId, setActiveDraftId] = useState('')
  const [draftDetail, setDraftDetail] = useState<ResourceDetail | null>(null)
  const [draftDetailLoading, setDraftDetailLoading] = useState(false)
  const [draftDetailError, setDraftDetailError] = useState('')
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
  const draftMode = Boolean(requestedDraftId && activeDraft)
  const copilotScopeType = draftMode ? 'draft' : selected ? 'resource' : 'project'
  const copilotScopeId = draftMode ? activeDraft?.id : selected?.id

  useEffect(() => {
    if (!draftMode || !root || resourceId === root.id) return
    navigate(projectDraftRootPath(projectId, root, activeDraft?.id ?? ''), { replace: true })
  }, [activeDraft?.id, draftMode, navigate, projectId, resourceId, root])

  const loadDraftDetail = useCallback(async () => {
    if (!activeDraftId) {
      setDraftDetail(null)
      setDraftDetailError('')
      return
    }
    setDraftDetailLoading(true)
    setDraftDetailError('')
    try {
      const response = await api.resourceDetail('Draft', activeDraftId)
      setDraftDetail(response.data)
    } catch (cause) {
      setDraftDetail(null)
      setDraftDetailError(String(cause).replace('Error: ', ''))
    } finally {
      setDraftDetailLoading(false)
    }
  }, [activeDraftId])

  useEffect(() => {
    void loadDraftDetail()
  }, [loadDraftDetail])

  const selectedItem = useMemo(
    () => items.find((item) => item.id === selected?.id) ?? null,
    [items, selected],
  )

  const parentItem = useMemo(
    () => items.find((item) => item.id === selectedItem?.parent_id) ?? null,
    [items, selectedItem],
  )

  const contextGeometryId = useMemo(
    () => geometryContextId(items, selectedItem?.id),
    [items, selectedItem],
  )
  const workspaceDetail = useMemo(() => (
    detail && draftMode && draftDetail?.simulation_params
      ? { ...detail, simulation_params: draftDetail.simulation_params }
      : detail
  ), [detail, draftDetail?.simulation_params, draftMode])
  const surfaceMeshVersions = useMemo(
    () => items.filter((item) => (
      item.type === 'SurfaceMesh'
      && (!contextGeometryId || item.parent_id === contextGeometryId)
    )),
    [contextGeometryId, items],
  )

  const selectResource = (resource: ResourceNode | ProjectItem) => {
    navigate(`/projects/${projectId}/resources/${resource.id}`)
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
    await api.renameDraft(draftId, name)
    setDrafts((current) => current.map((draft) => draft.id === draftId ? { ...draft, name } : draft))
    setDraftDetail((current) => current
      ? { ...current, info: { ...current.info, name } }
      : current)
  }

  const createDraftFromResource = async (name: string) => {
    if (!selected || !selectedItem || !root) throw new Error('A source Resource is required to create a Draft.')
    const selectedDetail = detail?.id === selected.id
      ? detail
      : (await api.resourceDetail(selected.type, selected.id)).data
    const creation = draftCreationBase(items, selectedItem, selectedDetail)
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
      : (await api.resourceDetail('Draft', draft.id)).data
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
    await api.deleteDraft(draftId, true)
    await loadDrafts()
    if (draftId === activeDraftId) {
      setActiveDraftId('')
      navigate(projectDraftResourcePath(projectId, root?.id ?? ''))
    }
  }

  const stages = useMemo(() => {
    if (!root) return allStages
    const rootType = root.type
    if (rootType === 'Geometry') return allStages
    if (rootType === 'SurfaceMesh') return ['SurfaceMesh', 'VolumeMesh', 'Case']
    if (rootType === 'VolumeMesh') return ['VolumeMesh', 'Case']
    return allStages
  }, [root])

  const selectedStage = Math.max(0, stages.indexOf(selected?.type ?? ''))

  const loadDetail = useCallback(async (cacheFirst = true) => {
    if (!selected) return
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    let cachedLoaded = false
    if (cacheFirst) {
      try {
        const cached = await api.resourceDetail(selected.type, selected.id, true)
        setDetail(cached.data)
        setDetailLoading(false)
        setDetailDataSource('cache')
        setDetailCachedAt(cached.cachedAt || '')
        cachedLoaded = true
      } catch {
        // A cache miss is expected on the first visit.
      }
    }
    if (cachedLoaded) return
    try {
      const response = await api.resourceDetail(selected.type, selected.id)
      setDetail(response.data)
      setDetailDataSource(response.source)
      setDetailCachedAt(response.cachedAt || '')
    } catch (cause) {
      if (!cachedLoaded) {
        setDetailError(String(cause).replace('Error: ', ''))
      }
    } finally {
      setDetailLoading(false)
    }
  }, [projectId, selected])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

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
                  onInspect={() => setActivePanel('parameters')}
                  onReview={() => {
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

            {selected.type === 'Geometry' && (
              <GeometryWorkspace
                key={selected.id}
                detail={workspaceDetail}
                resourceId={selected.id}
                projectId={projectId}
                resourceRef={{ id: selected.id, type: selected.type }}
                annotationsModel={annotations}
                geometryVersions={items
                  .filter((item) => item.type === 'Geometry')
                  .map((item) => ({ id: item.id, name: item.name }))}
                onCreateSemanticPlan={async (draft: GeometrySemanticDraft) => {
                  if (!project) throw new Error('Project context is required to create a Geometry Draft review.')
                  const result = await api.planFromAction(geometrySemanticAgentAction({
                    project,
                    geometryId: selected.id,
                    geometryName: selected.name,
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
                    geometryId: selected.id,
                    geometryName: selected.name,
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
                onPlanSurfaceMesh={() => createDraftFromResource(`${selected.name} Draft`)}
              />
            )}
            {selected.type === 'SurfaceMesh' && (
              <SurfaceMeshWorkspace
                key={selected.id}
                detail={workspaceDetail}
                resourceId={selected.id}
                projectId={projectId}
                resourceRef={{ id: selected.id, type: selected.type }}
                annotationsModel={annotations}
                geometryResourceId={contextGeometryId}
                versions={surfaceMeshVersions}
                onCreateRemediationPlan={async (recommendation: SurfaceRemediationRecommendation) => {
                  if (!project || !contextGeometryId) {
                    throw new Error('The parent Geometry is required to create a SurfaceMesh Draft repair.')
                  }
                  const geometry = items.find((item) => item.id === contextGeometryId)
                  const result = await api.planFromAction(remediationAgentAction({
                    recommendation,
                    project,
                    geometryId: contextGeometryId,
                    geometryName: geometry?.name ?? 'Geometry',
                  }))
                  const plan = result.results.find((item) => item.plan)?.plan
                  if (!plan) throw new Error(result.results.find((item) => item.error)?.error ?? 'Draft review creation failed')
                  setInitialPlanId(plan.id)
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
                onPlanVolumeMesh={() => createDraftFromResource(`${selected.name} Draft`)}
              />
            )}
            {selected.type === 'VolumeMesh' && (
              <VolumeMeshWorkspace
                key={selected.id}
                detail={workspaceDetail}
                resourceId={selected.id}
                projectId={projectId}
                resourceRef={{ id: selected.id, type: selected.type }}
                annotationsModel={annotations}
                geometryResourceId={contextGeometryId}
                onPlanCase={() => createDraftFromResource(`${selected.name} Draft`)}
                onShowLogs={() => {
                  setDetailTab('logs')
                  setActivePanel('details')
                }}
              />
            )}
            {selected.type === 'Case' && (
              <CaseWorkspace
                key={selected.id}
                detail={workspaceDetail}
                resourceId={selected.id}
                projectId={projectId}
                resourceRef={{ id: selected.id, type: selected.type }}
                annotationsModel={annotations}
                geometryResourceId={contextGeometryId}
                onPlanCase={() => createDraftFromResource(`${selected.name} Draft`)}
                onRefresh={() => void loadDetail(false)}
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
              <div className="inspector-section">
                <p className="eyebrow">ACTIVE DRAFT</p>
                <dl>
                  <div><dt>Name</dt><dd>{activeDraft.name || 'Untitled Draft'}</dd></div>
                  <div><dt>ID</dt><dd className="mono-value"><Flow360IdLink environment={flowStatus?.environment} projectId={projectId} resourceId={activeDraft.id} resourceType="Draft" /></dd></div>
                  <div><dt>Source</dt><dd>{String(activeDraft.source_type || draftDetail?.info?.source_type || 'Project resource')}</dd></div>
                  <div><dt>Status</dt><dd><span className={`status-pill status-${resourceStatus(draftDetail).toLowerCase()}`}>{resourceStatus(draftDetail)}</span></dd></div>
                </dl>
              </div>
            )}
            <ResourceDetailPanel
              detail={detail}
              loading={detailLoading}
              error={detailError}
              resourceType={selected.type}
              resourceId={selected.id}
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
              onClose={closePanel}
              onRetry={() => void loadDraftDetail()}
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
        resourceId={selected?.id}
        resourceType={selected?.type}
        resourceName={selected?.name}
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
          const response = await api.patchDraftParameters(activeDraft.id, patch)
          setDraftDetail((current) => current ? { ...current, simulation_params: response.simulation_params } : current)
        } : undefined}
        contextLabel={draftMode && activeDraft
          ? `${activeDraft.name} · based on ${selected?.name || activeDraft.source_type || 'Resource'}`
          : selected
            ? `${selected.type} · ${selected.name}`
            : `Project · ${project?.name || projectId}`}
        context={JSON.stringify({
          project_id: project?.id ?? projectId,
          project_name: project?.name,
          solver_version: project?.solver_version,
          scope_type: copilotScopeType,
          scope_id: copilotScopeId,
          source_id: selected?.id,
          source_type: selected?.type,
          source_name: selected?.name,
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
          execution_boundary: 'Read-only workbench. Propose Draft changes and validation, but do not claim execution.',
        })}
        suggestions={selected ? resourceSuggestions[selected.type] ?? [] : []}
      />
      {project && selected && (
        <PlanPanel
          open={planOpen}
          onClose={() => {
            setPlanOpen(false)
            setInitialPlanId('')
            setPlanEntryMode('run')
          }}
          project={project}
          resource={selected}
          detail={draftMode ? draftDetail : detail}
          draftId={draftMode ? activeDraft?.id : undefined}
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
