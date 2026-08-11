import { Box, CheckCircle2, Download, FileUp, FolderInput, FolderOpen, Loader2, Plus, RefreshCw, Sparkles, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, type FolderNode, type STEPAIJob, type STEPAsset, type STEPPreviewManifest, type STEPProjectResult, type STEPVersion } from '../api/client'
import { useI18n } from '../i18n'
import FolderTree from './FolderTree'
import { LazyViewer3D } from './viewer/LazyViewer3D'
import './STEPLibraryModal.css'

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function StatusIcon({ version }: { version: STEPVersion }) {
  if (version.validation.status === 'ready') return <CheckCircle2 size={14} />
  if (version.validation.status === 'blocked') return <XCircle size={14} />
  return <Loader2 className="spin" size={14} />
}

type FolderAction = { mode: 'create' | 'rename' | 'move' | 'delete' | 'move-asset'; folder?: FolderNode }

function flattenFolders(root: FolderNode, excludedId = ''): FolderNode[] {
  if (root.id === excludedId) return []
  return [root, ...root.subfolders.flatMap((folder) => flattenFolders(folder, excludedId))]
}

function findFolder(root: FolderNode | null, id: string): FolderNode | null {
  if (!root) return null
  if (root.id === id) return root
  for (const child of root.subfolders) {
    const found = findFolder(child, id)
    if (found) return found
  }
  return null
}

export default function STEPLibraryModal({ folder = null, onClose, onCreated, onUseInAICreate, embedded = false }: {
  folder?: FolderNode | null
  onClose?: () => void
  onCreated?: (result: STEPProjectResult) => void
  onUseInAICreate?: (source: { asset_id: string; version_id: string; label: string }) => void
  embedded?: boolean
}) {
  const { t } = useI18n()
  const [assets, setAssets] = useState<STEPAsset[]>([])
  const [folderRoot, setFolderRoot] = useState<FolderNode | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState('step-root')
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderTargetId, setFolderTargetId] = useState('step-root')
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creationMode, setCreationMode] = useState<'upload-new' | 'upload-version' | 'ai-new' | 'ai-revise'>('upload-new')
  const [creationDialogOpen, setCreationDialogOpen] = useState(false)
  const [assetName, setAssetName] = useState('')
  const [description, setDescription] = useState('')
  const [unit, setUnit] = useState<'m' | 'mm' | 'cm' | 'inch'>('m')
  const [file, setFile] = useState<File | null>(null)
  const [aiPrompt, setAIPrompt] = useState('')
  const [aiJob, setAIJob] = useState<STEPAIJob | null>(null)
  const [compareVersionId, setCompareVersionId] = useState('')
  const [preview, setPreview] = useState<STEPPreviewManifest | null>(null)
  const [previewError, setPreviewError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  )
  const folderAssets = useMemo(() => assets.filter((asset) => (asset.folder_id || 'step-root') === selectedFolderId), [assets, selectedFolderId])
  const selectedLocalFolder = useMemo(() => findFolder(folderRoot, selectedFolderId), [folderRoot, selectedFolderId])
  const selectedVersion = useMemo(() => selectedAsset?.versions.find((version) => version.id === selectedVersionId)
    ?? selectedAsset?.versions.at(-1) ?? null, [selectedAsset, selectedVersionId])

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await api.stepAssets()
      setAssets(response.assets)
      setFolderRoot(response.folder_root)
      setSelectedFolderId((current) => findFolder(response.folder_root, current) ? current : response.folder_root.id)
      setSelectedAssetId((current) => response.assets.some((asset) => asset.id === current) ? current : '')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (selectedAsset && (selectedAsset.folder_id || 'step-root') === selectedFolderId) return
    const next = folderAssets[0]
    setSelectedAssetId(next?.id ?? '')
    setSelectedVersionId(next?.versions.at(-1)?.id ?? '')
  }, [selectedFolderId, folderAssets, selectedAsset])
  const validating = assets.some((asset) => asset.versions.some((version) => version.validation.status === 'validating'))
  useEffect(() => {
    if (!validating) return
    const timer = window.setInterval(() => { void load(true) }, 1500)
    return () => window.clearInterval(timer)
  }, [validating])
  useEffect(() => {
    if (selectedAsset && !selectedAsset.versions.some((version) => version.id === selectedVersionId)) {
      setSelectedVersionId(selectedAsset.versions.at(-1)?.id ?? '')
    }
    if (compareVersionId === selectedVersionId || (compareVersionId && !selectedAsset?.versions.some((version) => version.id === compareVersionId))) {
      setCompareVersionId('')
    }
  }, [selectedAsset, selectedVersionId, compareVersionId])

  useEffect(() => {
    if (!selectedAsset || !selectedVersion || selectedVersion.validation.status !== 'ready') { setPreview(null); return }
    let active = true
    setPreview(null); setPreviewError('')
    api.stepVersionPreview(selectedAsset.id, selectedVersion.id, compareVersionId || undefined)
      .then((value) => { if (active) setPreview(value) })
      .catch((cause) => { if (active) setPreviewError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [selectedAsset?.id, selectedVersion?.id, selectedVersion?.validation.status, compareVersionId])

  useEffect(() => {
    if (!aiJob || !['queued', 'running', 'recovering'].includes(aiJob.status)) return
    const timer = window.setInterval(async () => {
      try {
        const current = await api.stepAIJob(aiJob.id)
        setAIJob(current)
        if (current.status === 'completed') {
          setSelectedAssetId(current.asset_id ?? '')
          setSelectedVersionId(current.version_id ?? '')
          setAIPrompt('')
          await load(true)
        } else if (current.status === 'failed' || current.status === 'needs_input') {
          setError(current.error || current.detail || 'AI STEP generation needs attention.')
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }, 1200)
    return () => window.clearInterval(timer)
  }, [aiJob?.id, aiJob?.status])

  const upload = async (event: FormEvent) => {
    event.preventDefault()
    if (!file || (creationMode === 'upload-new' && !assetName.trim())) return
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.set('file', file); form.set('unit', unit)
      if (creationMode === 'upload-new') {
        form.set('name', assetName.trim()); form.set('description', description.trim()); form.set('folder_id', selectedFolderId)
      } else if (selectedVersion) form.set('parent_version_id', selectedVersion.id)
      const response = await api.uploadSTEPAsset(form, creationMode === 'upload-version' ? selectedAsset?.id : undefined)
      setSelectedAssetId(response.asset.id); setSelectedVersionId(response.version.id)
      setFile(null); setAssetName(''); setDescription('')
      if (fileInput.current) fileInput.current.value = ''
      await load(true)
      if (embedded) setCreationDialogOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const startAIDesign = async () => {
    if (!aiPrompt.trim()) return
    setBusy(true); setError('')
    try {
      const revise = creationMode === 'ai-revise' && selectedAsset && selectedVersion
      const job = await api.aiDesignSTEPAsset({
        prompt: aiPrompt.trim(), name: creationMode === 'ai-new' ? assetName.trim() || undefined : undefined,
        asset_id: revise ? selectedAsset.id : undefined, parent_version_id: revise ? selectedVersion.id : undefined,
        folder_id: creationMode === 'ai-new' ? selectedFolderId : undefined,
      })
      setAIJob(job)
      if (embedded) setCreationDialogOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const designWithAI = (event: FormEvent) => {
    event.preventDefault()
    void startAIDesign()
  }

  const cancelAIDesign = async () => {
    if (!aiJob) return
    try { setAIJob(await api.cancelStepAIJob(aiJob.id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  const createProject = async () => {
    if (!selectedAsset || !selectedVersion || !folder || !onCreated) return
    setBusy(true); setError('')
    try { onCreated(await api.createProjectFromSTEP(selectedAsset.id, selectedVersion.id, folder.id, selectedAsset.name))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const revalidate = async () => {
    if (!selectedAsset || !selectedVersion) return
    setBusy(true); setError('')
    try { await api.validateSTEPVersion(selectedAsset.id, selectedVersion.id); await load(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const openFolderAction = (action: FolderAction) => {
    setFolderAction(action)
    setFolderName(action.mode === 'rename' ? action.folder?.name ?? '' : '')
    setFolderTargetId(action.mode === 'create' ? action.folder?.id ?? folderRoot?.id ?? 'step-root' : folderRoot?.id ?? 'step-root')
  }

  const submitFolderAction = async (event: FormEvent) => {
    event.preventDefault()
    if (!folderAction || !folderRoot) return
    setBusy(true); setError('')
    try {
      if (folderAction.mode === 'create') await api.createSTEPFolder(folderName.trim(), folderTargetId)
      if (folderAction.mode === 'rename' && folderAction.folder) await api.renameSTEPFolder(folderAction.folder.id, folderName.trim())
      if (folderAction.mode === 'move' && folderAction.folder) await api.moveSTEPFolder(folderAction.folder.id, folderTargetId)
      if (folderAction.mode === 'delete' && folderAction.folder) {
        await api.deleteSTEPFolder(folderAction.folder.id)
        if (selectedFolderId === folderAction.folder.id) setSelectedFolderId(folderRoot.id)
      }
      if (folderAction.mode === 'move-asset' && selectedAsset) {
        await api.moveSTEPAsset(selectedAsset.id, folderTargetId)
        setSelectedFolderId(folderTargetId)
      }
      setFolderAction(null)
      await load(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  const uploadMode = creationMode === 'upload-new' || creationMode === 'upload-version'
  const aiMode = creationMode === 'ai-new' || creationMode === 'ai-revise'
  const chooseCreationMode = (mode: typeof creationMode) => {
    setCreationMode(mode)
    if (embedded) setCreationDialogOpen(true)
  }
  const creationTitle = creationMode === 'upload-new' ? 'Upload STEP asset'
    : creationMode === 'upload-version' ? `Upload version to ${selectedAsset?.name}`
      : creationMode === 'ai-revise' ? `AI revise ${selectedAsset?.name}` : 'Create STEP with AI'
  const creationForm = <>
    {uploadMode && <form className="step-library-create" onSubmit={upload}>
      <div><strong>{creationMode === 'upload-new' ? 'Add an existing STEP file' : `Add version to ${selectedAsset?.name}`}</strong><small>Stored independently; downloading it later is optional.</small></div>
      {creationMode === 'upload-new' && <input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Asset name" aria-label="STEP asset name" />}
      {creationMode === 'upload-new' && <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" aria-label="STEP asset description" />}
      <label className="step-library-file"><FileUp size={14} /><span>{file?.name || 'Choose .step or .stp'}</span><input ref={fileInput} type="file" accept=".step,.stp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <select value={unit} onChange={(event) => setUnit(event.target.value as typeof unit)} aria-label="STEP length unit"><option value="m">metres</option><option value="mm">millimetres</option><option value="cm">centimetres</option><option value="inch">inches</option></select>
      <button type="submit" disabled={busy || !file || (creationMode === 'upload-new' && !assetName.trim())}>{busy ? <Loader2 className="spin" size={13} /> : <FileUp size={13} />} Store and validate</button>
    </form>}
    {aiMode && <form className="step-library-ai" onSubmit={designWithAI}>
      <div><strong>{creationMode === 'ai-revise' ? `Create a new version of ${selectedAsset?.name}` : 'Create exact STEP with AI'}</strong><small>OpenCascade must validate the exact CAD before it is ready.</small></div>
      {creationMode === 'ai-new' && <input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Asset name (optional)" aria-label="STEP asset name" />}
      <textarea value={aiPrompt} onChange={(event) => setAIPrompt(event.target.value)} placeholder={creationMode === 'ai-revise' ? 'Describe only the change, e.g. increase the chord by 10%…' : 'Describe the geometry and defining dimensions…'} rows={5} />
      <button type="submit" disabled={busy || !aiPrompt.trim()}>{busy ? <Loader2 className="spin" size={13} /> : <Sparkles size={13} />} {creationMode === 'ai-revise' ? 'Generate new version' : 'Generate STEP asset'}</button>
    </form>}
  </>

  return <div className={embedded ? 'step-library-embedded' : 'step-library-overlay'} role={embedded ? undefined : 'presentation'} onMouseDown={(event) => { if (!embedded && event.target === event.currentTarget && !busy) onClose?.() }}>
    <section className={embedded ? 'step-library-page-surface' : 'step-library-modal'} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby="step-library-title">
      {!embedded && <header className="step-library-surface-header"><span><Box size={18} /></span><div><p className="eyebrow">GEOMETRY DESIGN</p><h2 id="step-library-title">STEP library</h2><small>Independent exact-CAD assets, versions, and validation.</small></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close STEP library"><X size={17} /></button></header>}
      <div className="step-library-layout">
        <aside>
          {embedded && <div className="step-library-sidebar-heading"><span><Box size={16} /></span><div><p className="eyebrow">{t('LOCAL CAD')}</p><h2 id="step-library-title">{t('STEP library')}</h2><small>{t('Stored on this server')}</small></div></div>}
          {folderRoot && <FolderTree
            root={folderRoot}
            selected={selectedFolderId}
            onSelect={(node) => setSelectedFolderId(node.id)}
            onCreateRoot={() => openFolderAction({ mode: 'create', folder: folderRoot })}
            onCreateChild={(node) => openFolderAction({ mode: 'create', folder: node })}
            onRename={(node) => openFolderAction({ mode: 'rename', folder: node })}
            onMove={(node) => openFolderAction({ mode: 'move', folder: node })}
            onDelete={(node) => openFolderAction({ mode: 'delete', folder: node })}
          />}
          <div className="step-library-aside-title"><strong>{selectedLocalFolder?.name ?? t('Assets')}</strong><small>{t('Local STEP assets')}</small></div>
          {loading && <p className="step-library-state"><Loader2 className="spin" size={14} /> Loading library…</p>}
          {!loading && folderAssets.length === 0 && <p className="step-library-state">{t('No STEP assets in this folder.')}</p>}
          {folderAssets.map((asset) => { const latest = asset.versions.at(-1); return <button className={selectedAsset?.id === asset.id ? 'active' : ''} type="button" key={asset.id} onClick={() => { setSelectedAssetId(asset.id); setSelectedVersionId(latest?.id ?? ''); setCreationMode(latest?.geometry ? 'ai-revise' : 'upload-version') }}><Box size={15} /><span><strong>{asset.name}</strong><small>{asset.versions.length} {asset.versions.length === 1 ? 'version' : 'versions'} · {latest?.validation.status}</small></span></button> })}
        </aside>
        <main>
          <div className={embedded ? 'step-library-content-header' : 'step-library-modal-actions'}>
            {embedded && <div><p className="eyebrow">{t('STEP ASSETS')}</p><h1>{selectedLocalFolder?.name ?? t('STEP library')}</h1><div className="step-library-folder-context"><span><strong>{folderAssets.length}</strong>{t('Local assets')}</span><span>{t('Versioned and validated on this server.')}</span></div></div>}
            <div className="step-library-tabs" role="group" aria-label="STEP creation method">
              <button className={!embedded && creationMode === 'upload-new' ? 'active' : ''} type="button" onClick={() => chooseCreationMode('upload-new')}><FileUp size={13} /> Upload new asset</button>
              <button className={!embedded && creationMode === 'ai-new' ? 'active' : ''} type="button" onClick={() => chooseCreationMode('ai-new')}><Sparkles size={13} /> AI new design</button>
              {selectedAsset && <button className={!embedded && creationMode === 'upload-version' ? 'active' : ''} type="button" onClick={() => chooseCreationMode('upload-version')}><Plus size={13} /> Upload version</button>}
              {selectedVersion?.geometry && <button className={!embedded && creationMode === 'ai-revise' ? 'active' : ''} type="button" onClick={() => chooseCreationMode('ai-revise')}><Sparkles size={13} /> AI revise</button>}
            </div>
          </div>
          {!embedded && creationForm}
          {aiJob && <section className={`step-ai-job status-${aiJob.status}`} aria-live="polite"><div><strong>{aiJob.detail || aiJob.stage}</strong><small>{aiJob.stage.replaceAll('-', ' ')} · {aiJob.progress}%</small></div><progress max={100} value={aiJob.progress} />{['queued', 'running', 'recovering'].includes(aiJob.status) && <button type="button" onClick={() => void cancelAIDesign()}>Cancel generation</button>}{['failed', 'needs_input', 'cancelled'].includes(aiJob.status) && <button type="button" onClick={() => void startAIDesign()}>Retry as a new job</button>}</section>}
          {!loading && !selectedAsset && <section className="step-library-empty-panel"><Box size={22} /><strong>{t('No STEP assets in this folder.')}</strong><p>{t('Upload an existing STEP file or ask AI to create an exact CAD design.')}</p></section>}
          {selectedAsset && selectedVersion && <section className="step-library-detail">
            <div className="step-library-detail-heading"><div><p className="eyebrow">SELECTED ASSET</p><h3>{selectedAsset.name}</h3><small>{selectedAsset.description || 'No description'}</small></div><span className={`step-status status-${selectedVersion.validation.status}`}><StatusIcon version={selectedVersion} /> {selectedVersion.validation.status}</span></div>
            <div className="step-version-list">{selectedAsset.versions.map((version) => <button className={selectedVersion.id === version.id ? 'active' : ''} type="button" key={version.id} onClick={() => setSelectedVersionId(version.id)}>V{version.number}<small>{version.source}</small></button>)}</div>
            {selectedVersion.validation.status === 'ready' && <section className="step-preview"><div className="step-preview-toolbar"><strong>3D exact-geometry preview</strong><label>Compare with <select value={compareVersionId} onChange={(event) => setCompareVersionId(event.target.value)}><option value="">No comparison</option>{selectedAsset.versions.filter((version) => version.id !== selectedVersion.id && version.validation.status === 'ready').map((version) => <option key={version.id} value={version.id}>V{version.number}</option>)}</select></label></div>{preview ? <LazyViewer3D key={preview.asset_url} manifest={preview} state={{ status: 'ready' }} showEntityLegend /> : <div className="step-preview-loading">{previewError || <><Loader2 className="spin" size={14} /> Tessellating exact STEP for browser preview…</>}</div>}{preview?.comparison && <div className="step-version-deltas"><span>Δ volume <strong>{preview.comparison.volume_delta.toPrecision(6)}</strong></span><span>Δ solids <strong>{preview.comparison.solid_count_delta}</strong></span><span>Δ faces <strong>{preview.comparison.face_count_delta}</strong></span><span title={preview.comparison.bounds_delta.join(' · ')}>Δ bounds <strong>{preview.comparison.bounds_delta.map((value) => value.toPrecision(3)).join(' · ')}</strong></span></div>}</section>}
            <dl><div><dt>File</dt><dd>{selectedVersion.file_name} · {formatBytes(selectedVersion.size)}</dd></div><div><dt>Unit</dt><dd>{selectedVersion.unit}</dd></div><div><dt>Fingerprint</dt><dd title={selectedVersion.sha256}>{selectedVersion.sha256.slice(0, 16)}…</dd></div>
              {selectedVersion.validation.report && <><div><dt>Exact solids / faces</dt><dd>{selectedVersion.validation.report.solid_count} / {selectedVersion.validation.report.face_count}</dd></div><div><dt>Volume</dt><dd>{selectedVersion.validation.report.volume.toPrecision(7)} {selectedVersion.unit}³</dd></div><div><dt>Kernel</dt><dd>{selectedVersion.validation.report.kernel}</dd></div>{selectedVersion.validation.report.bounds && <div><dt>Bounds</dt><dd>{selectedVersion.validation.report.bounds.map((value) => value.toPrecision(5)).join(' · ')}</dd></div>}</>}
            </dl>
            {selectedVersion.validation.error && <p className="step-library-error"><XCircle size={14} /> {selectedVersion.validation.error}</p>}
            {!selectedVersion.geometry && <p className="step-library-note">This uploaded version has no editable parametric recipe. Upload a revised STEP as a new version; AI revision is available on AI-authored versions.</p>}
            <div className="step-library-actions"><button type="button" onClick={() => openFolderAction({ mode: 'move-asset' })}><FolderInput size={13} /> {t('Move asset')}</button><a href={api.stepVersionDownloadURL(selectedAsset.id, selectedVersion.id)}><Download size={13} /> Download</a><button type="button" onClick={() => void revalidate()} disabled={busy || selectedVersion.validation.status === 'validating'}><RefreshCw size={13} /> Validate again</button>{onUseInAICreate && <button type="button" onClick={() => onUseInAICreate({ asset_id: selectedAsset.id, version_id: selectedVersion.id, label: `${selectedAsset.name} V${selectedVersion.number}` })} disabled={busy || selectedVersion.validation.status !== 'ready'}><Sparkles size={13} /> Use in AI Create</button>}{folder && onCreated && <button className="primary" type="button" onClick={() => void createProject()} disabled={busy || selectedVersion.validation.status !== 'ready'}>{busy ? <Loader2 className="spin" size={13} /> : <FolderOpen size={13} />} Create in {folder.name}</button>}</div>
          </section>}
          {error && <p className="step-library-error" role="alert"><XCircle size={14} /> {error}</p>}
        </main>
      </div>
    </section>
    {embedded && creationDialogOpen && <div className="step-library-creation-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreationDialogOpen(false) }}><section className="step-library-creation-dialog" role="dialog" aria-modal="true" aria-labelledby="step-creation-title"><header><div><p className="eyebrow">CREATE GEOMETRY</p><h2 id="step-creation-title">{creationTitle}</h2></div><button type="button" onClick={() => setCreationDialogOpen(false)} disabled={busy} aria-label="Close STEP creation"><X size={17} /></button></header>{creationForm}</section></div>}
    {folderAction && folderRoot && <div className="step-library-creation-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setFolderAction(null) }}><section className="step-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="step-folder-title"><header><h2 id="step-folder-title">{t(folderAction.mode === 'create' ? 'New folder' : folderAction.mode === 'rename' ? 'Rename folder' : folderAction.mode === 'delete' ? 'Delete folder' : folderAction.mode === 'move-asset' ? 'Move asset' : 'Move folder')}</h2><button type="button" onClick={() => setFolderAction(null)} disabled={busy} aria-label={t('Close folder dialog')}><X size={17} /></button></header><form onSubmit={submitFolderAction}>
      {folderAction.mode === 'delete' ? <p>{t('The folder must be empty before it can be deleted.')}</p> : <>
        {(folderAction.mode === 'create' || folderAction.mode === 'rename') && <label>{t('Folder name')}<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>}
        {(folderAction.mode === 'create' || folderAction.mode === 'move' || folderAction.mode === 'move-asset') && <label>{t('Destination folder')}<select value={folderTargetId} onChange={(event) => setFolderTargetId(event.target.value)}>{flattenFolders(folderRoot, folderAction.mode === 'move' ? folderAction.folder?.id : '').map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
      </>}
      <div><button type="button" onClick={() => setFolderAction(null)}>{t('Cancel')}</button><button className={folderAction.mode === 'delete' ? 'danger' : 'primary'} type="submit" disabled={busy || ((folderAction.mode === 'create' || folderAction.mode === 'rename') && !folderName.trim())}>{busy && <Loader2 className="spin" size={13} />}{t(folderAction.mode === 'delete' ? 'Delete folder' : folderAction.mode === 'rename' ? 'Rename folder' : folderAction.mode === 'create' ? 'Create folder' : folderAction.mode === 'move-asset' ? 'Move asset' : 'Move folder')}</button></div>
    </form></section></div>}
  </div>
}
