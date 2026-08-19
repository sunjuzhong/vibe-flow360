import { AlertCircle, CheckCircle2, Database, LoaderCircle, Maximize2, Minimize2, Pause, Play, SkipBack, SkipForward, Square } from 'lucide-react'
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

export function formatSlicePlayerDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${Math.max(0, milliseconds).toLocaleString()} ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`
  const totalSeconds = Math.round(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
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

export function stageLabel(stage: string) {
  switch (stage) {
    case 'queued': return 'Waiting for the preparation worker'
    case 'recovering': return 'Restoring an interrupted preparation'
    case 'downloading-archive': return 'Downloading the time-series archive to bounded local storage'
    case 'scanning-archive': return 'Scanning frames without extracting the full archive'
    case 'converting-frames': return 'Converting VTU pieces into bounded playable frames'
    case 'preparing-frames': return 'Validating the archive and preparing playable frames in one pass'
    case 'preparing-remaining-frames': return 'First frames are ready while remaining frames continue preparing'
    case 'persisting-frame-index': return 'Persisting the random-access frame index'
    case 'persisting-player-cache': return 'Persisting the playable frame cache'
    case 'restoring-player-cache': return 'Restoring the existing player cache'
    case 'completed': return 'Archive index is ready'
    case 'cancelled': return 'Preparation was cancelled'
    default: return stage
  }
}

export function slicePlayerPartialPlaybackReady(job: SlicePlayerJob | null) {
  return Boolean(
    job
    && job.status !== 'completed'
    && job.report?.partial_ready
    && job.report.playback?.ready
    && job.report.playback.frame_count > 0,
  )
}

export type SlicePlaybackFrame = NonNullable<NonNullable<SlicePlayerJob['report']>['playback']>['frames'][number]

export const SLICE_PLAYBACK_FPS_OPTIONS = [1, 2, 5, 10, 15, 20, 24, 30] as const

export function slicePlaybackPrefetchIndices(current: number, frameCount: number) {
  if (frameCount < 2) return []
  return [...new Set([1, 2, -1]
    .map((offset) => (current + offset + frameCount) % frameCount)
    .filter((index) => index !== current))]
}

export function sliceFrameAssetURL(caseId: string, jobId: string, frame: SlicePlaybackFrame, preview = false) {
  return slicePlayerAssetURL(caseId, jobId, selectPlaybackAsset(frame, preview).manifestPath)
}

export function slicePlaybackFrameKey(caseId: string, jobId: string, frames: SlicePlaybackFrame[], preview = false) {
  return frames.map((frame) => sliceFrameAssetURL(caseId, jobId, frame, preview)).join('|')
}

export function slicePlaybackReadyFrameKey(loadedAssetKey: string, expectedFrameKey: string) {
  return loadedAssetKey === expectedFrameKey ? expectedFrameKey : ''
}

export function slicePlayerAssetURL(caseId: string, jobId: string, manifestPath: string) {
  const assetPath = manifestPath.split('/').map(encodeURIComponent).join('/')
  return `/api/flow360/resources/Case/${encodeURIComponent(caseId)}/slice-player/jobs/${encodeURIComponent(jobId)}/assets/${assetPath}`
}

export function selectPlaybackAsset(frame: SlicePlaybackFrame, preview = false) {
  if (preview && frame.preview_manifest_path) {
    return {
      manifestPath: frame.preview_manifest_path,
      vertices: frame.preview_vertices || frame.vertices,
      triangles: frame.preview_triangles || frame.triangles,
    }
  }
  return {
    manifestPath: frame.manifest_path,
    vertices: frame.vertices,
    triangles: frame.triangles,
  }
}

/** Resolve the wall-clock frame and intentionally skip stale frames when decoding falls behind. */
export function slicePlaybackFrameAtTime(
  startIndex: number,
  elapsedMilliseconds: number,
  fps: number,
  frameCount: number,
) {
  if (frameCount < 1) return 0
  const elapsedFrames = Math.floor(Math.max(0, elapsedMilliseconds) * Math.max(1, fps) / 1000)
  return (Math.max(0, startIndex) + elapsedFrames) % frameCount
}

export function sliceFieldPanelVisible(playing: boolean) {
  return !playing
}

export function slicePlaybackFullscreenLabel(fullscreen: boolean) {
  return fullscreen ? 'Exit full screen' : 'Enter full screen'
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
  preview: boolean,
): ViewerManifest {
  const { manifestPath, vertices, triangles } = selectPlaybackAsset(frame, preview)
  const name = frame.slice || (archiveKind === 'surfaces' ? 'Surface' : 'Slice')
  const prefix = `playback:${name}:`
  return {
    asset_url: slicePlayerAssetURL(caseId, jobId, manifestPath),
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
  const [fullscreen, setFullscreen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
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
  const [readyFrameKey, setReadyFrameKey] = useState('')
  const frameIndexRef = useRef(frameIndex)
  frameIndexRef.current = frameIndex
  const timelineFrame = timeline[frameIndex]
  const frames = timelineFrame?.frames ?? []
  const frame = frames[0]
  const frameAssetKey = useMemo(
    () => slicePlaybackFrameKey(caseId, job.id, frames, playing),
    [caseId, frames, job.id, playing],
  )

  useEffect(() => {
    if (frame && !playing) onFrameChange?.(job, frame, frames)
  }, [frame, frames, job.id, onFrameChange, playing])

  useEffect(() => () => assetCache.dispose(), [assetCache])

  useEffect(() => {
    const syncFullscreenState = () => setFullscreen(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', syncFullscreenState)
    return () => document.removeEventListener('fullscreenchange', syncFullscreenState)
  }, [])

  const readyFrameKeyRef = useRef(readyFrameKey)
  readyFrameKeyRef.current = readyFrameKey
  const frameAssetKeyRef = useRef(frameAssetKey)
  frameAssetKeyRef.current = frameAssetKey

  useEffect(() => {
    if (!playing || timeline.length < 2) return
    const startedAt = performance.now()
    const startIndex = frameIndexRef.current
    let animationFrame = 0
    const tick = (now: number) => {
      const target = slicePlaybackFrameAtTime(startIndex, now - startedAt, fps, timeline.length)
      if (
        target !== frameIndexRef.current
        && readyFrameKeyRef.current === frameAssetKeyRef.current
      ) {
        frameIndexRef.current = target
        setFrameIndex(target)
      }
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [fps, playing, timeline.length])

  useEffect(() => {
    setFrameIndex(0)
    setPlaying(false)
  }, [selectedTracks])

  const timelineAssetURLs = useMemo(() => timeline.map((entry) => entry.frames.map((item) => (
    sliceFrameAssetURL(caseId, job.id, item, playing)
  ))), [caseId, job.id, playing, timeline])

  useEffect(() => {
    const targets = slicePlaybackPrefetchIndices(frameIndex, timelineAssetURLs.length)
      .flatMap((index) => timelineAssetURLs[index])
    assetCache.prefetch(targets)
  }, [assetCache, frameIndex, timelineAssetURLs])

  const manifests = useMemo(() => frames.map((item) => (
    playbackFrameManifest(caseId, job.id, item, archiveKind, playing)
  )), [archiveKind, caseId, frames, job.id, playing])
  const manifest = manifests[0] ?? null
  const currentFrameKeyRef = useRef(frameAssetKey)
  currentFrameKeyRef.current = frameAssetKey
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
    const readyKey = slicePlaybackReadyFrameKey(assetURL, currentFrameKeyRef.current)
    if (readyKey) setReadyFrameKey(readyKey)
  }, [])

  if (!playback?.ready || !frame || !manifest) return null
  const move = (next: number) => {
    const target = Math.max(0, Math.min(timeline.length - 1, next))
    setFrameIndex(target)
  }
  const toggleFullscreen = async () => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement === stage) await document.exitFullscreen()
    else await stage.requestFullscreen()
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
      <div ref={stageRef} className="slice-playback-stage">
        <div className="slice-playback-viewer">
          <LazyViewer3D manifest={manifest} additionalManifests={manifests.slice(1)} state={{ status: 'ready' }} selectedField={selectedField} onSelectedFieldChange={setSelectedField}
            fieldNames={selectedFields} fieldRange={selectedFieldRange}
            showFieldPanel={sliceFieldPanelVisible(playing)}
            showEntityLegend={false} showWarnings={false} preserveCameraOnAssetChange
            deferPickingBVH={playing}
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
          <small className={`slice-playback-quality ${playing ? 'preview' : 'full'}`}>
            {t(playing ? 'Preview while playing' : 'Full resolution')}
          </small>
          <select aria-label={t('Playback speed')} value={fps} onChange={(event) => setFps(Number(event.target.value))}>
            {SLICE_PLAYBACK_FPS_OPTIONS.map((value) => <option key={value} value={value}>{value} {t('fps')}</option>)}
          </select>
          <button className="slice-playback-fullscreen" aria-label={t(slicePlaybackFullscreenLabel(fullscreen))} title={t(slicePlaybackFullscreenLabel(fullscreen))} onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
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
        const currentPlayer = !latest.report || latest.report.index_version >= 6
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
  const partialReady = slicePlayerPartialPlaybackReady(job)
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

      {partialReady && job?.report?.playback && (
        <>
          <section className="slice-player-ready partial" role="status">
            <Play size={18} />
            <span>
              <strong>{t('First playable frames are ready')}</strong>
              <small>{t('{count} complete frames can be explored while the rest continue preparing.').replace('{count}', job.report.playback.frame_count.toLocaleString())}</small>
            </span>
          </section>
          <SlicePlayback caseId={caseId} job={job} archiveKind={archiveKind} onFrameChange={onPlaybackFrameChange} />
          <p className="slice-player-next">{t('Field ranges may expand until preparation is complete; completed frame assets remain immutable.')}</p>
        </>
      )}

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
            {job.report.metrics && (
              <>
                <div><dt>{t('Cache')}</dt><dd>{t(job.report.metrics.cache_hit ? 'Cache hit' : 'Prepared locally')}</dd></div>
                <div><dt>{t(job.report.metrics.cache_hit ? 'Cache restore' : 'Download')}</dt><dd>{formatSlicePlayerDuration(job.report.metrics.cache_hit ? job.report.metrics.cache_restore_milliseconds : job.report.metrics.download_milliseconds)}</dd></div>
                <div><dt>{t('Single-pass preparation')}</dt><dd>{formatSlicePlayerDuration(job.report.metrics.prepare_milliseconds)}</dd></div>
                <div><dt>{t('Cache persistence')}</dt><dd>{formatSlicePlayerDuration(job.report.metrics.persist_milliseconds)}</dd></div>
                <div><dt>{t('Total local time')}</dt><dd>{formatSlicePlayerDuration(job.report.metrics.total_milliseconds)}</dd></div>
              </>
            )}
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
