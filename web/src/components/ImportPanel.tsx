import { AlertCircle, CheckCircle2, FileUp, RefreshCw, X } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { api, type FolderNode, type ImportPlan } from '../api/client'

export default function ImportPanel({ folder, onClose, onCreated }: { folder: FolderNode; onClose: () => void; onCreated: () => void }) {
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState('geometry')
  const [unit, setUnit] = useState('m')
  const [files, setFiles] = useState<FileList | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const stage = async (event: FormEvent) => {
    event.preventDefault(); if (!files?.length) return
    setBusy(true); setError('')
    const form = new FormData()
    form.set('name', name); form.set('source_type', sourceType); form.set('unit', unit)
    form.set('workflow', 'standard'); form.set('folder_id', folder.id)
    Array.from(files).forEach((file) => form.append('files', file))
    try { setPlan(await api.stageImport(form)) } catch (cause) { setError(String(cause).replace('Error: ', '')) } finally { setBusy(false) }
  }

  const execute = async () => {
    if (!plan || !confirmed) return
    if (!window.confirm(`Create Flow360 project “${plan.name}”? Upload and processing may be billable.`)) return
    setBusy(true); setError('')
    try {
      const approved = plan.status === 'draft' ? await api.approveImport(plan.id) : plan
      const submitted = await api.runImport(approved.id); setPlan(submitted)
      if (submitted.status === 'submitted') onCreated()
    } catch (cause) { setError(String(cause).replace('Error: ', '')) } finally { setBusy(false) }
  }

  return <div className="import-overlay"><section className="import-panel" role="dialog" aria-modal="true">
    <header><span><FileUp size={17} /></span><div><strong>Import Flow360 Project</strong><small>{folder.name}</small></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header>
    {!plan ? <form onSubmit={stage}>
      <h2>Stage source files</h2><p>Files stay local until you review and confirm the import.</p>
      <label>Project name<input value={name} onChange={e => setName(e.target.value)} required /></label>
      <div className="import-row"><label>Source type<select value={sourceType} onChange={e => setSourceType(e.target.value)}><option value="geometry">Geometry</option><option value="surface-mesh">Surface Mesh</option><option value="volume-mesh">Volume Mesh</option></select></label><label>Length unit<select value={unit} onChange={e => setUnit(e.target.value)}><option>m</option><option>mm</option><option>cm</option><option>inch</option></select></label></div>
      <label className="import-drop"><FileUp size={20} /><span>{files?.length ? `${files.length} file(s) selected` : 'Choose CAD or mesh files'}</span><input type="file" multiple onChange={e => setFiles(e.target.files)} required /></label>
      {error && <div className="plan-error"><AlertCircle size={14}/>{error}</div>}
      <button className="import-primary" disabled={busy || !name || !files?.length}>{busy ? <RefreshCw className="spin" size={14}/> : <FileUp size={14}/>} Stage & review</button>
    </form> : <div className="import-review">
      <CheckCircle2 size={25}/><h2>{plan.name}</h2><p>{plan.files.join(', ')}</p>
      <dl><div><dt>Source</dt><dd>{plan.source_type}</dd></div><div><dt>Unit</dt><dd>{plan.unit}</dd></div><div><dt>Upload</dt><dd>{(plan.size_bytes/1024/1024).toFixed(2)} MB</dd></div></dl>
      <pre>{plan.command_preview.join(' ')}</pre>
      {plan.error && <div className="plan-error">{plan.error}</div>}{error && <div className="plan-error">{error}</div>}
      {plan.status !== 'submitted' ? <><label className="import-confirm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed the files, units, destination, and billable action.</label><button className="import-execute" onClick={()=>void execute()} disabled={!confirmed||busy}>{busy?<RefreshCw className="spin" size={14}/>:<FileUp size={14}/>} Create in Flow360</button></> : <div className="plan-success">Flow360 accepted the project import.</div>}
    </div>}
  </section></div>
}
