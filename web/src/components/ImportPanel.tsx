import { AlertCircle, CheckCircle2, Database, FileUp, RefreshCw, X, ExternalLink, Trash2 } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import { api, type FolderNode, type ImportPlan, type ImportFileInfo, type STEPAsset, type STEPProjectResult, type STEPVersion } from '../api/client'
import { useI18n } from '../i18n'
import { useFocusTrap } from '../lib/useFocusTrap'
import Flow360ConfirmationDialog from './Flow360ConfirmationDialog'

const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  geometry: ['.step', '.stp', '.igs', '.iges', '.brep', '.csm', '.cax', '.catpart', '.catproduct'],
  'surface-mesh': ['.cgns', '.dat', '.key', '.k', '.msh', '.nas', '.bdf', '.inp', '.vtk', '.vtu'],
  'volume-mesh': ['.cgns', '.dat', '.key', '.k', '.msh', '.nas', '.bdf', '.inp', '.vtk', '.vtu'],
}

const SOURCE_LABELS: Record<string, string> = {
  geometry: 'Geometry (CSM, STEP, IGES, BREP, CATIA)',
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

export type ReadySTEPChoice = { asset: STEPAsset; version: STEPVersion }

export function readySTEPChoices(assets: STEPAsset[]): ReadySTEPChoice[] {
  return assets.flatMap((asset) => [...asset.versions]
    .reverse()
    .filter((version) => version.validation.status === 'ready')
    .map((version) => ({ asset, version })))
}

export default function ImportPanel({ folder, onClose, onCreated, onSTEPProjectCreated }: {
  folder: FolderNode
  onClose: () => void
  onCreated: (plan: ImportPlan) => void
  onSTEPProjectCreated: (result: STEPProjectResult) => void
}) {
  const { t } = useI18n()
  const [plan, setPlan] = useState<ImportPlan | null>(null)
  const [sourceMode, setSourceMode] = useState<'upload' | 'step-library'>('upload')
  const [name, setName] = useState('')
  const [sourceType, setSourceType] = useState('geometry')
  const [unit, setUnit] = useState('m')
  const [workflow, setWorkflow] = useState('standard')
  const [solverVersion, setSolverVersion] = useState('')
  const [tags, setTags] = useState('')
  const [files, setFiles] = useState<FileList | null>(null)
  const [stepAssets, setSTEPAssets] = useState<STEPAsset[]>([])
  const [selectedSTEPKey, setSelectedSTEPKey] = useState('')
  const [stepAssetsLoading, setSTEPAssetsLoading] = useState(false)
  const [stepAssetsError, setSTEPAssetsError] = useState('')
  const [stepReview, setSTEPReview] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [submittingAction, setSubmittingAction] = useState<'stage' | 'execute' | 'step-create' | 'abort' | null>(null)
  const [error, setError] = useState('')
  const [existingDrafts, setExistingDrafts] = useState<ImportPlan[]>([])
  const [executeConfirmationOpen, setExecuteConfirmationOpen] = useState(false)
  const panelRef = useFocusTrap(true, onClose, 'input,select,button,textarea')

  const acceptedExtensions = ALLOWED_EXTENSIONS[sourceType]?.join(',') ?? ''
  const stepChoices = useMemo(() => readySTEPChoices(stepAssets), [stepAssets])
  const selectedSTEP = useMemo(() => stepChoices.find(({ asset, version }) => `${asset.id}:${version.id}` === selectedSTEPKey) ?? null, [stepChoices, selectedSTEPKey])

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

  useEffect(() => {
    if (sourceMode !== 'step-library' || stepAssets.length > 0 || stepAssetsLoading) return
    let active = true
    setSTEPAssetsLoading(true)
    setSTEPAssetsError('')
    api.stepAssets().then((response) => {
      if (!active) return
      const choices = readySTEPChoices(response.assets)
      setSTEPAssets(response.assets)
      setSelectedSTEPKey((current) => choices.some(({ asset, version }) => `${asset.id}:${version.id}` === current)
        ? current
        : choices[0] ? `${choices[0].asset.id}:${choices[0].version.id}` : '')
      setName((current) => current.trim() || choices[0]?.asset.name || '')
    }).catch((cause) => {
      if (active) setSTEPAssetsError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (active) setSTEPAssetsLoading(false)
    })
    return () => { active = false }
  }, [sourceMode, stepAssets.length])

  const chooseSourceMode = (mode: typeof sourceMode) => {
    setSourceMode(mode)
    if (mode === 'step-library' && stepChoices[0]) {
      setSelectedSTEPKey((current) => current || `${stepChoices[0].asset.id}:${stepChoices[0].version.id}`)
      setName((current) => current.trim() || stepChoices[0].asset.name)
    }
    setFiles(null)
    setSTEPReview(false)
    setConfirmed(false)
    setExecuteConfirmationOpen(false)
    setError('')
  }

  const resumeDraft = async (draft: ImportPlan) => {
    setPlan(draft)
    setConfirmed(false)
    setExecuteConfirmationOpen(false)
    setError('')
  }

  const stage = async (event: FormEvent) => {
    event.preventDefault()
    if (!files?.length || busy || submittingAction) return
    const validationError = validateFileNames(Array.from(files, (file) => file.name), sourceType)
    if (validationError) { setError(validationError); return }
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

  const reviewSTEP = (event: FormEvent) => {
    event.preventDefault()
    if (!selectedSTEP || !name.trim() || busy || submittingAction) return
    setConfirmed(false)
    setError('')
    setSTEPReview(true)
  }

  const requestExecute = () => {
    if ((!plan && !stepReview) || !confirmed || busy || submittingAction) return
    setExecuteConfirmationOpen(true)
  }

  const execute = async () => {
    if (!plan || busy || submittingAction) return
    setExecuteConfirmationOpen(false)
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

  const executeSTEP = async () => {
    if (!selectedSTEP || busy || submittingAction) return
    setExecuteConfirmationOpen(false)
    setBusy(true); setSubmittingAction('step-create'); setError('')
    try {
      onSTEPProjectCreated(await api.createProjectFromSTEP(
        selectedSTEP.asset.id,
        selectedSTEP.version.id,
        folder.id,
        name.trim(),
      ))
    } catch (cause) { setError(String(cause).replace('Error: ', ''))
    } finally { setBusy(false); setSubmittingAction(null) }
  }

  const abort = async () => {
    if (!plan || plan.status === 'submitted' || submittingAction) return
    setBusy(true); setSubmittingAction('abort'); setError('')
    try {
      await api.abortImport(plan.id)
      setPlan(null)
      setFiles(null)
      setConfirmed(false)
      setExecuteConfirmationOpen(false)
      setExistingDrafts((prev) => prev.filter((d) => d.id !== plan.id))
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
      <header>
        <span>{sourceMode === 'upload' ? <FileUp size={17} /> : <Database size={17} />}</span>
        <div>
          <strong id="import-dialog-title">Import Flow360 Project</strong>
          <small>{folder.name}</small>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close import dialog">
          <X size={18} />
        </button>
      </header>

      {existingDrafts.length > 0 && !plan && !stepReview && (
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

      {!plan && !stepReview ? <form onSubmit={sourceMode === 'upload' ? stage : reviewSTEP}>
        <h2>{t(sourceMode === 'upload' ? 'Stage source files' : 'Choose STEP geometry')}</h2>
        <p>{t(sourceMode === 'upload' ? 'Files stay local until you review and confirm the import.' : 'Use an exact STEP version already validated in the local geometry library.')}</p>
        <div className="import-source-tabs" role="tablist" aria-label={t('Project source method')}>
          <button type="button" role="tab" aria-selected={sourceMode === 'upload'} className={sourceMode === 'upload' ? 'active' : ''} onClick={() => chooseSourceMode('upload')}><FileUp size={14} /> {t('Upload files')}</button>
          <button type="button" role="tab" aria-selected={sourceMode === 'step-library'} className={sourceMode === 'step-library' ? 'active' : ''} onClick={() => chooseSourceMode('step-library')}><Database size={14} /> {t('STEP geometry library')}</button>
        </div>
        <label>Project name<input value={name} onChange={e => setName(e.target.value)} required /></label>
        {sourceMode === 'upload' ? <>
          <div className="import-row">
            <label>Source type
              <select value={sourceType} onChange={e => { setSourceType(e.target.value); setWorkflow('standard'); setFiles(null) }}>
                <option value="geometry">{SOURCE_LABELS.geometry}</option>
                <option value="surface-mesh">{SOURCE_LABELS['surface-mesh']}</option>
                <option value="volume-mesh">{SOURCE_LABELS['volume-mesh']}</option>
              </select>
            </label>
            <label>Length unit
              <select value={unit} onChange={e => setUnit(e.target.value)}>
                <option value="m">m</option>
                <option value="mm">mm</option>
                <option value="cm">cm</option>
                <option value="inch">inch</option>
              </select>
            </label>
          </div>

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
        </> : <section className="import-step-library">
          <header><Database size={16} /><span><strong>{t('Validated STEP geometry')}</strong><small>{t('Geometry type and length unit come from the selected immutable version.')}</small></span></header>
          {stepAssetsLoading && <div className="import-step-state"><RefreshCw className="spin" size={15} /> {t('Loading STEP geometry library…')}</div>}
          {!stepAssetsLoading && stepAssetsError && <div className="import-step-state error"><AlertCircle size={15} /> {t(stepAssetsError)}</div>}
          {!stepAssetsLoading && !stepAssetsError && stepChoices.length === 0 && <div className="import-step-state empty"><Database size={18} /><span><strong>{t('No validated STEP versions are available.')}</strong><small>{t('Open the STEP geometry library to upload or validate an asset first.')}</small></span><a href="/step-library">{t('Open STEP library')} <ExternalLink size={12} /></a></div>}
          {stepChoices.length > 0 && <div className="import-step-choices" role="radiogroup" aria-label={t('Validated STEP versions')}>{stepChoices.map(({ asset, version }) => {
            const key = `${asset.id}:${version.id}`
            return <button type="button" role="radio" aria-checked={selectedSTEPKey === key} className={selectedSTEPKey === key ? 'active' : ''} key={key} onClick={() => { setSelectedSTEPKey(key); setName((current) => !current.trim() || stepChoices.some((choice) => choice.asset.name === current) ? asset.name : current) }}>
              <img src={api.stepVersionThumbnailURL(asset.id, version.id)} alt="" />
              <span><strong>{asset.name}</strong><small>V{version.number} · {version.file_name}</small><em>{t('Geometry')} · {version.unit} · {t('Ready')}</em></span>
              <CheckCircle2 size={15} />
            </button>
          })}</div>}
        </section>}

        {error && <div className="plan-error"><AlertCircle size={14}/>{error}</div>}
        <button
          className="import-primary"
          disabled={busy || !!submittingAction || !name || (sourceMode === 'upload' ? !files?.length : !selectedSTEP)}
          type="submit"
        >
          {busy && submittingAction === 'stage'
            ? <RefreshCw className="spin" size={14}/>
            : sourceMode === 'upload' ? <FileUp size={14}/> : <CheckCircle2 size={14}/>} {t(sourceMode === 'upload' ? 'Stage & review' : 'Review project')}
        </button>
      </form> : stepReview && selectedSTEP ? <div className="import-review">
        <CheckCircle2 size={25}/>
        <h2>{name}</h2>
        <p>{selectedSTEP.asset.name} · V{selectedSTEP.version.number} · {selectedSTEP.version.file_name}</p>
        <dl>
          <div><dt>{t('Source')}</dt><dd>{t('STEP geometry library')}</dd></div>
          <div><dt>{t('Source type')}</dt><dd>{t('Geometry')}</dd></div>
          <div><dt>{t('Version')}</dt><dd>V{selectedSTEP.version.number} · {selectedSTEP.version.id}</dd></div>
          <div><dt>{t('Unit')}</dt><dd>{selectedSTEP.version.unit}</dd></div>
          <div><dt>{t('Validation')}</dt><dd>{t('Ready')} · {selectedSTEP.version.validation.report?.kernel || 'OpenCascade'}</dd></div>
          <div><dt>{t('Destination')}</dt><dd>{folder.name} · {folder.id}</dd></div>
        </dl>
        {error && <div className="plan-error"><AlertCircle size={14}/>{error}</div>}
        <label className="import-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy || !!submittingAction} />{t('I reviewed the STEP version, unit, destination, and billable action.')}</label>
        <div className="import-actions">
          <button className="import-abort" type="button" onClick={() => { setSTEPReview(false); setConfirmed(false); setExecuteConfirmationOpen(false); setError('') }} disabled={busy || !!submittingAction}>{t('Back')}</button>
          <button className="import-execute" type="button" onClick={requestExecute} disabled={!confirmed || busy || !!submittingAction}>{busy && submittingAction === 'step-create' ? <RefreshCw className="spin" size={14}/> : <Database size={14}/>} {t('Create in Flow360')}</button>
        </div>
        <Flow360ConfirmationDialog
          open={executeConfirmationOpen}
          eyebrow="Flow360 · Project creation"
          title={t('Create this Flow360 project?')}
          description={t('The selected validated STEP version will be submitted directly from the local geometry library.')}
          targetLabel={t('Reviewed STEP geometry')}
          targetName={name}
          details={[
            { label: t('Source'), value: `${selectedSTEP.asset.name} · V${selectedSTEP.version.number}` },
            { label: t('Unit'), value: selectedSTEP.version.unit },
            { label: t('Destination'), value: folder.name },
          ]}
          risk={t('Creating and processing this Geometry Project may create billable Flow360 resources. Closing this dialog keeps the STEP asset unchanged.')}
          confirmLabel={t('Create in Flow360')}
          busy={busy && submittingAction === 'step-create'}
          onCancel={() => setExecuteConfirmationOpen(false)}
          onConfirm={() => void executeSTEP()}
        />
      </div> : plan && <div className="import-review">
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
                onClick={requestExecute}
                disabled={!confirmed || busy || !!submittingAction}
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
        <Flow360ConfirmationDialog
          open={executeConfirmationOpen}
          eyebrow="Flow360 · Project creation"
          title="Create this Flow360 project?"
          description="This is the final handoff from local staging to Flow360. The reviewed files and import settings below will be submitted."
          targetLabel="Reviewed project import"
          targetName={plan.name}
          details={[
            { label: 'Source', value: SOURCE_LABELS[plan.source_type]?.split(' (')[0] ?? plan.source_type },
            { label: 'Destination', value: folder.name },
            { label: 'Upload', value: `${(plan.size_bytes / 1024 / 1024).toFixed(2)} MB` },
          ]}
          risk="Uploading and processing these files may create billable Flow360 resources. Closing this dialog keeps the staged files local."
          confirmLabel="Create in Flow360"
          busy={busy && submittingAction === 'execute'}
          onCancel={() => setExecuteConfirmationOpen(false)}
          onConfirm={() => void execute()}
        />
      </div>}
    </section>
  </div>
}
