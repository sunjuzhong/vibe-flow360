import { AlertCircle, CheckCircle2, Database, LoaderCircle, Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type SlicePlayerJob } from '../api/client'
import { useI18n } from '../i18n'
import { UVFAssetLRU } from '../lib/uvf-three'
import { LazyViewer3D, type ViewerManifest } from './viewer/LazyViewer3D'

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const order = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** order).toFixed(order > 1 ? 1 : 0)} ${units[order]}`
}

export type CaseTimeSeriesArchiveKind = 'slices' | 'surfaces'

export function caseTimeSeriesPlayerTitle(kind: CaseTimeSeriesArchiveKind) {
  return kind === 'surfaces' ? 'Time-series Surface player' : 'Time-series Slice player'
}

function prepareTitle(kind: CaseTimeSeriesArchiveKind) {
  return kind === 'surfaces' ? 'Prepare the time-series Surface player' : 'Prepare the time-series Slice player'
}

function indexedTitle(kind: CaseTimeSeriesArchiveKind) {
  return kind === 'surfaces' ? 'Surface archive indexed' : 'Slice archive indexed'
}

function stageLabel(stage: string) {
  switch (stage) {
    case 'queued': return 'Waiting for the preparation worker'
    case 'downloading-archive': return 'Downloading the time-series archive to bounded local storage'
    case 'scanning-archive': return 'Scanning frames without extracting the full archive'
    case 'converting-frames': return 'Converting VTU pieces into bounded playable frames'
    case 'persisting-frame-index': return 'Persisting the random-access frame index'
    case 'restoring-player-cache': return 'Restoring the existing player cache'
    case 'completed': return 'Archive index is ready'
    case 'cancelled': return 'Preparation was cancelled'
    default: return stage
  }
}

export type SlicePlaybackFrame = NonNullable<NonNullable<SlicePlayerJob['report']>['playback']>['frames'][number]

export const SLICE_PLAYBACK_FPS_OPTIONS = [1, 2, 5, 10, 15, 20, 24, 30] as const

export function slicePlaybackPrefetchIndices(current: number, frameCount: number) {
  if (frameCount < 2) return []
  return [...new Set([1, 2, -1]
    .map((offset) => (current + offset + frameCount) % frameCount)
    .filter((index) => index !== current))]
}

export function sliceFrameAssetURL(caseId: string, jobId: string, frame: SlicePlaybackFrame) {
  return slicePlayerAssetURL(caseId, jobId, selectPlaybackAsset(frame).manifestPath)
}

export function slicePlayerAssetURL(caseId: string, jobId: string, manifestPath: string) {
  const assetPath = manifestPath.split('/').map(encodeURIComponent).join('/')
  return `/api/flow360/resources/Case/${encodeURIComponent(caseId)}/slice-player/jobs/${encodeURIComponent(jobId)}/assets/${assetPath}`
}

export function selectPlaybackAsset(frame: SlicePlaybackFrame) {
  return {
    manifestPath: frame.manifest_path,
    vertices: frame.vertices,
    triangles: frame.triangles,
  }
}

export function sliceFieldPanelVisible(playing: boolean) {
  return !playing
}

export type SlicePlaybackTimelineEntry = {
  step?: number
  frames: SlicePlaybackFrame[]
}

export function slicePlaybackTrackNames(frames: SlicePlaybackFrame[], fallbackName = 'Slice') {
  const counts = new Map<string, number>()
  for (const frame of frames) {
    const name = frame.slice || fallbackName
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, frameCount]) => frameCount > 1)
    .map(([name]) => name)
    .sort((left, right) => left.localeCompare(right))
}

export function slicePlaybackTimeline(
  frames: SlicePlaybackFrame[],
  selectedTracks: string[],
  fallbackName = 'Slice',
): SlicePlaybackTimelineEntry[] {
  const tracks = selectedTracks.map((name) => ({
    name,
    frames: frames
      .filter((frame) => (frame.slice || fallbackName) === name)
      .sort((left, right) => (left.step ?? Number.MAX_SAFE_INTEGER) - (right.step ?? Number.MAX_SAFE_INTEGER)
        || left.manifest_path.localeCompare(right.manifest_path)),
  })).filter((track) => track.frames.length > 0)
  if (!tracks.length) return []

  const steppedTracks = tracks.map((track) => new Map(track.frames
    .filter((frame) => frame.step !== undefined)
    .map((frame) => [frame.step!, frame])))
  const commonSteps = [...steppedTracks[0].keys()]
    .filter((step) => steppedTracks.every((track) => track.has(step)))
    .sort((left, right) => left - right)
  if (commonSteps.length > 0) {
    return commonSteps.map((step) => ({ step, frames: steppedTracks.map((track) => track.get(step)!) }))
  }

  const sharedFrameCount = Math.min(...tracks.map((track) => track.frames.length))
  return Array.from({ length: sharedFrameCount }, (_, index) => ({
    step: tracks[0].frames[index].step,
    frames: tracks.map((track) => track.frames[index]),
  }))
}

export function selectedSliceFieldRange(
  frames: SlicePlaybackFrame[],
  selectedTracks: string[],
  fieldName: string | null,
  fallbackName = 'Slice',
): [number, number] | null {
  if (!fieldName || selectedTracks.length === 0) return null
  const selected = new Set(selectedTracks)
  let range: [number, number] | null = null
  for (const frame of frames) {
    if (!selected.has(frame.slice || fallbackName)) continue
    const frameRange = frame.field_ranges?.[fieldName]
    if (!frameRange || !Number.isFinite(frameRange[0]) || !Number.isFinite(frameRange[1])) continue
    range = range
      ? [Math.min(range[0], frameRange[0]), Math.max(range[1], frameRange[1])]
      : [frameRange[0], frameRange[1]]
  }
  return range
}

function playbackFrameManifest(
  caseId: string,
  jobId: string,
  frame: SlicePlaybackFrame,
  archiveKind: CaseTimeSeriesArchiveKind,
): ViewerManifest {
  const { vertices, triangles } = selectPlaybackAsset(frame)
  const name = frame.slice || (archiveKind === 'surfaces' ? 'Surface' : 'Slice')
  const prefix = `playback:${name}:`
  return {
    asset_url: sliceFrameAssetURL(caseId, jobId, frame),
    format: 'flow360-uvf',
    entity_id_prefix: prefix,
    bounding_box: { min: frame.bounds[0], max: frame.bounds[1] },
    groups: [{ id: `${prefix}face-0`, name, color: '#789521', visible: true, triangles, vertices }],
    vertices,
    elements: triangles,
  }
}

function SlicePlayback({ caseId, job, archiveKind, onFrameChange }: {
  caseId: string
  job: SlicePlayerJob
  archiveKind: CaseTimeSeriesArchiveKind
  onFrameChange?: (job: SlicePlayerJob, frame: SlicePlaybackFrame, frames: SlicePlaybackFrame[]) => void
}) {
  const { t } = useI18n()
  const playback = job.report?.playback
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [fps, setFps] = useState(2)
  const [selectedField, setSelectedField] = useState<string | null>(playback?.fields[0] ?? null)
  const fallbackTrackName = archiveKind === 'surfaces' ? 'Surface' : 'Slice'
  const trackNames = useMemo(
    () => slicePlaybackTrackNames(playback?.frames ?? [], fallbackTrackName),
    [fallbackTrackName, playback?.frames],
  )
  const [selectedTracks, setSelectedTracks] = useState<string[]>(() => trackNames.slice(0, 1))
  const timeline = useMemo(
    () => slicePlaybackTimeline(playback?.frames ?? [], selectedTracks, fallbackTrackName),
    [fallbackTrackName, playback?.frames, selectedTracks],
  )
  const assetCache = useMemo(() => new UVFAssetLRU(24), [])
  const frameReadyRef = useRef(false)
  const timelineFrame = timeline[frameIndex]
  const frames = timelineFrame?.frames ?? []
  const frame = frames[0]

  useEffect(() => {
    if (frame && !playing) onFrameChange?.(job, frame, frames)
  }, [frame, frames, job.id, onFrameChange, playing])

  useEffect(() => () => assetCache.dispose(), [assetCache])

  useEffect(() => {
    if (!playing || timeline.length < 2) return
    const timer = window.setInterval(() => {
      if (!frameReadyRef.current) return
      frameReadyRef.current = false
      setFrameIndex((value) => (value + 1) % timeline.length)
    }, 1000 / fps)
    return () => window.clearInterval(timer)
  }, [fps, playing, timeline.length])

  useEffect(() => {
    setFrameIndex(0)
    setPlaying(false)
    frameReadyRef.current = false
  }, [selectedTracks])

  const timelineAssetURLs = useMemo(() => timeline.map((entry) => entry.frames.map((item) => (
    sliceFrameAssetURL(caseId, job.id, item)
  ))), [caseId, job.id, timeline])

  useEffect(() => {
    const targets = slicePlaybackPrefetchIndices(frameIndex, timelineAssetURLs.length)
      .flatMap((index) => timelineAssetURLs[index])
    assetCache.prefetch(targets)
  }, [assetCache, frameIndex, timelineAssetURLs])

  const manifests = useMemo(() => frames.map((item) => (
    playbackFrameManifest(caseId, job.id, item, archiveKind)
  )), [archiveKind, caseId, frames, job.id])
  const manifest = manifests[0] ?? null
  const selectedTrackFrames = useMemo(() => {
    const selected = new Set(selectedTracks)
    return (playback?.frames ?? []).filter((item) => selected.has(item.slice || fallbackTrackName))
  }, [fallbackTrackName, playback?.frames, selectedTracks])
  const selectedFields = useMemo(() => {
    const names = [...new Set(selectedTrackFrames.flatMap((item) => item.fields ?? []))]
    return names.length ? names.sort((left, right) => left.localeCompare(right)) : playback?.fields ?? []
  }, [playback?.fields, selectedTrackFrames])
  const selectedFieldRange = useMemo(
    () => selectedSliceFieldRange(playback?.frames ?? [], selectedTracks, selectedField, fallbackTrackName),
    [fallbackTrackName, playback?.frames, selectedField, selectedTracks],
  )

  useEffect(() => {
    if (selectedField && !selectedFields.includes(selectedField)) setSelectedField(selectedFields[0] ?? null)
  }, [selectedField, selectedFields])

  const handleAssetReady = useCallback((assetURL: string) => {
    if (assetURL === manifest?.asset_url) frameReadyRef.current = true
  }, [manifest?.asset_url])

  if (!playback?.ready || !frame || !manifest) return null
  const move = (next: number) => {
    const target = Math.max(0, Math.min(timeline.length - 1, next))
    setFrameIndex((current) => {
      if (current !== target) frameReadyRef.current = false
      return target
    })
  }
  return (
    <section className="slice-playback">
      {trackNames.length > 1 && (
        <fieldset className="slice-playback-tracks">
          <legend>{t(archiveKind === 'surfaces' ? 'Surface sequences' : 'Slices to play')}</legend>
          <div>
            {trackNames.map((name) => {
              const checked = selectedTracks.includes(name)
              return (
                <label key={name}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={checked && selectedTracks.length === 1}
                    onChange={() => setSelectedTracks((current) => checked
                      ? current.filter((item) => item !== name)
                      : [...current, name])}
                  />
                  <span>{name}</span>
                </label>
              )
            })}
          </div>
          <small>{t('{count} sequences selected and synchronized by shared step').replace('{count}', String(selectedTracks.length))}</small>
        </fieldset>
      )}
      <div className="slice-playback-viewer">
        <LazyViewer3D manifest={manifest} additionalManifests={manifests.slice(1)} state={{ status: 'ready' }} selectedField={selectedField} onSelectedFieldChange={setSelectedField}
          fieldNames={selectedFields} fieldRange={selectedFieldRange}
          showFieldPanel={sliceFieldPanelVisible(playing)}
          showEntityLegend={false} showWarnings={false} preserveCameraOnAssetChange
          uvfAssetCache={assetCache} onAssetReady={handleAssetReady} />
      </div>
      <div className="slice-playback-controls">
        <button aria-label={t('First frame')} onClick={() => { setPlaying(false); move(0) }}><SkipBack size={15} /></button>
        <button className="slice-playback-primary" aria-label={playing ? t('Pause') : t('Play')} onClick={() => setPlaying((value) => !value)} disabled={timeline.length < 2}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button aria-label={t('Next frame')} onClick={() => { setPlaying(false); move(frameIndex + 1) }}><SkipForward size={15} /></button>
        <input aria-label={t('Frame')} type="range" min={0} max={Math.max(0, timeline.length - 1)} value={frameIndex}
          onPointerDown={() => setPlaying(false)}
          onChange={(event) => { setPlaying(false); move(Number(event.target.value)) }} />
        <span>{frameIndex + 1} / {timeline.length}<small>{t('step')} {timelineFrame?.step ?? '—'}</small></span>
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
  archiveKind,
  sizeBytes = 0,
  onPlaybackFrameChange,
}: {
  caseId: string
  resultPath: string
  archiveKind: CaseTimeSeriesArchiveKind
  sizeBytes?: number
  onPlaybackFrameChange?: (job: SlicePlayerJob, frame: SlicePlaybackFrame) => void
}) {
  const { t } = useI18n()
  const [job, setJob] = useState<SlicePlayerJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api.latestSlicePlayer(caseId, resultPath)
      .then((latest) => {
        const sameSource = latest.result_path === resultPath
          && (!sizeBytes || !latest.source_size || latest.source_size === sizeBytes)
        const currentPlayer = !latest.report || latest.report.index_version >= 5
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

  const running = job?.status === 'queued' || job?.status === 'running'
  const completed = job?.status === 'completed' && job.report?.index_ready
  const playableSlices = job?.report?.slices.filter((slice) => slice.frame_count > 1) ?? []

  if (loading) {
    return <div className="slice-player-state" role="status"><LoaderCircle className="spin" size={18} />{t('Reading time-series player state…')}</div>
  }
  return (
    <div className="slice-player-panel">
      <section className="slice-player-source">
        <Database size={17} />
        <span><strong>{resultPath}</strong><small>{formatBytes(sizeBytes)}</small></span>
      </section>

      {!job && (
        <section className="slice-player-empty">
          <Play size={24} />
          <strong>{t(prepareTitle(archiveKind))}</strong>
          <p>{t('The archive is downloaded to local storage and scanned sequentially. It is never loaded into browser memory or fully extracted.')}</p>
          <button className="geometry-plan-action" disabled={actionBusy} onClick={() => void prepare()}>
            {actionBusy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}{t('Prepare player')}
          </button>
        </section>
      )}

      {job && !completed && (
        <section className={`slice-player-progress ${job.status}`}>
          <div><strong>{t(stageLabel(job.stage))}</strong><span>{job.progress}%</span></div>
          <progress max={100} value={job.progress} aria-label={t('Time-series player preparation progress')} />
          {running && <button className="toolbar-refresh" disabled={actionBusy} onClick={() => void cancel()}><Square size={12} />{t('Cancel preparation')}</button>}
          {(job.status === 'failed' || job.status === 'cancelled') && <button className="geometry-plan-action" disabled={actionBusy} onClick={() => void prepare()}>{t('Try preparation again')}</button>}
        </section>
      )}

      {(error || job?.error) && <div className="slice-player-error" role="alert"><AlertCircle size={15} />{error || job?.error}</div>}

      {completed && job?.report && (
        <>
          {job.report.playback?.ready && <SlicePlayback caseId={caseId} job={job} archiveKind={archiveKind} onFrameChange={onPlaybackFrameChange} />}
          <section className="slice-player-ready" role="status">
            <CheckCircle2 size={18} />
            <span><strong>{t(indexedTitle(archiveKind))}</strong><small>{t('The frame index is cached and can be reused without downloading the archive again.')}</small></span>
          </section>
          <dl className="slice-player-facts">
            <div><dt>{t('Sequences')}</dt><dd>{playableSlices.length}</dd></div>
            <div><dt>{t('Archive entries')}</dt><dd>{job.report.entry_count.toLocaleString()}</dd></div>
            <div><dt>{t('Compressed')}</dt><dd>{formatBytes(job.report.compressed_bytes)}</dd></div>
            <div><dt>{t('Expanded stream')}</dt><dd>{formatBytes(job.report.uncompressed_bytes)}</dd></div>
          </dl>
          <section className="slice-player-slices">
            {playableSlices.map((slice) => (
              <article key={slice.name}>
                <span><strong>{slice.name}</strong><small>{slice.fields?.join(', ') || slice.formats.join(', ') || t('Unknown format')}</small></span>
                <span><strong>{slice.frame_count.toLocaleString()}</strong><small>{t('frames')}</small></span>
                <span><strong>{slice.first_step ?? '—'} → {slice.last_step ?? '—'}</strong><small>{t('global steps')}</small></span>
              </article>
            ))}
            {!playableSlices.length && <div className="slice-player-state">{t('No named time sequence was found in the archive.')}</div>}
          </section>
          <p className="slice-player-next">{t('Frames are loaded on demand. Global field ranges stay fixed during playback so colors remain comparable over time.')}</p>
        </>
      )}
    </div>
  )
}
