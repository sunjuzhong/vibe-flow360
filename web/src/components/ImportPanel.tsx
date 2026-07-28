import { AlertCircle, CheckCircle2, FileUp, RefreshCw, X } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api, type FolderNode, type ImportPlan } from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'

const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  geometry: ['.step', '.stp', '.igs', '.iges', '.brep', '.cax', '.catpart', '.catproduct'],
  'surface-mesh': ['.cgns', '.dat', '.key', '.k', '.msh', '.nas', '.bdf', '.inp', '.vtk', '.vtu'],
  'volume-mesh': ['.cgns', '.dat', '.key', '.k', '.msh', '.nas', '.bdf', '.inp', '.vtk', '.vtu'],
}

const SOURCE_LABELS: Record<string, string> = {
  geometry: 'Geometry (STEP, IGES, BREP, CATIA)',
  'surface-mesh': 'Surface Mesh (CGNS, NASTRAN, Abaqus, SU2)',
  'volume-mesh': 'Volume Mesh (CGNS, NASTRAN, Abaqus, SU2)',
}

export function validateFileNames(fileNames: string[], sourceType: string): string | null {
  const allowed = ALLOWED_EXTENSIONS[sourceType] ?? []
  const invalid: string[] = []
  fileNames.forEach((fileName) => {
    const nameLower = fileName.toLowerCase()
    const dotIdx = nameLower.lastIndexOf('.')
    const ext = dotIdx >= 0 ? nameLower.substring(dotIdx) : ''
    if (!ext || !allowed.includes(ext)) {
      invalid.push(fileName)
    }
  })
  if (invalid.length > 0) {
    return `Unsupported file type(s): ${invalid.join(', ')}. Allowed extensions: ${allowed.join(', ')}`
  }
  return null
}

export default function ImportPanel({ folder, onClose, onCreated }: { folder: FolderNode; onClose: () => void; onCreated: () => void }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState('geometry')
  const [unit, setUnit] = useState('m')
  const [workflow, setWorkflow] = useState('standard')
  const [solverVersion, setSolverVersion] = useState('')
  const [tags, setTags] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<'stage' | 'execute' | null>(null)
  const [error, setError] = useState('')
  const panelRef = useFocusTrap(true, onClose, 'input,select,button,textarea')

  const acceptedExtensions = ALLOWED_EXTENSIONS[sourceType]?.join(',') ?? ''

  const stage = async (event: FormEvent) => {
    event.preventDefault()
    if (!files?.length || busy || submittingAction) return
    const validationError = validateFileNames(Array.from(files, (file) => file.name), sourceType)
    if (validationError) { setError(validationError); return }
    setBusy(true); setSubmittingAction('stage'); setError('')
    const form = new FormData()
    form.set('name', name); form.set('source_type', sourceType); form.set('unit', unit)
    form.set('workflow', workflow); form.set('folder_id', folder.id)
    if (solverVersion) form.set('solver_version', solverVersion)
    if (tags) form.set('tags', tags)
    Array.from(files).forEach((file) => form.append('files', file))
    try { setPlan(await api.stageImport(form)) } catch (cause) { setError(String(cause).replace('Error: ', '')) } finally { setBusy(false); setSubmittingAction(null) }
  }

  const execute = async () => {
    if (!plan || !confirmed || busy || submittingAction) return
    if (!window.confirm(`Create Flow360 project "${plan.name}"? Upload and processing may be billable.`)) return
    setBusy(true); setSubmittingAction('execute'); setError('')
    try {
      const approved = plan.status === 'draft' ? await api.approveImport(plan.id) : plan
      const submitted = await api.runImport(approved.id); setPlan(submitted)
      if (submitted.status === 'submitted') onCreated()
    } catch (cause) { setError(String(cause).replace('Error: ', '')) } finally { setBusy(false); setSubmittingAction(null) }
  }

  return <div className="import-overlay" role="presentation">
    <section
      ref={panelRef}
      className="import-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
    >
    <header><span><FileUp size={17} /></span><div><strong id="import-dialog-title">Import Flow360 Project</strong><small>{folder.name}</small></div><button className="icon-button" onClick={onClose} aria-label="Close import dialog"><X size={18} /></button></header>
    {!plan ? <form onSubmit={stage}>
      <h2>Stage source files</h2><p>Files stay local until you review and confirm the import.</p>
      <label>Project name<input value={name} onChange={e => setName(e.target.value)} required /></label>
      <div className="import-row"><label>Source type<select value={sourceType} onChange={e => { setSourceType(e.target.value); setWorkflow('standard'); setFiles(null) }}><option value="geometry">{SOURCE_LABELS.geometry}</option><option value="surface-mesh">{SOURCE_LABELS['surface-mesh']}</option><option value="volume-mesh">{SOURCE_LABELS['volume-mesh']}</option></select></label><label>Length unit<select value={unit} onChange={e => setUnit(e.target.value)}><option>m</option><option>mm</option><option>cm</option><option>inch</option></select></label></div>
      <label className="import-drop"><FileUp size={20} /><span>{files?.length ? `${files.length} file(s) selected` : `Select files (${ALLOWED_EXTENSIONS[sourceType]?.join(', ')})`}</span><input type="file" multiple accept={acceptedExtensions} onChange={e => setFiles(e.target.files)} required /></label>
      <details className="import-advanced">
        <summary>Advanced settings</summary>
        {sourceType === 'geometry' && <label>Geometry workflow<select value={workflow} onChange={e => setWorkflow(e.target.value)}><option value="standard">Standard</option><option value="catalyst">Catalyst</option></select></label>}
        <label>Solver version (optional)<input value={solverVersion} onChange={e => setSolverVersion(e.target.value)} placeholder="e.g. 2024R1" /></label>
        <label>Tags (optional, comma-separated)<input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. baseline, wind-tunnel" /></label>
      </details>
      {error && <div className="plan-error"><AlertCircle size={14}/>{error}</div>}
      <button
        className="import-primary"
        disabled={busy || !!submittingAction || !name || !files?.length}
        type="submit"
      >
        {busy && submittingAction === 'stage'
          ? <RefreshCw className="spin" size={14}/>
          : <FileUp size={14}/>} Stage & review
      </button>
    </form> : <div className="import-review">
      <CheckCircle2 size={25}/><h2>{plan.name}</h2><p>{plan.files.join(', ')}</p>
      <dl>
        <div><dt>Source</dt><dd>{plan.source_type}</dd></div>
        <div><dt>Unit</dt><dd>{plan.unit}</dd></div>
        {plan.source_type === 'geometry' && <div><dt>Workflow</dt><dd>{plan.workflow || 'standard'}</dd></div>}
        <div><dt>Solver version</dt><dd>{plan.solver_version || 'Default'}</dd></div>
        <div><dt>Destination</dt><dd>{folder.name} · {plan.folder_id || folder.id}</dd></div>
        <div><dt>Tags</dt><dd>{plan.tags?.length ? plan.tags.join(', ') : 'None'}</dd></div>
        <div><dt>Upload</dt><dd>{(plan.size_bytes/1024/1024).toFixed(2)} MB</dd></div>
      </dl>
      <pre>{plan.command_preview.join(' ')}</pre>
      {plan.error && <div className="plan-error">{plan.error}</div>}{error && <div className="plan-error">{error}</div>}
      {plan.status !== 'submitted' ? (
        <>
          <label className="import-confirm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={busy || !!submittingAction} />
            I reviewed the files, units, destination, and billable action.
          </label>
          <button
            className="import-execute"
            onClick={() => void execute()}
            disabled={!confirmed || busy || !!submittingAction}
          >
            {busy && submittingAction === 'execute'
              ? <RefreshCw className="spin" size={14}/>
              : <FileUp size={14}/>} Create in Flow360
          </button>
        </>
      ) : <div className="plan-success">Flow360 accepted the project import.</div>}
    </div>}
  </section></div>
}
