import { AlertCircle, CheckCircle2, Database, LoaderCircle, Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, type SlicePlayerJob } from '../api/client'
import { useI18n } from '../i18n'
import { LazyViewer3D, type ViewerManifest } from './viewer/LazyViewer3D'

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** order).toFixed(order > 1 ? 1 : 0)} ${units[order]}`
}

function stageLabel(stage: string) {
  switch (stage) {
    case 'queued': return 'Waiting for the preparation worker'
    case 'downloading-archive': return 'Downloading the Slice archive to bounded local storage'
    case 'scanning-archive': return 'Scanning frames without extracting the full archive'
    case 'converting-frames': return 'Converting VTU pieces into bounded playable frames'
    case 'persisting-frame-index': return 'Persisting the random-access frame index'
    case 'restoring-player-cache': return 'Restoring the existing player cache'
    case 'completed': return 'Archive index is ready'
    case 'cancelled': return 'Preparation was cancelled'
    default: return stage
  }
}

type SlicePlaybackFrame = NonNullable<NonNullable<SlicePlayerJob['report']>['playback']>['frames'][number]

export const SLICE_PLAYBACK_FPS_OPTIONS = [1, 2, 5, 10, 15, 20, 24, 30] as const

export function selectPlaybackAsset(frame: SlicePlaybackFrame) {
  return {
    manifestPath: frame.manifest_path,
    vertices: frame.vertices,
    triangles: frame.triangles,
  }
}

function SlicePlayback({ caseId, job }: { caseId: string; job: SlicePlayerJob }) {
  const { t } = useI18n()
  const playback = job.report?.playback
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(2)
  const [selectedField, setSelectedField] = useState<string | null>(playback?.fields[0] ?? null)
  const frame = playback?.frames[frameIndex]

  useEffect(() => {
    if (!playing || !playback || playback.frame_count < 2) return
    const timer = window.setInterval(() => setFrameIndex((value) => (value + 1) % playback.frame_count), 1000 / fps)
    return () => window.clearInterval(timer)
  }, [fps, playing, playback?.frame_count])

  const manifest = useMemo<ViewerManifest | null>(() => {
    if (!frame || !playback) return null
    const { manifestPath, vertices, triangles } = selectPlaybackAsset(frame)
    const assetPath = manifestPath.split('/').map(encodeURIComponent).join('/')
    return {
      asset_url: `/api/flow360/resources/Case/${encodeURIComponent(caseId)}/slice-player/jobs/${encodeURIComponent(job.id)}/assets/${assetPath}`,
      format: 'flow360-uvf',
      bounding_box: { min: frame.bounds[0], max: frame.bounds[1] },
      groups: [{ id: 'slice', name: 'Slice', color: '#789521', visible: true, triangles, vertices }],
      vertices,
      elements: triangles,
    }
  }, [caseId, frame, job.id, playback])

  if (!playback?.ready || !frame || !manifest) return null
  const move = (next: number) => setFrameIndex(Math.max(0, Math.min(playback.frame_count - 1, next)))
  return (
    <section className="slice-playback">
      <div className="slice-playback-viewer">
        <LazyViewer3D manifest={manifest} state={{ status: 'ready' }} selectedField={selectedField} onSelectedFieldChange={setSelectedField}
          fieldNames={playback.fields} fieldRange={selectedField ? playback.field_ranges[selectedField] ?? null : null}
          showEntityLegend={false} showWarnings={false} preserveCameraOnAssetChange />
      </div>
      <div className="slice-playback-controls">
        <button aria-label={t('First frame')} onClick={() => { setPlaying(false); move(0) }}><SkipBack size={15} /></button>
        <button className="slice-playback-primary" aria-label={playing ? t('Pause') : t('Play')} onClick={() => setPlaying((value) => !value)} disabled={playback.frame_count < 2}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button aria-label={t('Next frame')} onClick={() => { setPlaying(false); move(frameIndex + 1) }}><SkipForward size={15} /></button>
        <input aria-label={t('Frame')} type="range" min={0} max={Math.max(0, playback.frame_count - 1)} value={frameIndex}
          onPointerDown={() => setPlaying(false)}
          onChange={(event) => { setPlaying(false); move(Number(event.target.value)) }} />
        <span>{frameIndex + 1} / {playback.frame_count}<small>{t('step')} {frame.step ?? '—'}</small></span>
        <small className="slice-playback-quality full">{t('Full resolution')}</small>
        <select aria-label={t('Playback speed')} value={fps} onChange={(event) => setFps(Number(event.target.value))}>
          {SLICE_PLAYBACK_FPS_OPTIONS.map((value) => <option key={value} value={value}>{value} {t('fps')}</option>)}
        </select>
      </div>
    </section>
  )
}

export default function CaseSlicePlayerPanel({
  caseId,
  resultPath,
  sizeBytes = 0,
}: {
  caseId: string
  resultPath: string
  sizeBytes?: number
}) {
  const { t } = useI18n()
  const [job, setJob] = useState<SlicePlayerJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api.latestSlicePlayer(caseId)
      .then((latest) => {
        const sameSource = latest.result_path === resultPath
          && (!sizeBytes || !latest.source_size || latest.source_size === sizeBytes)
        const currentPlayer = !latest.report || latest.report.index_version >= 4
        if (active && sameSource && currentPlayer) setJob(latest)
      })
      .catch(() => undefined)
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [caseId, resultPath])

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return
    const timer = window.setInterval(() => {
      api.slicePlayerJob(caseId, job.id)
        .then(setJob)
        .catch((cause) => setError(String(cause).replace('Error: ', '')))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [caseId, job?.id, job?.status])

  const prepare = async () => {
    setActionBusy(true)
    setError('')
    try {
      setJob(await api.startSlicePlayer(caseId, resultPath, sizeBytes))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setActionBusy(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    setActionBusy(true)
    setError('')
    try {
      setJob(await api.cancelSlicePlayer(caseId, job.id))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setActionBusy(false)
    }
  }

  if (loading) {
    return <div className="slice-player-state" role="status"><LoaderCircle className="spin" size={18} />{t('Reading Slice player state…')}</div>
  }

  const running = job?.status === 'queued' || job?.status === 'running'
  const completed = job?.status === 'completed' && job.report?.index_ready
  return (
    <div className="slice-player-panel">
      <section className="slice-player-source">
        <Database size={17} />
        <span><strong>{resultPath}</strong><small>{formatBytes(sizeBytes)}</small></span>
      </section>

      {!job && (
        <section className="slice-player-empty">
          <Play size={24} />
          <strong>{t('Prepare the time-series Slice player')}</strong>
          <p>{t('The archive is downloaded to local storage and scanned sequentially. It is never loaded into browser memory or fully extracted.')}</p>
          <button className="geometry-plan-action" disabled={actionBusy} onClick={() => void prepare()}>
            {actionBusy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}{t('Prepare player')}
          </button>
        </section>
      )}

      {job && !completed && (
        <section className={`slice-player-progress ${job.status}`}>
          <div><strong>{t(stageLabel(job.stage))}</strong><span>{job.progress}%</span></div>
          <progress max={100} value={job.progress} aria-label={t('Slice player preparation progress')} />
          {running && <button className="toolbar-refresh" disabled={actionBusy} onClick={() => void cancel()}><Square size={12} />{t('Cancel preparation')}</button>}
          {(job.status === 'failed' || job.status === 'cancelled') && <button className="geometry-plan-action" disabled={actionBusy} onClick={() => void prepare()}>{t('Try preparation again')}</button>}
        </section>
      )}

      {(error || job?.error) && <div className="slice-player-error" role="alert"><AlertCircle size={15} />{error || job?.error}</div>}

      {completed && job?.report && (
        <>
          {job.report.playback?.ready && <SlicePlayback caseId={caseId} job={job} />}
          <section className="slice-player-ready" role="status">
            <CheckCircle2 size={18} />
            <span><strong>{t('Slice archive indexed')}</strong><small>{t('The frame index is cached and can be reused without downloading the archive again.')}</small></span>
          </section>
          <dl className="slice-player-facts">
            <div><dt>{t('Slices')}</dt><dd>{job.report.slices.length}</dd></div>
            <div><dt>{t('Archive entries')}</dt><dd>{job.report.entry_count.toLocaleString()}</dd></div>
            <div><dt>{t('Compressed')}</dt><dd>{formatBytes(job.report.compressed_bytes)}</dd></div>
            <div><dt>{t('Expanded stream')}</dt><dd>{formatBytes(job.report.uncompressed_bytes)}</dd></div>
          </dl>
          <section className="slice-player-slices">
            {job.report.slices.map((slice) => (
              <article key={slice.name}>
                <span><strong>{slice.name}</strong><small>{slice.fields?.join(', ') || slice.formats.join(', ') || t('Unknown format')}</small></span>
                <span><strong>{slice.frame_count.toLocaleString()}</strong><small>{t('frames')}</small></span>
                <span><strong>{slice.first_step ?? '—'} → {slice.last_step ?? '—'}</strong><small>{t('global steps')}</small></span>
              </article>
            ))}
            {!job.report.slices.length && <div className="slice-player-state">{t('No named Slice sequence was found in the archive.')}</div>}
          </section>
          <p className="slice-player-next">{t('Frames are loaded on demand. Global field ranges stay fixed during playback so colors remain comparable over time.')}</p>
        </>
      )}
    </div>
  )
}
