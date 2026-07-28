import { AlertCircle, CheckCircle2, FileUp, RefreshCw, X, ExternalLink, Trash2 } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api, type FolderNode, type ImportPlan, type ImportFileInfo } from '../api/client'
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

export default function ImportPanel({ folder, onClose, onCreated }: { folder: FolderNode; onClose: () => void; onCreated: (plan: ImportPlan) => void }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState('geometry')
  const [unit, setUnit] = useState('m')
  const [unitConfirmed, setUnitConfirmed] = useState(false)
  const [workflow, setWorkflow] = useState('standard')
  const [solverVersion, setSolverVersion] = useState('')
  const [tags, setTags] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<'stage' | 'execute' | 'abort' | null>(null)
  const [error, setError] = useState('')
  const [existingDrafts, setExistingDrafts] = useState<ImportPlan[]>([])
  const panelRef = useFocusTrap(true, onClose, 'input,select,button,textarea')

  const acceptedExtensions = ALLOWED_EXTENSIONS[sourceType]?.join(',') ?? ''

  useEffect(() => {
    const loadDrafts = async () => {
      try {
        const drafts = await api.listImports(folder.id)
        setExistingDrafts(drafts.filter((d) => d.status === 'draft' || d.status === 'failed'))
      } catch {
      }
    }
    loadDrafts()
  }, [folder.id])

  const resumeDraft = async (draft: ImportPlan) => {
    setPlan(draft)
    setConfirmed(draft.unit_confirmed || draft.source_type !== 'geometry')
    setError('')
  }

  const stage = async (event: FormEvent) => {
    event.preventDefault()
    if (!files?.length || busy || submittingAction) return
    const validationError = validateFileNames(Array.from(files, (file) => file.name), sourceType)
    if (validationError) { setError(validationError); return }
    if (sourceType === 'geometry' && !unitConfirmed) { setError('Please confirm the length unit before staging a Geometry import.'); return }
    setBusy(true); setSubmittingAction('stage'); setError('')
    const form = new FormData()
    form.set('name', name)
    form.set('source_type', sourceType)
    form.set('unit', unit)
    form.set('workflow', workflow)
    form.set('folder_id', folder.id)
    if (solverVersion) form.set('solver_version', solverVersion)
    if (tags) form.set('tags', tags)
    Array.from(files).forEach((file) => form.append('files', file))
    try { setPlan(await api.stageImport(form)) } catch (cause) { setError(String(cause).replace('Error: ', '')) } finally { setBusy(false); setSubmittingAction(null) }
  }

  const execute = async () => {
    if (!plan || !confirmed || busy || submittingAction) return
    if (plan.source_type === 'geometry' && !plan.unit_confirmed) { setError('Geometry imports require unit confirmation before execution.'); return }
    if (!window.confirm(`Create Flow360 project "${plan.name}"? Upload and processing may be billable.`)) return
    setBusy(true); setSubmittingAction('execute'); setError('')
    try {
      const approved = plan.status === 'draft' ? await api.approveImport(plan.id) : plan
      const submitted = await api.runImport(approved.id)
      setPlan(submitted)
      if (submitted.status === 'submitted') {
        onCreated(submitted)
      }
    } catch (cause) { setError(String(cause).replace('Error: ', '')) } finally { setBusy(false); setSubmittingAction(null) }
  }

  const abort = async () => {
    if (!plan || plan.status === 'submitted' || submittingAction) return
    setBusy(true); setSubmittingAction('abort'); setError('')
    try {
      await api.abortImport(plan.id)
      setPlan(null)
      setFiles(null)
      setConfirmed(false)
      setExistingDrafts((prev) => prev.filter((d) => d.id !== plan.id))
    } catch (cause) { setError(String(cause).replace('Error: ', '')) } finally { setBusy(false); setSubmittingAction(null) }
  }

  const hasGeometryUnitGate = sourceType === 'geometry' && !unitConfirmed
  const unitGateDisabled = sourceType === 'geometry' && !unitConfirmed

  return <div className="import-overlay" role="presentation">
    <section
      ref={panelRef}
      className="import-panel"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-dialog-title"
    >
      <header>
        <span><FileUp size={17} /></span>
        <div>
          <strong id="import-dialog-title">Import Flow360 Project</strong>
          <small>{folder.name}</small>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close import dialog">
          <X size={18} />
        </button>
      </header>

      {existingDrafts.length > 0 && !plan && (
        <div className="import-drafts">
          <h3>Resume pending imports</h3>
          {existingDrafts.map((draft) => (
            <div key={draft.id} className="import-draft-item">
              <span className="draft-name">{draft.name}</span>
              <span className="draft-meta">{draft.source_type} · {(draft.size_bytes / 1024 / 1024).toFixed(2)} MB · {draft.status}</span>
              <button onClick={() => void resumeDraft(draft)} disabled={busy}>Resume</button>
            </div>
          ))}
        </div>
      )}

      {!plan ? <form onSubmit={stage}>
        <h2>Stage source files</h2>
        <p>Files stay local until you review and confirm the import.</p>
        <label>Project name<input value={name} onChange={e => setName(e.target.value)} required /></label>
        <div className="import-row">
          <label>Source type
            <select value={sourceType} onChange={e => { setSourceType(e.target.value); setWorkflow('standard'); setFiles(null); setUnitConfirmed(false) }}>
              <option value="geometry">{SOURCE_LABELS.geometry}</option>
              <option value="surface-mesh">{SOURCE_LABELS['surface-mesh']}</option>
              <option value="volume-mesh">{SOURCE_LABELS['volume-mesh']}</option>
            </select>
          </label>
          <label>Length unit
            <select value={unit} onChange={e => { setUnit(e.target.value); setUnitConfirmed(false) }}>
              <option value="m">m</option>
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="inch">inch</option>
            </select>
          </label>
        </div>

        {sourceType === 'geometry' && (
          <div className="import-unit-gate">
            <label>
              <input
                type="checkbox"
                checked={unitConfirmed}
                onChange={e => setUnitConfirmed(e.target.checked)}
                disabled={busy}
              />
              I confirm that "{unit}" is the correct length unit for this geometry.
              Importing with the wrong unit will produce incorrect simulation results.
            </label>
          </div>
        )}

        <label className="import-drop">
          <FileUp size={20} />
          <span>{files?.length ? `${files.length} file(s) selected` : `Select files (${ALLOWED_EXTENSIONS[sourceType]?.join(', ')})`}</span>
          <input type="file" multiple accept={acceptedExtensions} onChange={e => setFiles(e.target.files)} required />
        </label>

        <details className="import-advanced">
          <summary>Advanced settings</summary>
          {sourceType === 'geometry' && (
            <label>
              Geometry workflow
              <select value={workflow} onChange={e => setWorkflow(e.target.value)}>
                <option value="standard">Standard</option>
                <option value="catalyst">Catalyst</option>
              </select>
            </label>
          )}
          <label>Solver version (optional)<input value={solverVersion} onChange={e => setSolverVersion(e.target.value)} placeholder="e.g. 2024R1" /></label>
          <label>Tags (optional, comma-separated)<input value={tags} onChange={e => setTags(e.target.value)} placeholder="e.g. baseline, wind-tunnel" /></label>
        </details>

        {error && <div className="plan-error"><AlertCircle size={14}/>{error}</div>}
        <button
          className="import-primary"
          disabled={busy || !!submittingAction || !name || !files?.length || unitGateDisabled}
          type="submit"
        >
          {busy && submittingAction === 'stage'
            ? <RefreshCw className="spin" size={14}/>
            : <FileUp size={14}/>} Stage & review
        </button>
      </form> : <div className="import-review">
        <CheckCircle2 size={25}/>
        <h2>{plan.name}</h2>
        <p>{plan.files.map((f: ImportFileInfo) => `${f.name} (${(f.size_bytes / 1024 / 1024).toFixed(2)} MB, ${f.hash.slice(0, 12)}...)`).join(', ')}</p>
        <dl>
          <div><dt>Source</dt><dd>{plan.source_type}</dd></div>
          <div><dt>Unit</dt><dd>{plan.unit}</dd></div>
          {plan.source_type === 'geometry' && <div><dt>Workflow</dt><dd>{plan.workflow || 'standard'}</dd></div>}
          <div><dt>Solver version</dt><dd>{plan.solver_version || 'Default'}</dd></div>
          <div><dt>Destination</dt><dd>{folder.name} · {plan.folder_id || folder.id}</dd></div>
          <div><dt>Tags</dt><dd>{plan.tags?.length ? plan.tags.join(', ') : 'None'}</dd></div>
          <div><dt>Upload</dt><dd>{(plan.size_bytes / 1024 / 1024).toFixed(2)} MB</dd></div>
          <div><dt>Content hash</dt><dd className="hash-preview">{plan.content_hash.slice(0, 16)}...</dd></div>
        </dl>
        <pre>{plan.command_preview.join(' ')}</pre>
        {plan.error && <div className="plan-error">{plan.error}</div>}
        {error && <div className="plan-error">{error}</div>}

        {plan.status !== 'submitted' && plan.status !== 'running' ? (
          <>
            <label className="import-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy || !!submittingAction}
              />
              I reviewed the files, units, destination, and billable action.
            </label>
            <div className="import-actions">
              <button
                className="import-abort"
                onClick={() => void abort()}
                disabled={busy || !!submittingAction}
                title="Discard this import"
              >
                {busy && submittingAction === 'abort' ? <RefreshCw className="spin" size={14}/> : <Trash2 size={14}/>}
                Discard
              </button>
              <button
                className="import-execute"
                onClick={() => void execute()}
                disabled={!confirmed || busy || !!submittingAction || (plan.source_type === 'geometry' && !plan.unit_confirmed)}
              >
                {busy && submittingAction === 'execute'
                  ? <RefreshCw className="spin" size={14}/>
                  : <FileUp size={14}/>} Create in Flow360
              </button>
            </div>
          </>
        ) : plan.status === 'submitted' ? (
          <div className="plan-success">
            <p>Flow360 accepted the project import.</p>
            {plan.result && (
              <button
                className="import-nav-link"
                onClick={() => {
                  const projectId = (plan.result as Record<string, unknown>)?.project_id as string | undefined
                  if (projectId) window.open(`/projects/${encodeURIComponent(projectId)}`, '_blank')
                }}
              >
                Open project <ExternalLink size={14}/>
              </button>
            )}
          </div>
        ) : (
          <div className="plan-status-running">
            <RefreshCw className="spin" size={16}/>
            <span>Processing import...</span>
          </div>
        )}
      </div>}
    </section>
  </div>
}
