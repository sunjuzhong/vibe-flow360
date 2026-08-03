import {
  AlertCircle,
  ArrowRight,
  Box,
  ChevronRight,
  Clock3,
  RefreshCw,
  Search,
  FileUp,
  LayoutGrid,
  List,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  api,
  type Flow360Status,
  type FolderNode,
  type ProjectRecord,
} from '../api/client'
import AICreateModal from '../components/AICreateModal'
import FolderTree from '../components/FolderTree'
import ImportPanel from '../components/ImportPanel'
import TopBar from '../components/TopBar'

function projectCount(project: ProjectRecord, key: string) {
  return project.statistics?.[key]?.count ?? 0
}

export function formatProjectCreatedAt(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function WorkspacePage() {
  const navigate = useNavigate()
  const [flowStatus, setFlowStatus] = useState<Flow360Status | null>(null)
  const [folderRoot, setFolderRoot] = useState<FolderNode | null>(null)
  const [foldersLoading, setFoldersLoading] = useState(true)
  const [foldersError, setFoldersError] = useState('')
  const [foldersDataSource, setFoldersDataSource] = useState<'live' | 'cache'>('live')
  const [foldersCachedAt, setFoldersCachedAt] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<FolderNode | null>(null)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsMessage, setProjectsMessage] = useState('Select a folder to view its projects')
  const [projectsDataSource, setProjectsDataSource] = useState<'live' | 'cache'>('live')
  const [projectsCachedAt, setProjectsCachedAt] = useState('')
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list')
  const [importOpen, setImportOpen] = useState(false)
  const [aiCreateOpen, setAICreateOpen] = useState(false)

  const loadStatus = () => {
    api.flow360Status().then(setFlowStatus).catch((error) => {
      setFlowStatus({ available: false, error: String(error) })
    })
  }

  const loadFolders = async () => {
    setFoldersLoading(true)
    setFoldersError('')
    setFoldersDataSource('live')
    let cachedLoaded = false
    try {
      const cached = await api.folders(true)
      setFolderRoot(cached.data.root)
      setFoldersDataSource('cache')
      setFoldersCachedAt(cached.cachedAt || '')
      cachedLoaded = true
      setFoldersLoading(false)
    } catch {
      // A first-visit cache miss is expected.
    }
    try {
      const response = await api.folders()
      setFolderRoot(response.data.root)
      setFoldersDataSource(response.source)
      setFoldersCachedAt(response.cachedAt || '')
    } catch (error) {
      if (!cachedLoaded) setFoldersError(String(error).replace('Error: ', ''))
    } finally {
      setFoldersLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    void loadFolders()
  }, [])

  const loadProjects = async (folder: FolderNode) => {
    setSelectedFolder(folder)
    setProjectsLoading(true)
    setProjectsMessage('')
    let cachedLoaded = false
    try {
      const cached = await api.projects(folder.id, true)
      const records = cached.data.records ?? cached.data.projects ?? []
      setProjects(records)
      setProjectsDataSource('cache')
      setProjectsCachedAt(cached.cachedAt || '')
      setProjectsMessage(records.length ? '' : 'This folder has no cached projects')
      cachedLoaded = true
      setProjectsLoading(false)
    } catch {
      // A first-visit cache miss is expected.
    }
    try {
      const response = await api.projects(folder.id)
      const records = response.data.records ?? response.data.projects ?? []
      setProjects(records)
      setProjectsDataSource(response.source)
      setProjectsCachedAt(response.cachedAt || '')
      setProjectsMessage(response.data.warning || (records.length ? '' : 'This folder has no projects'))
    } catch (error) {
      if (!cachedLoaded) {
        setProjects([])
        setProjectsMessage(String(error).replace('Error: ', ''))
      }
    } finally {
      setProjectsLoading(false)
    }
  }

  const [sortBy, setSortBy] = useState<'name' | 'created' | 'type' | 'solver'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filterType, setFilterType] = useState('all')

  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    let result = projects
    if (normalized) {
      result = result.filter((project) =>
        project.name.toLowerCase().includes(normalized) ||
        project.root_item_type.toLowerCase().includes(normalized) ||
        project.solver_version.toLowerCase().includes(normalized)
      )
    }
    if (filterType !== 'all') {
      result = result.filter((project) => project.root_item_type === filterType)
    }
    result = [...result].sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'created': cmp = (a.created_at || '').localeCompare(b.created_at || ''); break
        case 'type': cmp = a.root_item_type.localeCompare(b.root_item_type); break
        case 'solver': cmp = a.solver_version.localeCompare(b.solver_version); break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [projects, query, filterType, sortBy, sortDir])

  const toggleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  return (
    <div className="product-page">
      <TopBar status={flowStatus} />
      <aside className="workspace-sidebar">
        <div className="sidebar-heading">
          <div><span className="eyebrow">FLOW360</span><h2>Workspace</h2></div>
          <button className="icon-button" onClick={() => void loadFolders()} disabled={foldersLoading} aria-label="Refresh folders">
            <RefreshCw size={15} className={foldersLoading ? 'spin' : ''} />
          </button>
        </div>
        {foldersLoading && <div className="panel-state compact">Loading folders…</div>}
        {foldersError && (
          <div className="panel-state compact error">
            <AlertCircle size={16} />
            <span>{foldersError}</span>
            <button onClick={() => void loadFolders()}>Retry</button>
          </div>
        )}
        {!foldersLoading && foldersDataSource === 'cache' && (
          <div className="panel-state compact cache-indicator">
            <span>Cached {foldersCachedAt ? new Date(foldersCachedAt).toLocaleString() : ''}</span>
          </div>
        )}
        {folderRoot && (
          <FolderTree
            folders={folderRoot.subfolders}
            selected={selectedFolder?.id ?? ''}
            onSelect={(folder) => void loadProjects(folder)}
          />
        )}
        <div className="workspace-sidebar-footer">
          <span>{folderRoot?.name || 'My workspace'}</span>
          <small>{folderRoot?.subfolders.length ?? 0} top-level folders</small>
        </div>
      </aside>

      <main className="workspace-home">
        <div className="workspace-home-header">
          <div>
            <p className="eyebrow">PROJECTS</p>
            <h1>{selectedFolder?.name || 'Choose a folder'}</h1>
            <p>
              {selectedFolder
                ? 'Select a project to enter its simulation workbench.'
                : 'Flow360 projects are organized by workspace folder.'}
            </p>
          </div>
          {selectedFolder && <div className="workspace-home-actions">
            <button className="ai-action" onClick={() => setImportOpen(true)}><FileUp size={16}/> New project</button>
            <button className="ai-action" onClick={() => setAICreateOpen(true)}><Sparkles size={16}/> AI Create</button>
          </div>}
        </div>

        {selectedFolder && (
          <div className="project-toolbar">
            <label>
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects…" />
            </label>
            {projectsDataSource === 'cache' && (
              <span className="cache-badge">Cached {projectsCachedAt ? new Date(projectsCachedAt).toLocaleString() : ''}</span>
            )}
            <label className="toolbar-filter">
              Type:
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="all">All</option>
                <option value="Geometry">Geometry</option>
                <option value="SurfaceMesh">Surface Mesh</option>
                <option value="VolumeMesh">Volume Mesh</option>
              </select>
            </label>
            <label className="toolbar-filter">
              Sort:
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                <option value="name">Name</option>
                <option value="created">Created</option>
                <option value="type">Type</option>
                <option value="solver">Solver</option>
              </select>
            </label>
            <button className="toolbar-refresh" onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')} aria-label="Toggle sort direction">
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
            <span>{filteredProjects.length} projects</span>
            <div className="project-view-mode" role="group" aria-label="Project view mode">
              <button
                className={viewMode === 'list' ? 'active' : ''}
                onClick={() => setViewMode('list')}
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
                title="List view"
              >
                <List size={14} />
              </button>
              <button
                className={viewMode === 'card' ? 'active' : ''}
                onClick={() => setViewMode('card')}
                aria-label="Card view"
                aria-pressed={viewMode === 'card'}
                title="Card view"
              >
                <LayoutGrid size={14} />
              </button>
            </div>
            <button
              className="toolbar-refresh"
              onClick={() => void loadProjects(selectedFolder)}
              disabled={projectsLoading}
            >
              <RefreshCw size={14} className={projectsLoading ? 'spin' : ''} />
              Refresh
            </button>
          </div>
        )}

        <section className="project-list-panel">
          {projectsLoading && <div className="panel-state"><RefreshCw size={19} className="spin" /><span>Loading projects…</span></div>}
          {!projectsLoading && projectsMessage && !projects.length && (
            <div className="panel-state">
              <Box size={22} />
              <strong>{projectsMessage}</strong>
              {selectedFolder && <button onClick={() => void loadProjects(selectedFolder)}>Retry</button>}
            </div>
          )}
          {!projectsLoading && filteredProjects.length > 0 && (
            viewMode === 'list' ? (
              <div className="project-table">
                <div className="project-table-head">
                  <span>Project</span><span>Workflow</span><span>Resources</span><span>Created</span><span>Solver</span><span />
                </div>
                {filteredProjects.map((project) => (
                  <Link className="project-table-row" key={project.id} to={`/projects/${project.id}`}>
                    <span className="project-primary">
                      <span className="project-type-mark"><Box size={16} /></span>
                      <span><strong>{project.name}</strong><small>{project.id}</small></span>
                    </span>
                    <span><span className="type-badge">{project.root_item_type}</span></span>
                    <span className="resource-counts">
                      <small>G {projectCount(project, 'geometry')}</small>
                      <small>SM {projectCount(project, 'surface_mesh')}</small>
                      <small>VM {projectCount(project, 'volume_mesh')}</small>
                      <small>C {projectCount(project, 'case')}</small>
                    </span>
                    <time className="project-created" dateTime={project.created_at}>{formatProjectCreatedAt(project.created_at)}</time>
                    <span className="solver-label">{project.solver_version}</span>
                    <span className="row-arrow"><ChevronRight size={16} /></span>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="project-card-grid">
                {filteredProjects.map((project) => (
                  <Link className="project-card" key={project.id} to={`/projects/${project.id}`}>
                    <div className={`project-card-visual type-${project.root_item_type.toLowerCase()}`} aria-hidden="true">
                      <Box size={31} strokeWidth={1.25} />
                      <span>{project.root_item_type}</span>
                    </div>
                    <div className="project-card-body">
                      <div className="project-card-heading">
                        <div><strong>{project.name}</strong><small>{project.id}</small></div>
                        <ChevronRight size={16} />
                      </div>
                      {project.description && <p>{project.description}</p>}
                      <div className="project-card-meta">
                        <span className="type-badge">{project.root_item_type}</span>
                        <span className="solver-label">{project.solver_version}</span>
                      </div>
                      <div className="resource-counts">
                        <small>G {projectCount(project, 'geometry')}</small>
                        <small>SM {projectCount(project, 'surface_mesh')}</small>
                        <small>VM {projectCount(project, 'volume_mesh')}</small>
                        <small>C {projectCount(project, 'case')}</small>
                      </div>
                      <time className="project-card-created" dateTime={project.created_at}>
                        <Clock3 size={12} /> Created {formatProjectCreatedAt(project.created_at)}
                      </time>
                    </div>
                  </Link>
                ))}
              </div>
            )
          )}
          {!projectsLoading && projects.length > 0 && !filteredProjects.length && (
            <div className="panel-state"><Search size={20} /><strong>No projects match “{query}”</strong></div>
          )}
        </section>

        <div className="home-guidance">
          <div><span>1</span><p><strong>Select a folder</strong>Browse the real Flow360 workspace tree.</p></div>
          <ArrowRight size={17} />
          <div><span>2</span><p><strong>Open a project</strong>Inspect its branching resource history.</p></div>
          <ArrowRight size={17} />
          <div><span>3</span><p><strong>Select a resource</strong>Geometry, mesh, and Case work starts there.</p></div>
        </div>
      </main>

      {selectedFolder && importOpen && <ImportPanel folder={selectedFolder} onClose={() => setImportOpen(false)} onCreated={(plan) => {
  setImportOpen(false)
  void loadProjects(selectedFolder)
  const result = plan.result as Record<string, unknown> | undefined
  const projectId = result?.project_id as string | undefined
  if (projectId) {
    navigate(`/projects/${encodeURIComponent(projectId)}`)
  }
}} />}
      {selectedFolder && aiCreateOpen && <AICreateModal
        folder={selectedFolder}
        onClose={() => setAICreateOpen(false)}
        onCreated={(result) => navigate(`/projects/${encodeURIComponent(result.project_id)}`)}
      />}
    </div>
  )
}
