import { AlertTriangle, CheckCircle2, Cloud, FileUp, Folder, RefreshCw, Rocket } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type Flow360Status } from '../api/client'
import { createT02Environment, type T02Entry } from '../tutorials/t02'
import type { TutorialEnvironmentStage } from '../tutorials/t01'
import { preferredTutorialFolder, tutorialEnvironmentPath, tutorialFolderOptions, type FolderOption } from './TutorialEnvironmentBuilder'

const accepted = '.cgns,.dat,.key,.k,.msh,.nas,.bdf,.inp,.vtk,.vtu'
const stageLabel: Record<TutorialEnvironmentStage, string> = {
  staging: 'Stage uploaded mesh', 'creating-project': 'Create and inspect mesh root',
  'creating-drafts': 'Configure two Case Drafts', ready: 'Ready for review',
}

export default function T02EnvironmentBuilder({ status }: { status: Flow360Status | null }) {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<FolderOption[]>([])
  const [folderId, setFolderId] = useState('')
  const [entry, setEntry] = useState<T02Entry>('volume-mesh')
  const [projectName, setProjectName] = useState('Tutorial T02 · VolumeMesh entry')
  const [file, setFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [stage, setStage] = useState<TutorialEnvironmentStage | null>(null)
  const [error, setError] = useState('')
  const busy = stage !== null && stage !== 'ready'

  useEffect(() => { api.folders().then((response) => {
    const options = tutorialFolderOptions(response.data.root); setFolders(options); setFolderId(preferredTutorialFolder(options))
  }).catch((cause) => setError(String(cause).replace('Error: ', ''))) }, [])
  const selectedFolder = useMemo(() => folders.find((item) => item.id === folderId), [folders, folderId])
  const canCreate = Boolean(status?.available && folderId && projectName.trim() && file && confirmed && !busy)

  const chooseEntry = (value: T02Entry) => {
    setEntry(value); setProjectName(`Tutorial T02 · ${value === 'surface-mesh' ? 'SurfaceMesh' : 'VolumeMesh'} entry`); setFile(null)
  }
  const create = async () => {
    if (!canCreate || !file) return
    setError('')
    try {
      const result = await createT02Environment({ folderId, projectName: projectName.trim(), entry, file }, api, setStage)
      navigate(tutorialEnvironmentPath(result, 'T02'))
    } catch (cause) { setStage(null); setError(String(cause).replace('Error: ', '')) }
  }

  return <div className="tutorial-environment-builder">
    <div className="environment-builder-heading"><div className="run-ready-icon"><Rocket size={25}/></div><div><span>CREATE THE EXPERIMENT</span><strong>Build a T02 mesh-entry Project</strong><p>Upload a reviewed mesh, create its Project root, and configure α 0°/5° Case Drafts without running them.</p></div></div>
    <div className="alpha-control" role="group" aria-label="Project entry type">
      <button className={entry === 'surface-mesh' ? 'active' : ''} onClick={() => chooseEntry('surface-mesh')} disabled={busy}><span>SurfaceMesh root</span><strong>VolumeMesh → Case remains</strong></button>
      <button className={entry === 'volume-mesh' ? 'active' : ''} onClick={() => chooseEntry('volume-mesh')} disabled={busy}><span>VolumeMesh root</span><strong>Direct to Case</strong></button>
    </div>
    <div className="environment-form-grid">
      <label><span>Project name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} disabled={busy}/></label>
      <label><span>Destination folder</span><select value={folderId} onChange={(event) => setFolderId(event.target.value)} disabled={busy}>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.label}</option>)}</select></label>
      <label><span>{entry === 'surface-mesh' ? 'Surface mesh' : 'Volume mesh'} file</span><input type="file" accept={accepted} disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)}/></label>
    </div>
    <div className="environment-summary">
      <div><Folder size={15}/><span><strong>{selectedFolder?.label || 'Choose a destination'}</strong><small>Flow360 Project · release-25.10 · unit m</small></span></div>
      <div><FileUp size={15}/><span><strong>{file?.name || 'Choose a supported mesh'}</strong><small>{entry === 'surface-mesh' ? 'Volume meshing and Case validation remain' : 'Only Case validation remains'}</small></span></div>
    </div>
    {stage && <div className="lesson-callout success"><RefreshCw className={busy ? 'spin' : ''} size={17}/><p><strong>{stageLabel[stage]}</strong>The Project and remote Draft parameters are being prepared.</p></div>}
    {error && <div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>Environment creation stopped</strong>{error}</p></div>}
    {!status?.available && <div className="cloud-readiness"><Cloud size={17}/><span><strong>Flow360 connection required</strong><small>Connect the local profile before uploading.</small></span></div>}
    <label className="environment-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy}/><span>I confirm the mesh unit is metres and authorize creation of this remote Project and two configured Case Drafts. Boundary semantics still require review before execution.</span></label>
    <button className="environment-create-button" disabled={!canCreate} onClick={() => void create()}>{busy ? <RefreshCw size={16} className="spin"/> : <CheckCircle2 size={16}/>} {busy && stage ? stageLabel[stage] : 'Create Project + 2 Case Drafts'}</button>
  </div>
}
