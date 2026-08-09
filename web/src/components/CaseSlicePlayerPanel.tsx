import { AlertCircle, CheckCircle2, Database, LoaderCircle, Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type SlicePlayerJob } from '../api/client'
import { useI18n } from '../i18n'

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
    case 'persisting-frame-index': return 'Persisting the random-access frame index'
    case 'restoring-index-cache': return 'Restoring the existing frame index'
    case 'completed': return 'Archive index is ready'
    case 'cancelled': return 'Preparation was cancelled'
    default: return stage
  }
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
        if (active && sameSource) setJob(latest)
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
          <p className="slice-player-next">{t('The large-file index is ready. Visual frame conversion will use static-topology deduplication and bounded frame chunks.')}</p>
        </>
      )}
    </div>
  )
}
