import { ArrowLeft, Box, CheckCircle2, Download, Eye, EyeOff, FileText, FileUp, FolderInput, FolderOpen, GitCompare, Loader2, Plus, RefreshCw, Ruler, Sparkles, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type FolderNode, type STEPAsset, type STEPPreviewManifest, type STEPProjectResult, type STEPVersion } from '../api/client'
import { useI18n } from '../i18n'
import FolderTree from './FolderTree'
import { LazyViewer3D, type ViewerSelection } from './viewer/LazyViewer3D'
import { readSTEPFolderSelection, writeSTEPFolderSelection } from '../lib/stepLibrarySelection'
import STEPDesignModal from './STEPDesignModal'
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

export function conciseSTEPError(value = '') {
  if (!value) return ''
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const valueError = [...lines].reverse().find((line) => /(?:ValueError|Error):/.test(line))
  if (valueError) return valueError.replace(/^.*?(?=(?:ValueError|Error):)/, '')
  return lines.at(-1)?.replace(/^.*(?:File ".*?", line \d+[^:]*:\s*)/, '') || 'STEP geometry could not be processed.'
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

export default function STEPLibraryModal({ folder = null, onClose, onCreated, onUseInAICreate, embedded = false, assetId = '' }: {
  folder?: FolderNode | null
  onClose?: () => void
  onCreated?: (result: STEPProjectResult) => void
  onUseInAICreate?: (source: { asset_id: string; version_id: string; label: string }) => void
  embedded?: boolean
  assetId?: string
}) {
  const { t } = useI18n()
  const [assets, setAssets] = useState<STEPAsset[]>([])
  const [folderRoot, setFolderRoot] = useState<FolderNode | null>(null)
  const [selectedFolderId, setSelectedFolderId] = useState(() => readSTEPFolderSelection(typeof window === 'undefined' ? undefined : window.sessionStorage))
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderTargetId, setFolderTargetId] = useState('step-root')
  const [selectedAssetId, setSelectedAssetId] = useState(assetId)
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
  const [compareVersionId, setCompareVersionId] = useState('')
  const [preview, setPreview] = useState<STEPPreviewManifest | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({})
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
      const routedAsset = assetId ? response.assets.find((asset) => asset.id === assetId) : undefined
      setSelectedFolderId((current) => routedAsset?.folder_id || (findFolder(response.folder_root, current) ? current : response.folder_root.id))
      setSelectedAssetId((current) => routedAsset?.id || (response.assets.some((asset) => asset.id === current) ? current : ''))
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
  const selectFolder = (folderId: string) => {
    setSelectedFolderId(folderId)
    writeSTEPFolderSelection(folderId, typeof window === 'undefined' ? undefined : window.sessionStorage)
  }
  useEffect(() => {
    writeSTEPFolderSelection(selectedFolderId, typeof window === 'undefined' ? undefined : window.sessionStorage)
  }, [selectedFolderId])
  useEffect(() => {
    if (embedded && !assetId) { setSelectedAssetId(''); setSelectedVersionId(''); return }
    if (selectedAsset && (selectedAsset.folder_id || 'step-root') === selectedFolderId) return
    const next = folderAssets[0]
    setSelectedAssetId(next?.id ?? '')
    setSelectedVersionId(next?.versions.at(-1)?.id ?? '')
  }, [selectedFolderId, folderAssets, selectedAsset, embedded, assetId])
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
    setViewerSelection({ groupId: null })
    setEntityVisibility({})
  }, [selectedVersion?.id])

  useEffect(() => {
    if (!selectedAsset || !selectedVersion || selectedVersion.validation.status !== 'ready') { setPreview(null); return }
    let active = true
    setPreview(null); setPreviewError('')
    api.stepVersionPreview(selectedAsset.id, selectedVersion.id, compareVersionId || undefined)
      .then((value) => { if (active) setPreview(value) })
      .catch((cause) => { if (active) setPreviewError(t(cause instanceof Error ? cause.message : String(cause))) })
    return () => { active = false }
  }, [selectedAsset?.id, selectedVersion?.id, selectedVersion?.validation.status, compareVersionId, t])

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
        if (selectedFolderId === folderAction.folder.id) selectFolder(folderRoot.id)
      }
      if (folderAction.mode === 'move-asset' && selectedAsset) {
        await api.moveSTEPAsset(selectedAsset.id, folderTargetId)
        selectFolder(folderTargetId)
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
    if (embedded || mode === 'ai-new' || mode === 'ai-revise') setCreationDialogOpen(true)
  }
  const creationTitle = t(creationMode === 'upload-new' ? 'Upload STEP asset'
    : creationMode === 'upload-version' ? 'Upload a new STEP version'
      : creationMode === 'ai-revise' && selectedVersion?.geometry ? 'AI revise STEP asset'
        : creationMode === 'ai-revise' ? 'AI reconstruct STEP asset' : 'Create STEP with AI')
  const creationForm = <>
    {uploadMode && <form className="step-library-create" onSubmit={upload}>
      <div><strong>{creationMode === 'upload-new' ? 'Add an existing STEP file' : `Add version to ${selectedAsset?.name}`}</strong><small>Stored independently; downloading it later is optional.</small></div>
      {creationMode === 'upload-new' && <input value={assetName} onChange={(event) => setAssetName(event.target.value)} placeholder="Asset name" aria-label="STEP asset name" />}
      {creationMode === 'upload-new' && <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Description (optional)" aria-label="STEP asset description" />}
      <label className="step-library-file"><FileUp size={14} /><span>{file?.name || 'Choose .step or .stp'}</span><input ref={fileInput} type="file" accept=".step,.stp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <select value={unit} onChange={(event) => setUnit(event.target.value as typeof unit)} aria-label="STEP length unit"><option value="m">metres</option><option value="mm">millimetres</option><option value="cm">centimetres</option><option value="inch">inches</option></select>
      <button type="submit" disabled={busy || !file || (creationMode === 'upload-new' && !assetName.trim())}>{busy ? <Loader2 className="spin" size={13} /> : <FileUp size={13} />} Store and validate</button>
    </form>}
  </>

  return <div className={embedded ? 'step-library-embedded' : 'step-library-overlay'} role={embedded ? undefined : 'presentation'} onMouseDown={(event) => { if (!embedded && event.target === event.currentTarget && !busy) onClose?.() }}>
    <section className={`${embedded ? 'step-library-page-surface' : 'step-library-modal'}${embedded && assetId ? ' step-library-asset-route' : ''}`} role={embedded ? 'region' : 'dialog'} aria-modal={embedded ? undefined : true} aria-labelledby="step-library-title">
      {!embedded && <header className="step-library-surface-header"><span><Box size={18} /></span><div><p className="eyebrow">GEOMETRY DESIGN</p><h2 id="step-library-title">STEP library</h2><small>Independent exact-CAD assets, versions, and validation.</small></div><button type="button" onClick={onClose} disabled={busy} aria-label="Close STEP library"><X size={17} /></button></header>}
      <div className="step-library-layout">
        <aside>
          {embedded && <div className="step-library-sidebar-heading"><span><Box size={16} /></span><div><p className="eyebrow">{t('LOCAL CAD')}</p><h2 id="step-library-title">{t('STEP library')}</h2><small>{t('Stored on this server')}</small></div></div>}
          {folderRoot && <FolderTree
            root={folderRoot}
            selected={selectedFolderId}
            onSelect={(node) => selectFolder(node.id)}
            onCreateRoot={() => openFolderAction({ mode: 'create', folder: folderRoot })}
            onCreateChild={(node) => openFolderAction({ mode: 'create', folder: node })}
            onRename={(node) => openFolderAction({ mode: 'rename', folder: node })}
            onMove={(node) => openFolderAction({ mode: 'move', folder: node })}
            onDelete={(node) => openFolderAction({ mode: 'delete', folder: node })}
          />}
          {!embedded && <><div className="step-library-aside-title"><strong>{selectedLocalFolder?.name ?? t('Assets')}</strong><small>{t('Local STEP assets')}</small></div>
          {loading && <p className="step-library-state"><Loader2 className="spin" size={14} /> Loading library…</p>}
          {!loading && folderAssets.length === 0 && <p className="step-library-state">{t('No STEP assets in this folder.')}</p>}
          {folderAssets.map((asset) => { const latest = asset.versions.at(-1); return <button className={selectedAsset?.id === asset.id ? 'active' : ''} type="button" key={asset.id} onClick={() => { setSelectedAssetId(asset.id); setSelectedVersionId(latest?.id ?? ''); setCreationMode(latest?.geometry ? 'ai-revise' : 'upload-version') }}><Box size={15} /><span><strong>{asset.name}</strong><small>{asset.versions.length} {asset.versions.length === 1 ? 'version' : 'versions'} · {latest?.validation.status}</small></span></button> })}</>}
        </aside>
        <main>
          <div className={embedded ? 'step-library-content-header' : 'step-library-modal-actions'}>
            {embedded && <div><p className="eyebrow">{assetId ? t('STEP ASSET') : t('STEP ASSETS')}</p><h1>{assetId && selectedAsset ? selectedAsset.name : selectedLocalFolder?.name ?? t('STEP library')}</h1><div className="step-library-folder-context"><span><strong>{assetId && selectedAsset ? selectedAsset.versions.length : folderAssets.length}</strong>{t(assetId ? 'Versions' : 'Local assets')}</span><span>{t('Versioned and validated on this server.')}</span></div></div>}
            <div className="step-library-tabs" role="group" aria-label="STEP creation method">
              {assetId && <Link className="step-library-back-link" to="/step-library">← {t('Back to STEP library')}</Link>}
              {!assetId && <button className={!embedded && creationMode === 'upload-new' ? 'active' : ''} type="button" onClick={() => chooseCreationMode('upload-new')}><FileUp size={13} /> Upload new asset</button>}
              {!assetId && <button className={!embedded && creationMode === 'ai-new' ? 'active' : ''} type="button" onClick={() => chooseCreationMode('ai-new')}><Sparkles size={13} /> AI Design</button>}
              {selectedAsset && <button className={!embedded && creationMode === 'upload-version' ? 'active' : ''} type="button" onClick={() => chooseCreationMode('upload-version')}><Plus size={13} /> Upload version</button>}
              {selectedVersion && <button className={!embedded && creationMode === 'ai-revise' ? 'active' : ''} type="button" onClick={() => chooseCreationMode('ai-revise')}><Sparkles size={13} /> {selectedVersion.geometry ? 'AI revise' : 'AI reconstruct'}</button>}
            </div>
          </div>
          {!embedded && creationForm}
          {!loading && !assetId && folderAssets.length === 0 && <section className="step-library-empty-panel"><Box size={22} /><strong>{t('No STEP assets in this folder.')}</strong><p>{t('Upload an existing STEP file or ask AI to create an exact CAD design.')}</p></section>}
          {!loading && !assetId && folderAssets.length > 0 && <section className="step-asset-grid">{folderAssets.map((asset) => { const latest = asset.versions.at(-1); return <article className="step-asset-card" key={asset.id}><Link to={`/step-library/${encodeURIComponent(asset.id)}`} aria-label={`${t('Open STEP asset')} ${asset.name}`}><div className="step-asset-thumbnail">{latest?.validation.status === 'ready' ? <img src={api.stepVersionThumbnailURL(asset.id, latest.id)} alt="" /> : <Box size={34} />}</div><div className="step-asset-card-body"><div><strong>{asset.name}</strong><span className={`step-status status-${latest?.validation.status}`}><StatusIcon version={latest!} /> {latest?.validation.status}</span></div><p>{asset.description || t('No description')}</p><small>V{latest?.number} · {latest ? formatBytes(latest.size) : '—'} · {asset.versions.length} {t(asset.versions.length === 1 ? 'version' : 'versions')}</small></div></Link></article> })}</section>}
          {assetId && !loading && !selectedAsset && <section className="step-library-empty-panel"><XCircle size={22} /><strong>{t('STEP asset not found')}</strong><Link to="/step-library">{t('Back to STEP library')}</Link></section>}
          {assetId && selectedAsset && selectedVersion && <section className="step-resource-workbench resource-workspace project-canvas">
            <header className="step-resource-context project-context-bar">
              <div className="canvas-resource-title"><span className="resource-type-icon type-geometry"><Box size={17} /></span><div><strong>{selectedAsset.name}</strong><small>{t('Local STEP geometry')} · V{selectedVersion.number} · {selectedVersion.id}</small></div><em className={`status-pill status-${selectedVersion.validation.status}`}><StatusIcon version={selectedVersion} /> {t(selectedVersion.validation.status)}</em></div>
              <div className="step-resource-version-context"><span>{t('Version')}</span><select value={selectedVersion.id} onChange={(event) => setSelectedVersionId(event.target.value)} aria-label={t('Selected STEP version')}>{[...selectedAsset.versions].reverse().map((version) => <option key={version.id} value={version.id}>V{version.number} · {t(version.source)} · {t(version.validation.status)}</option>)}</select><small>{selectedAsset.description || t('No description')}</small></div>
              <div className="step-resource-context-actions"><Link to="/step-library"><ArrowLeft size={13} /> {t('STEP library')}</Link><button type="button" onClick={() => chooseCreationMode('upload-version')}><Plus size={13} /> {t('Upload version')}</button><button className="primary" type="button" onClick={() => chooseCreationMode('ai-revise')}><Sparkles size={13} /> {t(selectedVersion.geometry ? 'AI revise' : 'AI reconstruct')}</button></div>
            </header>
            <section className="step-resource-review geometry-review-workspace">
              <aside className="geometry-entity-panel step-resource-inventory" aria-label={t('STEP version and entity inventory')}>
                <div className="geometry-panel-heading"><div><span>{t('LOCAL HISTORY')}</span><strong>{t('Versions')}</strong></div><span className="geometry-count-badge">{selectedAsset.versions.length}</span></div>
                <div className="step-resource-version-list">{[...selectedAsset.versions].reverse().map((version) => <button className={selectedVersion.id === version.id ? 'active' : ''} type="button" key={version.id} onClick={() => setSelectedVersionId(version.id)}><span><strong>V{version.number}</strong><small>{t(version.source)} · {new Date(version.created_at).toLocaleDateString()}</small></span><span className={`step-version-state status-${version.validation.status}`}><StatusIcon version={version} /></span></button>)}</div>
                <div className="geometry-panel-heading step-resource-entity-heading"><div><span>{t('MODEL')}</span><strong>{t('Geometry inventory')}</strong></div><span className="geometry-count-badge">{preview?.groups.length ?? 0}</span></div>
                <div className="geometry-entity-tree">{preview?.groups.map((group) => { const visible = entityVisibility[group.id] !== false; return <div className={`geometry-entity-row ${viewerSelection.groupId === group.id ? 'selected' : ''} ${visible ? '' : 'hidden'}`} key={group.id}><button className="geometry-entity-select" type="button" onClick={() => setViewerSelection({ groupId: group.id })}><span className="viewer-color-swatch" style={{ background: group.color }} /><span>{group.name}</span><small>{group.triangles !== undefined ? `${group.triangles} tris` : t('surface')}</small></button><button className="geometry-entity-visibility" type="button" onClick={() => setEntityVisibility((current) => ({ ...current, [group.id]: !visible }))} aria-label={t(visible ? `Hide surface ${group.name}` : `Show surface ${group.name}`)}>{visible ? <Eye size={13} /> : <EyeOff size={13} />}</button></div> })}{selectedVersion.validation.status === 'ready' && !preview && <div className="geometry-empty-list">{t('Geometry entities appear after the browser preview is ready.')}</div>}</div>
              </aside>
              <div className="viewer-section geometry-review-viewer step-resource-viewer">
                {selectedVersion.validation.status === 'ready' && preview && <LazyViewer3D key={preview.asset_url} manifest={preview} state={{ status: 'ready' }} selection={viewerSelection} onSelectionChange={setViewerSelection} entityVisibility={entityVisibility} onEntityVisibilityChange={setEntityVisibility} showEntityLegend={false} showFieldPanel={false} />}
                {selectedVersion.validation.status === 'ready' && !preview && <div className="step-resource-viewer-state">{previewError ? <><XCircle size={20} /><strong>{t('Browser preview unavailable')}</strong><span>{conciseSTEPError(previewError)}</span></> : <><Loader2 className="spin" size={20} /><strong>{t('Preparing exact geometry')}</strong><span>{t('Tessellating the validated STEP for interactive review…')}</span></>}</div>}
                {selectedVersion.validation.status !== 'ready' && <div className="step-resource-viewer-state"><Box size={24} /><strong>{t(selectedVersion.validation.status === 'validating' ? 'Validating exact geometry' : 'Geometry validation is blocked')}</strong><span>{t(selectedVersion.validation.status === 'validating' ? 'The viewer will open after OpenCascade validation succeeds.' : 'Resolve the validation issue or upload a corrected STEP version.')}</span></div>}
                {preview?.comparison && <div className="step-version-deltas"><span>Δ {t('volume')} <strong>{preview.comparison.volume_delta.toPrecision(6)}</strong></span><span>Δ {t('solids')} <strong>{preview.comparison.solid_count_delta}</strong></span><span>Δ {t('faces')} <strong>{preview.comparison.face_count_delta}</strong></span></div>}
              </div>
              <aside className="geometry-review-panel step-resource-inspector" aria-label={t('STEP geometry inspector')}>
                <div className={`geometry-readiness-card ${selectedVersion.validation.status === 'ready' ? 'ready' : selectedVersion.validation.status === 'blocked' ? 'blocked' : 'warning'}`}><div className="geometry-panel-heading"><div><span>{t('EXACT CAD PREFLIGHT')}</span><strong>{t(selectedVersion.validation.status === 'ready' ? 'Ready for use' : selectedVersion.validation.status === 'blocked' ? 'Validation blocked' : 'Validation in progress')}</strong></div><StatusIcon version={selectedVersion} /></div><p>{t(selectedVersion.validation.status === 'ready' ? 'OpenCascade loaded this version and reported exact geometry properties.' : selectedVersion.validation.status === 'blocked' ? 'This version is preserved, but cannot be used until exact geometry validation succeeds.' : 'OpenCascade is checking the uploaded geometry.')}</p></div>
                <div className="geometry-summary-grid"><div className="geometry-summary-wide"><span><FileText size={12} /> {t('File')}</span><strong title={selectedVersion.file_name}>{selectedVersion.file_name} · {formatBytes(selectedVersion.size)}</strong></div><div><span><Box size={12} /> {t('Solids / faces')}</span><strong>{selectedVersion.validation.report ? `${selectedVersion.validation.report.solid_count} / ${selectedVersion.validation.report.face_count}` : '—'}</strong></div><div><span><Ruler size={12} /> {t('Source unit')}</span><strong>{selectedVersion.unit}</strong></div><div className="geometry-summary-wide"><span><Ruler size={12} /> {t('Volume')}</span><strong>{selectedVersion.validation.report ? `${selectedVersion.validation.report.volume.toPrecision(7)} ${selectedVersion.validation.report.length_unit || 'mm'}³` : '—'}</strong></div></div>
                <section className="step-resource-properties"><div className="geometry-section-title"><FileText size={13} /> {t('Version properties')}</div><dl><div><dt>{t('Source')}</dt><dd>{t(selectedVersion.source)}</dd></div><div><dt>{t('Kernel')}</dt><dd>{selectedVersion.validation.report?.kernel || '—'}</dd></div><div><dt>{t('Fingerprint')}</dt><dd title={selectedVersion.sha256}>{selectedVersion.sha256.slice(0, 12)}…</dd></div>{selectedVersion.validation.report?.bounds && <div><dt>{t('Bounds')}</dt><dd title={selectedVersion.validation.report.bounds.join(' · ')}>{selectedVersion.validation.report.bounds.map((value) => value.toPrecision(3)).join(' · ')}</dd></div>}</dl></section>
                {selectedVersion.validation.error && <div className="step-resource-validation-issue"><XCircle size={14} /><span><strong>{t('Validation evidence')}</strong><small>{conciseSTEPError(selectedVersion.validation.error)}</small></span></div>}
                {!selectedVersion.geometry && <p className="step-library-note">{t('This imported STEP has no feature history. AI can reconstruct a parametric version while preserving the original.')}</p>}
                <section className="step-resource-compare"><div className="geometry-section-title"><GitCompare size={13} /> {t('Version comparison')}</div><label>{t('Compare with')}<select value={compareVersionId} onChange={(event) => setCompareVersionId(event.target.value)}><option value="">{t('No comparison')}</option>{selectedAsset.versions.filter((version) => version.id !== selectedVersion.id && version.validation.status === 'ready').map((version) => <option key={version.id} value={version.id}>V{version.number}</option>)}</select></label></section>
                <div className="step-resource-actions"><a href={api.stepVersionDownloadURL(selectedAsset.id, selectedVersion.id)}><Download size={13} /> {t('Download')}</a><button type="button" onClick={() => void revalidate()} disabled={busy || selectedVersion.validation.status === 'validating'}><RefreshCw size={13} /> {t('Validate again')}</button><button type="button" onClick={() => openFolderAction({ mode: 'move-asset' })}><FolderInput size={13} /> {t('Move asset')}</button>{onUseInAICreate && <button type="button" onClick={() => onUseInAICreate({ asset_id: selectedAsset.id, version_id: selectedVersion.id, label: `${selectedAsset.name} V${selectedVersion.number}` })} disabled={busy || selectedVersion.validation.status !== 'ready'}><Sparkles size={13} /> {t('Use in AI Create')}</button>}{folder && onCreated && <button className="primary" type="button" onClick={() => void createProject()} disabled={busy || selectedVersion.validation.status !== 'ready'}>{busy ? <Loader2 className="spin" size={13} /> : <FolderOpen size={13} />} {t(`Create in ${folder.name}`)}</button>}</div>
              </aside>
            </section>
          </section>}
          {error && <p className="step-library-error" role="alert"><XCircle size={14} /> {error}</p>}
        </main>
      </div>
    </section>
    {creationDialogOpen && aiMode && <STEPDesignModal mode={creationMode === 'ai-new' ? 'new' : selectedVersion?.geometry ? 'revise' : 'reconstruct'} assetName={selectedAsset?.name} assetId={creationMode === 'ai-revise' ? selectedAsset?.id : undefined} parentVersionId={creationMode === 'ai-revise' ? selectedVersion?.id : undefined} folderId={selectedFolderId} folderName={selectedLocalFolder?.name} onClose={() => setCreationDialogOpen(false)} onCompleted={(job) => { setSelectedAssetId(job.asset_id ?? ''); setSelectedVersionId(job.version_id ?? ''); void load(true) }} />}
    {embedded && creationDialogOpen && uploadMode && <div className="step-library-creation-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreationDialogOpen(false) }}><section className="step-library-creation-dialog" role="dialog" aria-modal="true" aria-labelledby="step-creation-title"><header><div><p className="eyebrow">CREATE GEOMETRY</p><h2 id="step-creation-title">{creationTitle}</h2></div><button type="button" onClick={() => setCreationDialogOpen(false)} disabled={busy} aria-label="Close STEP creation"><X size={17} /></button></header>{creationForm}</section></div>}
    {folderAction && folderRoot && <div className="step-library-creation-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setFolderAction(null) }}><section className="step-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="step-folder-title"><header><h2 id="step-folder-title">{t(folderAction.mode === 'create' ? 'New folder' : folderAction.mode === 'rename' ? 'Rename folder' : folderAction.mode === 'delete' ? 'Delete folder' : folderAction.mode === 'move-asset' ? 'Move asset' : 'Move folder')}</h2><button type="button" onClick={() => setFolderAction(null)} disabled={busy} aria-label={t('Close folder dialog')}><X size={17} /></button></header><form onSubmit={submitFolderAction}>
      {folderAction.mode === 'delete' ? <p>{t('The folder must be empty before it can be deleted.')}</p> : <>
        {(folderAction.mode === 'create' || folderAction.mode === 'rename') && <label>{t('Folder name')}<input autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} /></label>}
        {(folderAction.mode === 'create' || folderAction.mode === 'move' || folderAction.mode === 'move-asset') && <label>{t('Destination folder')}<select value={folderTargetId} onChange={(event) => setFolderTargetId(event.target.value)}>{flattenFolders(folderRoot, folderAction.mode === 'move' ? folderAction.folder?.id : '').map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>}
      </>}
      <div><button type="button" onClick={() => setFolderAction(null)}>{t('Cancel')}</button><button className={folderAction.mode === 'delete' ? 'danger' : 'primary'} type="submit" disabled={busy || ((folderAction.mode === 'create' || folderAction.mode === 'rename') && !folderName.trim())}>{busy && <Loader2 className="spin" size={13} />}{t(folderAction.mode === 'delete' ? 'Delete folder' : folderAction.mode === 'rename' ? 'Rename folder' : folderAction.mode === 'create' ? 'Create folder' : folderAction.mode === 'move-asset' ? 'Move asset' : 'Move folder')}</button></div>
    </form></section></div>}
  </div>
}
