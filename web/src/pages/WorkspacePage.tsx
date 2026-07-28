import {
  AlertCircle,
  ArrowRight,
  Box,
  ChevronRight,
  MessageSquareText,
  RefreshCw,
  Search,
  FileUp,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  type Flow360Status,
  type FolderNode,
  type ProjectRecord,
} from '../api/client'
import CopilotPanel from '../components/CopilotPanel'
import FolderTree from '../components/FolderTree'
import ImportPanel from '../components/ImportPanel'
import TopBar from '../components/TopBar'

function projectCount(project: ProjectRecord, key: string) {
  return project.statistics?.[key]?.count ?? 0
}

export default function WorkspacePage() {
  const [flowStatus, setFlowStatus] = useState<Flow360Status | null>(null)
  const [folderRoot, setFolderRoot] = useState<FolderNode | null>(null)
  const [foldersLoading, setFoldersLoading] = useState(true)
  const [foldersError, setFoldersError] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<FolderNode | null>(null)
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [projectsMessage, setProjectsMessage] = useState('Select a folder to view its projects')
  const [query, setQuery] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const loadStatus = () => {
    api.flow360Status().then(setFlowStatus).catch((error) => {
      setFlowStatus({ available: false, error: String(error) })
    })
  }

  const loadFolders = () => {
    setFoldersLoading(true)
    setFoldersError('')
    api.folders()
      .then((response) => setFolderRoot(response.root))
      .catch((error) => setFoldersError(String(error).replace('Error: ', '')))
      .finally(() => setFoldersLoading(false))
  }

  useEffect(() => {
    loadStatus()
    loadFolders()
  }, [])

  const loadProjects = async (folder: FolderNode) => {
    setSelectedFolder(folder)
    setProjectsLoading(true)
    setProjectsMessage('')
    try {
      const response = await api.projects(folder.id)
      const records = response.records ?? response.projects ?? []
      setProjects(records)
      setProjectsMessage(response.warning || (records.length ? '' : 'This folder has no projects'))
    } catch (error) {
      setProjects([])
      setProjectsMessage(String(error).replace('Error: ', ''))
    } finally {
      setProjectsLoading(false)
    }
  }

  const [sortBy, setSortBy] = useState<'name' | 'updated' | 'type' | 'solver'>('name')
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
        case 'updated': cmp = (b.created_at || '').localeCompare(a.created_at || ''); break
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
    <div className={`product-page ${chatOpen ? 'chat-visible' : ''}`}>
      <TopBar status={flowStatus} />
      <aside className="workspace-sidebar">
        <div className="sidebar-heading">
          <div><span className="eyebrow">FLOW360</span><h2>Workspace</h2></div>
          <button className="icon-button" onClick={loadFolders} disabled={foldersLoading} aria-label="Refresh folders">
            <RefreshCw size={15} className={foldersLoading ? 'spin' : ''} />
          </button>
        </div>
        {foldersLoading && <div className="panel-state compact">Loading folders…</div>}
        {foldersError && (
          <div className="panel-state compact error">
            <AlertCircle size={16} />
            <span>{foldersError}</span>
            <button onClick={loadFolders}>Retry</button>
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
          <button className="ai-action" onClick={() => setChatOpen(true)}>
            <MessageSquareText size={16} />
            Ask AI
          </button>
          {selectedFolder && <button className="ai-action" onClick={() => setImportOpen(true)}><FileUp size={16}/> New project</button>}
        </div>

        {selectedFolder && (
          <div className="project-toolbar">
            <label>
              <Search size={15} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects…" />
            </label>
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
                <option value="updated">Created</option>
                <option value="type">Type</option>
                <option value="solver">Solver</option>
              </select>
            </label>
            <button className="toolbar-refresh" onClick={() => setSortDir((d) => d === 'asc' ? 'desc' : 'asc')} aria-label="Toggle sort direction">
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
            <span>{filteredProjects.length} projects</span>
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
            <div className="project-table">
              <div className="project-table-head">
                <span>Project</span><span>Workflow</span><span>Resources</span><span>Solver</span><span />
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
                  <span className="solver-label">{project.solver_version}</span>
                  <span className="row-arrow"><ChevronRight size={16} /></span>
                </Link>
              ))}
            </div>
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

      <CopilotPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        contextLabel={selectedFolder ? `Folder · ${selectedFolder.name}` : 'Flow360 workspace'}
        context={selectedFolder
          ? `The user is browsing Flow360 folder ${selectedFolder.name} (${selectedFolder.id}) with ${projects.length} loaded projects.`
          : 'The user is at the Flow360 workspace home and has not selected a folder.'}
      />
      {selectedFolder && importOpen && <ImportPanel folder={selectedFolder} onClose={() => setImportOpen(false)} onCreated={() => { setImportOpen(false); void loadProjects(selectedFolder) }} />}
    </div>
  )
}
