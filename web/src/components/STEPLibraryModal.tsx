import { Box, CheckCircle2, Download, FileUp, FolderOpen, Loader2, Plus, RefreshCw, Sparkles, X, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, type FolderNode, type STEPAIJob, type STEPAsset, type STEPPreviewManifest, type STEPProjectResult, type STEPVersion } from '../api/client'
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

export default function STEPLibraryModal({ folder = null, onClose, onCreated, onUseInAICreate, embedded = false }: {
  folder?: FolderNode | null
  onClose?: () => void
  onCreated?: (result: STEPProjectResult) => void
  onUseInAICreate?: (source: { asset_id: string; version_id: string; label: string }) => void
  embedded?: boolean
}) {
  const [assets, setAssets] = useState<STEPAsset[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creationMode, setCreationMode] = useState<'upload-new' | 'upload-version' | 'ai-new' | 'ai-revise'>('upload-new')
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
    () => assets.find((asset) => asset.id === selectedAssetId) ?? assets[0] ?? null,
    [assets, selectedAssetId],
  )
  const selectedVersion = useMemo(() => selectedAsset?.versions.find((version) => version.id === selectedVersionId)
    ?? selectedAsset?.versions.at(-1) ?? null, [selectedAsset, selectedVersionId])

  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await api.stepAssets()
      setAssets(response.assets)
      setSelectedAssetId((current) => current || response.assets[0]?.id || '')
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])
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
        form.set('name', assetName.trim()); form.set('description', description.trim())
      } else if (selectedVersion) form.set('parent_version_id', selectedVersion.id)
      const response = await api.uploadSTEPAsset(form, creationMode === 'upload-version' ? selectedAsset?.id : undefined)
      setSelectedAssetId(response.asset.id); setSelectedVersionId(response.version.id)
      setFile(null); setAssetName(''); setDescription('')
      if (fileInput.current) fileInput.current.value = ''
      await load(true)
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
      })
      setAIJob(job)
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

  const uploadMode = creationMode === 'upload-new' || creationMode === 'upload-version'
  const aiMode = creationMode === 'ai-new' || creationMode === 'ai-revise'

  return <div className={embedded ? 'step-library-embedded' : 'step-library-overlay'} role={embedded ? undefined : 'presentation'} onMouseDown={(event) => { if (!embedded && event.target === event.currentTarget && !busy) onClose?.() }}>
    <section className="step-library-modal" role="dialog" aria-modal="true" aria-labelledby="step-library-title">
      <header><span><Box size={18} /></span><div><p className="eyebrow">GEOMETRY DESIGN</p><h2 id="step-library-title">STEP library</h2><small>Independent exact-CAD assets, versions, and validation.</small></div>{!embedded && <button type="button" onClick={onClose} disabled={busy} aria-label="Close STEP library"><X size={17} /></button>}</header>
      <div className="step-library-layout">
        <aside>
          <div className="step-library-aside-title"><strong>Assets</strong><button type="button" onClick={() => setCreationMode('upload-new')}><Plus size={13} /> New</button></div>
          {loading && <p className="step-library-state"><Loader2 className="spin" size={14} /> Loading library…</p>}
          {!loading && assets.length === 0 && <p className="step-library-state">No STEP assets yet. Upload one or describe a new design.</p>}
          {assets.map((asset) => { const latest = asset.versions.at(-1); return <button className={selectedAsset?.id === asset.id ? 'active' : ''} type="button" key={asset.id} onClick={() => { setSelectedAssetId(asset.id); setSelectedVersionId(latest?.id ?? ''); setCreationMode(latest?.geometry ? 'ai-revise' : 'upload-version') }}><Box size={15} /><span><strong>{asset.name}</strong><small>{asset.versions.length} {asset.versions.length === 1 ? 'version' : 'versions'} · {latest?.validation.status}</small></span></button> })}
        </aside>
        <main>
          <div className="step-library-tabs" role="group" aria-label="STEP creation method">
            <button className={creationMode === 'upload-new' ? 'active' : ''} type="button" onClick={() => setCreationMode('upload-new')}><FileUp size={13} /> Upload new asset</button>
            <button className={creationMode === 'ai-new' ? 'active' : ''} type="button" onClick={() => setCreationMode('ai-new')}><Sparkles size={13} /> AI new design</button>
            {selectedAsset && <button className={creationMode === 'upload-version' ? 'active' : ''} type="button" onClick={() => setCreationMode('upload-version')}><Plus size={13} /> Upload version</button>}
            {selectedVersion?.geometry && <button className={creationMode === 'ai-revise' ? 'active' : ''} type="button" onClick={() => setCreationMode('ai-revise')}><Sparkles size={13} /> AI revise</button>}
          </div>
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
            <textarea value={aiPrompt} onChange={(event) => setAIPrompt(event.target.value)} placeholder={creationMode === 'ai-revise' ? 'Describe only the change, e.g. increase the chord by 10%…' : 'Describe the geometry and defining dimensions…'} rows={3} />
            <button type="submit" disabled={busy || !aiPrompt.trim()}>{busy ? <Loader2 className="spin" size={13} /> : <Sparkles size={13} />} {creationMode === 'ai-revise' ? 'Generate new version' : 'Generate STEP asset'}</button>
          </form>}
          {aiJob && <section className={`step-ai-job status-${aiJob.status}`} aria-live="polite"><div><strong>{aiJob.detail || aiJob.stage}</strong><small>{aiJob.stage.replaceAll('-', ' ')} · {aiJob.progress}%</small></div><progress max={100} value={aiJob.progress} />{['queued', 'running', 'recovering'].includes(aiJob.status) && <button type="button" onClick={() => void cancelAIDesign()}>Cancel generation</button>}{['failed', 'needs_input', 'cancelled'].includes(aiJob.status) && <button type="button" onClick={() => void startAIDesign()}>Retry as a new job</button>}</section>}
          {selectedAsset && selectedVersion && <section className="step-library-detail">
            <div className="step-library-detail-heading"><div><p className="eyebrow">SELECTED ASSET</p><h3>{selectedAsset.name}</h3><small>{selectedAsset.description || 'No description'}</small></div><span className={`step-status status-${selectedVersion.validation.status}`}><StatusIcon version={selectedVersion} /> {selectedVersion.validation.status}</span></div>
            <div className="step-version-list">{selectedAsset.versions.map((version) => <button className={selectedVersion.id === version.id ? 'active' : ''} type="button" key={version.id} onClick={() => setSelectedVersionId(version.id)}>V{version.number}<small>{version.source}</small></button>)}</div>
            {selectedVersion.validation.status === 'ready' && <section className="step-preview"><div className="step-preview-toolbar"><strong>3D exact-geometry preview</strong><label>Compare with <select value={compareVersionId} onChange={(event) => setCompareVersionId(event.target.value)}><option value="">No comparison</option>{selectedAsset.versions.filter((version) => version.id !== selectedVersion.id && version.validation.status === 'ready').map((version) => <option key={version.id} value={version.id}>V{version.number}</option>)}</select></label></div>{preview ? <LazyViewer3D key={preview.asset_url} manifest={preview} state={{ status: 'ready' }} showEntityLegend /> : <div className="step-preview-loading">{previewError || <><Loader2 className="spin" size={14} /> Tessellating exact STEP for browser preview…</>}</div>}{preview?.comparison && <div className="step-version-deltas"><span>Δ volume <strong>{preview.comparison.volume_delta.toPrecision(6)}</strong></span><span>Δ solids <strong>{preview.comparison.solid_count_delta}</strong></span><span>Δ faces <strong>{preview.comparison.face_count_delta}</strong></span><span title={preview.comparison.bounds_delta.join(' · ')}>Δ bounds <strong>{preview.comparison.bounds_delta.map((value) => value.toPrecision(3)).join(' · ')}</strong></span></div>}</section>}
            <dl><div><dt>File</dt><dd>{selectedVersion.file_name} · {formatBytes(selectedVersion.size)}</dd></div><div><dt>Unit</dt><dd>{selectedVersion.unit}</dd></div><div><dt>Fingerprint</dt><dd title={selectedVersion.sha256}>{selectedVersion.sha256.slice(0, 16)}…</dd></div>
              {selectedVersion.validation.report && <><div><dt>Exact solids / faces</dt><dd>{selectedVersion.validation.report.solid_count} / {selectedVersion.validation.report.face_count}</dd></div><div><dt>Volume</dt><dd>{selectedVersion.validation.report.volume.toPrecision(7)} {selectedVersion.unit}³</dd></div><div><dt>Kernel</dt><dd>{selectedVersion.validation.report.kernel}</dd></div>{selectedVersion.validation.report.bounds && <div><dt>Bounds</dt><dd>{selectedVersion.validation.report.bounds.map((value) => value.toPrecision(5)).join(' · ')}</dd></div>}</>}
            </dl>
            {selectedVersion.validation.error && <p className="step-library-error"><XCircle size={14} /> {selectedVersion.validation.error}</p>}
            {!selectedVersion.geometry && <p className="step-library-note">This uploaded version has no editable parametric recipe. Upload a revised STEP as a new version; AI revision is available on AI-authored versions.</p>}
            <div className="step-library-actions"><a href={api.stepVersionDownloadURL(selectedAsset.id, selectedVersion.id)}><Download size={13} /> Download</a><button type="button" onClick={() => void revalidate()} disabled={busy || selectedVersion.validation.status === 'validating'}><RefreshCw size={13} /> Validate again</button>{onUseInAICreate && <button type="button" onClick={() => onUseInAICreate({ asset_id: selectedAsset.id, version_id: selectedVersion.id, label: `${selectedAsset.name} V${selectedVersion.number}` })} disabled={busy || selectedVersion.validation.status !== 'ready'}><Sparkles size={13} /> Use in AI Create</button>}{folder && onCreated && <button className="primary" type="button" onClick={() => void createProject()} disabled={busy || selectedVersion.validation.status !== 'ready'}>{busy ? <Loader2 className="spin" size={13} /> : <FolderOpen size={13} />} Create in {folder.name}</button>}</div>
          </section>}
          {error && <p className="step-library-error" role="alert"><XCircle size={14} /> {error}</p>}
        </main>
      </div>
    </section>
  </div>
}
