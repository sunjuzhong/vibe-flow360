import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Cloud,
  GitBranch,
  GitCompare,
  GitPullRequestDraft,
  Info,
  MessageSquareText,
  PanelLeftOpen,
  PanelRightOpen,
  RefreshCw,
  Sparkles,
  Tags,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type Flow360Status,
  type GeometryComparison,
  type GeometryDiagnosticReport,
  type ProjectInfo,
  type ProjectItem,
  type ProjectSyncManifest,
  type ResourceDetail,
  type ResourceNode,
} from '../api/client'
import CopilotPanel from '../components/CopilotPanel'
import GeometryWorkspace from '../components/GeometryWorkspace'
import InterventionPanel from '../components/InterventionPanel'
import PlanPanel from '../components/PlanPanel'
import { ProjectShellAction } from '../components/ProjectShellAction'
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

const flow360DomainMap: Record<string, string> = {
  dev: 'flow360.dev-simulation.cloud',
  uat: 'flow360.uat-simulation.cloud',
  prod: 'flow360.simulation.cloud',
  production: 'flow360.simulation.cloud',
}

function getFlow360Domain(environment?: string): string {
  const key = (environment || 'prod').toLowerCase().trim()
  return flow360DomainMap[key] ?? flow360DomainMap.prod
}

function buildWorkbenchUrl(environment: string | undefined, projectId: string, resourceId: string, resourceType: string): string {
  const domain = getFlow360Domain(environment)
  return `https://${domain}/workbench/${projectId}?id=${resourceId}&type=${resourceType}`
}

const resourceSuggestions: Record<string, string[]> = {
  Geometry: ['检查这个 Geometry 的建模前提', '规划 Surface Mesh', '有哪些输入还需要确认？'],
  SurfaceMesh: ['评估当前表面网格设置', '规划 Volume Mesh', '解释网格参数摘要'],
  VolumeMesh: ['规划一个基准 Case', '检查计算域和边界条件', '给出求解前验证清单'],
  Case: ['评估这个 Case 的设置', '检查结果是否值得信任', '规划一个参数变化工况'],
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

export default function ProjectPage() {
  const { projectId = '', '*': projectPath = '' } = useParams()
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
  const [chatOpen, setChatOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [initialPlanId, setInitialPlanId] = useState('')
  const [interventionOpen, setInterventionOpen] = useState(false)
  const [interventionPlanId, setInterventionPlanId] = useState('')
  const [activePanel, setActivePanel] = useState<'resources' | 'details' | 'annotations' | null>(null)
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
  const closePanel = useCallback(() => setActivePanel(null), [])
  const panelRef = useFocusTrap<HTMLElement>(
    activePanel !== null,
    closePanel,
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
      closePanel()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleEscape)
      previouslyFocused?.focus()
    }
  }, [activePanel, closePanel, panelRef])

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
        navigateRef.current(`/projects/${projectId}/resources/${cachedTree.data.root.id}`, { replace: true })
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
        navigateRef.current(`/projects/${projectId}/resources/${tree.data.root.id}`, { replace: true })
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
  }, [projectId])

  useEffect(() => {
    api.flow360Status().then(setFlowStatus).catch(() => setFlowStatus({ available: false }))
  }, [])

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
            <span>{project?.name || (loading ? 'Loading Project…' : 'Project')}</span>
            <strong>{selected?.name || projectId}</strong>
          </div>
          {detail && (
            <em className={`status-pill status-${resourceStatus(detail).toLowerCase()}`}>
              {resourceStatus(detail)}
            </em>
          )}
        </div>
        <div className="project-shell-actions">
          <ProjectShellAction
            label="Resources"
            icon={<PanelLeftOpen size={15} />}
            className={activePanel === 'resources' ? 'active' : ''}
            onClick={() => setActivePanel((panel) => panel === 'resources' ? null : 'resources')}
            aria-expanded={activePanel === 'resources'}
          />
          <ProjectShellAction
            label="Details"
            icon={<PanelRightOpen size={15} />}
            className={activePanel === 'details' ? 'active' : ''}
            onClick={() => {
              setDetailTab('overview')
              setActivePanel((panel) => panel === 'details' ? null : 'details')
            }}
            aria-expanded={activePanel === 'details'}
          />
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
            onClick={() => setSyncNonce((value) => value + 1)}
            disabled={loading || syncing}
          />
          {selected && (
            <ProjectShellAction
              label="Plan"
              icon={<GitPullRequestDraft size={15} />}
              className="primary"
              onClick={() => { setChatOpen(false); setInitialPlanId(''); setPlanOpen(true) }}
            />
          )}
          {items.some((item) => item.type === 'Case') && (
            <ProjectShellAction
              label="Compare"
              accessibleLabel="Compare Cases"
              icon={<GitCompare size={15} />}
              onClick={() => navigate(`/projects/${projectId}/compare`)}
            />
          )}
          <ProjectShellAction
            label="Ask AI"
            icon={<MessageSquareText size={15} />}
            className="ai"
            onClick={() => setChatOpen(true)}
          />
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
          {activePanel && <button className="project-panel-scrim" onClick={closePanel} aria-label="Close panel" />}
          {activePanel === 'resources' && (
          <aside ref={panelRef} className="resource-sidebar project-drawer project-drawer-left" role="dialog" aria-modal="true" aria-label="Project resources" tabIndex={-1}>
            <div className="workbench-panel-title">
              <GitBranch size={15} /><span>Project resources</span>
              <button onClick={closePanel} aria-label="Close resources"><X size={15} /></button>
            </div>
            <ResourceTree root={root} items={items} selected={selected.id} onSelect={selectResource} />
          </aside>
          )}

          <main className="resource-workspace project-canvas">
            <div className="project-canvas-toolbar">
              <div className="canvas-resource-title">
                <span className={`resource-type-icon type-${selected.type.toLowerCase()}`}>
                  <ResourceIcon type={selected.type} size={17} />
                </span>
                <div>
                  <strong>{selected.name}</strong>
                  <small>
                    {selected.type} ·{' '}
                    <a
                      className="id-link"
                      href={buildWorkbenchUrl(flowStatus?.environment, projectId, selected.id, selected.type)}
                      target="_blank"
                      rel="noreferrer"
                      title="Open in Flow360 workbench"
                    >
                      {selected.id}
                    </a>
                  </small>
                </div>
              </div>
              <div className="resource-stage-strip canvas-stage-strip" aria-label="Simulation stages">
              {stages.map((stage, index) => (
                <div className={`${index === selectedStage ? 'current' : ''} ${index < selectedStage ? 'before' : ''}`} key={stage}>
                  <span>{index < selectedStage ? <CheckCircle2 size={13} /> : index + 1}</span>
                  <small>{stage.replace('Mesh', ' Mesh')}</small>
                </div>
              ))}
              </div>
              <button
                className="canvas-info-button"
                onClick={() => {
                  setDetailTab('overview')
                  setActivePanel('details')
                }}
              >
                <Info size={15} /> Info
              </button>
            </div>

            {selected.type === 'Geometry' && (
              <GeometryWorkspace
                detail={detail}
                resourceId={selected.id}
                geometryVersions={items
                  .filter((item) => item.type === 'Geometry')
                  .map((item) => ({ id: item.id, name: item.name }))}
                onCreateSemanticPlan={async (draft: GeometrySemanticDraft) => {
                  if (!project) throw new Error('Project context is required to create a Geometry semantic review plan.')
                  const result = await api.planFromAction(geometrySemanticAgentAction({
                    project,
                    geometryId: selected.id,
                    geometryName: selected.name,
                    draft,
                  }))
                  const plan = result.results.find((item) => item.plan)?.plan
                  if (!plan) throw new Error(result.results.find((item) => item.error)?.error ?? 'Plan creation failed')
                  setInitialPlanId(plan.id)
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
                onCreateAdvancedPlan={async (
                  report: GeometryDiagnosticReport,
                  comparison: GeometryComparison | null,
                  templateId: GeometryReviewTemplateId,
                ) => {
                  if (!project) throw new Error('Project context is required to create an advanced Geometry review plan.')
                  const result = await api.planFromAction(geometryDiagnosticAgentAction({
                    project,
                    geometryId: selected.id,
                    geometryName: selected.name,
                    report,
                    comparison,
                    templateId,
                  }))
                  const plan = result.results.find((item) => item.plan)?.plan
                  if (!plan) throw new Error(result.results.find((item) => item.error)?.error ?? 'Plan creation failed')
                  setInitialPlanId(plan.id)
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
                onPlanSurfaceMesh={() => {
                  setChatOpen(false)
                  setInitialPlanId('')
                  setPlanOpen(true)
                }}
              />
            )}
            {selected.type === 'SurfaceMesh' && (
              <SurfaceMeshWorkspace
                detail={detail}
                resourceId={selected.id}
                geometryResourceId={contextGeometryId}
                versions={surfaceMeshVersions}
                onCreateRemediationPlan={async (recommendation: SurfaceRemediationRecommendation) => {
                  if (!project || !contextGeometryId) {
                    throw new Error('The parent Geometry is required to create a SurfaceMesh remediation plan.')
                  }
                  const geometry = items.find((item) => item.id === contextGeometryId)
                  const result = await api.planFromAction(remediationAgentAction({
                    recommendation,
                    project,
                    geometryId: contextGeometryId,
                    geometryName: geometry?.name ?? 'Geometry',
                  }))
                  const plan = result.results.find((item) => item.plan)?.plan
                  if (!plan) throw new Error(result.results.find((item) => item.error)?.error ?? 'Plan creation failed')
                  setInitialPlanId(plan.id)
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
                onPlanVolumeMesh={() => {
                  setChatOpen(false)
                  setInitialPlanId('')
                  setPlanOpen(true)
                }}
              />
            )}
            {selected.type === 'VolumeMesh' && (
              <VolumeMeshWorkspace
                detail={detail}
                resourceId={selected.id}
                geometryResourceId={contextGeometryId}
                onPlanCase={() => {
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
                onShowLogs={() => {
                  setDetailTab('logs')
                  setActivePanel('details')
                }}
              />
            )}
            {selected.type === 'Case' && (
              <CaseWorkspace
                detail={detail}
                resourceId={selected.id}
                geometryResourceId={contextGeometryId}
                onPlanCase={() => {
                  setChatOpen(false)
                  setPlanOpen(true)
                }}
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
            <div className="inspector-section">
              <p className="eyebrow">RESOURCE</p>
              <dl>
                <div><dt>Name</dt><dd>{selected.name}</dd></div>
                <div><dt>Type</dt><dd><span className="type-badge">{selected.type}</span></dd></div>
                <div><dt>ID</dt><dd className="mono-value">
                  <a
                    className="id-link"
                    href={buildWorkbenchUrl(flowStatus?.environment, projectId, selected.id, selected.type)}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in Flow360 workbench"
                  >
                    {selected.id}
                  </a>
                </dd></div>
                <div><dt>Parent</dt><dd>{parentItem?.type || 'None'}</dd></div>
                <div><dt>Children</dt><dd>{selected.children.length}</dd></div>
                <div><dt>Status</dt><dd><span className={`status-pill status-${resourceStatus(detail).toLowerCase()}`}>{resourceStatus(detail)}</span></dd></div>
              </dl>
            </div>
            <div className="inspector-section">
              <p className="eyebrow">PROJECT</p>
              <dl>
                <div><dt>Solver</dt><dd>{project.solver_version}</dd></div>
                <div><dt>Root type</dt><dd>{project.root_item.type}</dd></div>
                <div><dt>Tags</dt><dd>{project.tags.length ? project.tags.join(', ') : 'None'}</dd></div>
              </dl>
            </div>
            <ResourceDetailPanel
              detail={detail}
              loading={detailLoading}
              error={detailError}
              resourceType={selected.type}
              resourceId={selected.id}
              onRetry={() => void loadDetail(false)}
              dataSource={detailDataSource}
              cachedAt={detailCachedAt}
              initialTab={detailTab}
            />
          </aside>
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
        </div>
      )}

      <CopilotPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        contextLabel={selected ? `${selected.type} · ${selected.name}` : `Project · ${project?.name || projectId}`}
        context={selected && project
          ? `The user is viewing Flow360 project ${project.name} (${project.id}), solver ${project.solver_version}. Selected ${selected.type} ${selected.name} (${selected.id}), status ${resourceStatus(detail)}. The Project has ${items.length} resources; this branch has ${descendants(selected) + 1}. Flow360 summary: ${JSON.stringify(detail?.summary ?? {})}. Case result artifact count: ${detail?.results?.records?.length ?? 0}. Partial read errors: ${JSON.stringify(detail?.errors ?? {})}. This is a read-only workbench; propose plans and validation but do not claim execution.`
          : `The user is opening Flow360 project ${projectId}.`}
        suggestions={selected ? resourceSuggestions[selected.type] ?? [] : []}
      />
      {project && selected && (
        <PlanPanel
          open={planOpen}
          onClose={() => {
            setPlanOpen(false)
            setInitialPlanId('')
          }}
          project={project}
          resource={selected}
          detail={detail}
          initialPlanId={initialPlanId}
          onSubmitted={() => {
            void loadProject()
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
        />
      )}
    </div>
  )
}
