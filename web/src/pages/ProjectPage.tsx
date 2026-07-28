import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  GitBranch,
  GitPullRequestDraft,
  MessageSquareText,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type Flow360Status,
  type ProjectInfo,
  type ProjectItem,
  type ResourceDetail,
  type ResourceNode,
} from '../api/client'
import CopilotPanel from '../components/CopilotPanel'
import PlanPanel from '../components/PlanPanel'
import ResourceDetailPanel, { resourceStatus } from '../components/ResourceDetailPanel'
import ResourceTree, { ResourceIcon } from '../components/ResourceTree'
import TopBar from '../components/TopBar'

const allStages = ['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case']

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

export default function ProjectPage() {
  const { projectId = '', resourceId = '' } = useParams()
  const navigate = useNavigate()
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
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const loadProject = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [info, tree, itemList] = await Promise.all([
        api.projectInfo(projectId),
        api.projectTree(projectId),
        api.projectItems(projectId),
      ])
      setProject(info)
      setRoot(tree.root)
      setItems(itemList.items)
      if (!resourceId) {
        navigate(`/projects/${projectId}/resources/${tree.root.id}`, { replace: true })
      }
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
    }
  }, [navigate, projectId, resourceId])

  useEffect(() => {
    api.flow360Status().then(setFlowStatus).catch(() => setFlowStatus({ available: false }))
  }, [])

  useEffect(() => {
    void loadProject()
  }, [loadProject])

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

  const selectResource = (resource: ResourceNode | ProjectItem) => {
    navigate(`/projects/${projectId}/resources/${resource.id}`)
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

  const loadDetail = useCallback(async () => {
    if (!selected) return
    setDetailLoading(true)
    setDetailError('')
    setDetail(null)
    try {
      setDetail(await api.resourceDetail(selected.type, selected.id))
    } catch (cause) {
      setDetailError(String(cause).replace('Error: ', ''))
    } finally {
      setDetailLoading(false)
    }
  }, [selected])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  return (
    <div className={`project-page ${chatOpen ? 'chat-visible' : ''}`}>
      <TopBar status={flowStatus} />
      <header className="project-header">
        <div className="project-breadcrumb">
          <button className="mobile-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle resource tree">
            <GitBranch size={15} />
          </button>
          <Link to="/"><ArrowLeft size={15} /> Workspace</Link>
          <ChevronRight size={13} />
          <span>{project?.name || 'Project'}</span>
        </div>
        <div className="project-header-main">
          <div>
            <p className="eyebrow">FLOW360 PROJECT</p>
            <h1>{project?.name || (loading ? 'Loading project…' : 'Project unavailable')}</h1>
            {project && <p>{project.solver_version} · {items.length} resources · {project.id}</p>}
          </div>
          <div className="project-header-actions">
            <button onClick={() => void loadProject()} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
            </button>
            {selected && (
              <button onClick={() => { setChatOpen(false); setPlanOpen(true) }}>
                <GitPullRequestDraft size={15} /> Plan next step
              </button>
            )}
            <button className="ai-action" onClick={() => setChatOpen(true)}>
              <MessageSquareText size={15} /> Ask AI
            </button>
          </div>
        </div>
      </header>

      {loading && <div className="project-load-state"><RefreshCw size={22} className="spin" /> Loading Project resources…</div>}
      {!loading && error && (
        <div className="project-load-state error">
          <AlertCircle size={22} />
          <strong>Could not load this Project</strong>
          <span>{error}</span>
          <button onClick={() => void loadProject()}>Retry</button>
          <Link to="/">Back to workspace</Link>
        </div>
      )}

      {!loading && !error && project && root && selected && (
        <div className={`project-workbench ${sidebarOpen ? 'sidebar-open' : ''}`}>
          <div className="mobile-overlay" onClick={() => setSidebarOpen(false)} />
          <aside className="resource-sidebar">
            <div className="workbench-panel-title"><GitBranch size={15} /><span>Resource tree</span></div>
            <ResourceTree root={root} items={items} selected={selected.id} onSelect={(r) => { selectResource(r); setSidebarOpen(false) }} />
          </aside>

          <main className="resource-workspace">
            <div className="resource-stage-strip adaptive">
              {stages.map((stage, index) => (
                <div className={`${index === selectedStage ? 'current' : ''} ${index < selectedStage ? 'before' : ''}`} key={stage}>
                  <span>{index < selectedStage ? <CheckCircle2 size={13} /> : index + 1}</span>
                  <small>{stage.replace('Mesh', ' Mesh')}</small>
                </div>
              ))}
            </div>

            <section className={`resource-hero resource-${selected.type.toLowerCase()}`}>
              <div className="resource-hero-icon"><ResourceIcon type={selected.type} size={28} /></div>
              <p className="eyebrow">SELECTED {selected.type.toUpperCase()}</p>
              <h2>{selected.name}</h2>
              <p>{selected.id}</p>
              {detail && <span className={`hero-status status-${resourceStatus(detail).toLowerCase()}`}>{resourceStatus(detail)}</span>}
              <div className="resource-real-data">
                <div><span>{selected.children.length}</span><small>Direct children</small></div>
                <div><span>{descendants(selected)}</span><small>Descendants</small></div>
                <div><span>{parentItem ? 1 : 0}</span><small>Parent resource</small></div>
              </div>
            </section>

            <ResourceDetailPanel
              detail={detail}
              loading={detailLoading}
              error={detailError}
              resourceType={selected.type}
              resourceId={selected.id}
              onRetry={() => void loadDetail()}
            />
          </main>

          <aside className="resource-inspector">
            <div className="workbench-panel-title"><span>Inspector</span></div>
            <div className="inspector-section">
              <p className="eyebrow">RESOURCE</p>
              <dl>
                <div><dt>Name</dt><dd>{selected.name}</dd></div>
                <div><dt>Type</dt><dd><span className="type-badge">{selected.type}</span></dd></div>
                <div><dt>ID</dt><dd className="mono-value">{selected.id}</dd></div>
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
          </aside>
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
          onClose={() => setPlanOpen(false)}
          project={project}
          resource={selected}
          onSubmitted={() => {
            void loadProject()
          }}
        />
      )}
    </div>
  )
}
