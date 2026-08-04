import {
  AlertCircle,
  BarChart3,
  Braces,
  Download,
  Eye,
  FileOutput,
  FileText,
  Info,
  RefreshCw,
  ScrollText,
  GitCompare,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ResourceDetail } from '../api/client'
import { useConvergenceAssessment } from '../hooks/useConvergenceAssessment'
import { useFocusTrap } from '../lib/useFocusTrap'

export type ResourceDetailTab = 'overview' | 'summary' | 'parameters' | 'results' | 'logs' | 'convergence' | 'compare'

type TabDef = { id: ResourceDetailTab; label: string; icon: React.ComponentType<{ size?: number }>; disabled?: boolean; badge?: string }

type Props = {
  detail: ResourceDetail | null
  loading: boolean
  error: string
  resourceType: string
  resourceId: string
  onRetry: () => void
  dataSource?: 'live' | 'cache'
  cachedAt?: string
  initialTab?: ResourceDetailTab
}

const baseTabs: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'summary', label: 'Summary', icon: FileText },
  { id: 'parameters', label: 'Parameters', icon: Braces },
]

function formatDate(value: string): string {
  try {
    const date = new Date(value)
    if (isNaN(date.getTime())) return value
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return value
  }
}

function formatValue(value: unknown, key?: string): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string' && (key === 'created_at' || key === 'updated_at' || key?.endsWith('_at'))) return formatDate(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    return value.map((part) => formatValue(part)).join(', ')
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function humanize(key: string) {
  return key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatBytes(value?: number) {
  if (value === undefined) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

function JsonView({ value, empty }: { value: unknown; empty: string }) {
  if (value === undefined || value === null) {
    return <div className="detail-empty">{empty}</div>
  }
  return <pre className="resource-json">{JSON.stringify(value, null, 2)}</pre>
}

export function resourceStatus(detail: ResourceDetail | null) {
  const stateStatus = detail?.state?.status ?? detail?.state?.state
  const infoStatus = detail?.info?.status
  return typeof stateStatus === 'string'
    ? stateStatus
    : typeof infoStatus === 'string'
      ? infoStatus
      : 'unknown'
}

export default function ResourceDetailPanel({
  detail,
  loading,
  error,
  resourceType,
  resourceId,
  onRetry,
  dataSource = 'live',
  cachedAt = '',
  initialTab = 'overview',
}: Props) {
  const [tab, setTab] = useState<ResourceDetailTab>(initialTab)
  const [logs, setLogs] = useState('')
  const [logsError, setLogsError] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [logsTail, setLogsTail] = useState(200)
  const [logsElapsed, setLogsElapsed] = useState('')
  const [logsCache, setLogsCache] = useState<Map<string, string>>(new Map())
  const [previewResult, setPreviewResult] = useState<{ path: string; content: string } | null>(null)
  const [resultError, setResultError] = useState('')
  const [resultAction, setResultAction] = useState<{ path: string; kind: 'preview' | 'download' } | null>(null)
  const previewOpen = previewResult !== null
  const previewRef = useFocusTrap<HTMLDivElement>(previewOpen, () => setPreviewResult(null), 'button.icon-button')
  const {
    result: convergence,
    loading: convergenceLoading,
    error: convergenceError,
    refetch: refetchConvergence,
  } = useConvergenceAssessment(resourceType === 'Case' ? resourceId : null)

  const tabs = useMemo(() => {
    const next = [...baseTabs]
    if (resourceType === 'Case') {
      next.push({ id: 'results', label: 'Results', icon: FileOutput })
      next.push({ id: 'convergence', label: 'Convergence', icon: BarChart3 })
      next.push({ id: 'compare', label: 'Compare', icon: GitCompare })
    }
    if (resourceType !== 'Draft') next.push({ id: 'logs', label: 'Logs', icon: ScrollText })
    return next
  }, [resourceType])

  useEffect(() => {
    setTab(initialTab)
    setLogs('')
    setLogsError('')
    setLogsElapsed('')
    setPreviewResult(null)
    setResultError('')
    setResultAction(null)
  }, [initialTab, resourceId])

  const loadLogs = useCallback((force = false) => {
    const cacheKey = `${resourceType}/${resourceId}/${logsTail}`
    if (!force && logsCache.has(cacheKey)) {
      setLogs(logsCache.get(cacheKey)!)
      setLogsError('')
      return
    }
    setLogsLoading(true)
    setLogsError('')
    setLogs('')
    const start = performance.now()
    api.resourceLogs(resourceType, resourceId, logsTail)
      .then((content) => {
        setLogs(content)
        setLogsCache((prev) => new Map(prev).set(cacheKey, content))
        const elapsed = ((performance.now() - start) / 1000).toFixed(1)
        setLogsElapsed(`${elapsed}s`)
      })
      .catch((cause) => {
        setLogsError(String(cause).replace('Error: ', ''))
        const elapsed = ((performance.now() - start) / 1000).toFixed(1)
        setLogsElapsed(`${elapsed}s`)
      })
      .finally(() => setLogsLoading(false))
  }, [resourceType, resourceId, logsTail, logsCache])

  useEffect(() => {
    if (tab === 'logs') {
      loadLogs()
    }
  }, [tab, loadLogs])

  if (loading) {
    return <section className="resource-detail-card detail-state"><RefreshCw size={18} className="spin" /> Reading resource details…</section>
  }

  if (error || !detail) {
    return (
      <section className="resource-detail-card detail-state error">
        <AlertCircle size={18} />
        <strong>Could not read resource details</strong>
        <span>{error || 'No resource detail was returned.'}</span>
        <button onClick={onRetry}>Retry</button>
      </section>
    )
  }

  const infoEntries = Object.entries(detail.info ?? {}).filter(([key]) =>
    ['status', 'created_at', 'updated_at', 'solver_version', 'project_id', 'parent_id', 'tags'].includes(key),
  )
  const stateEntries = Object.entries(detail.state ?? {}).filter(([key]) =>
    !['id', 'type'].includes(key),
  )
  const results = detail.results?.records ?? []

  return (
    <section className="resource-detail-card">
      {dataSource === 'cache' && (
        <div className="resource-cache-notice">
          Cached resource snapshot
          {cachedAt && <span>Saved {new Date(cachedAt).toLocaleString()}</span>}
        </div>
      )}
      <nav className="resource-tabs" aria-label="Resource details" role="tablist">
        {tabs.map(({ id, label, icon: Icon, disabled, badge }) => (
          <button
            className={`${tab === id ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
            key={id}
            onClick={() => !disabled && setTab(id)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault()
                const direction = event.key === 'ArrowRight' ? 1 : -1
                const index = tabs.findIndex((t) => t.id === id)
                let next = index
                for (let i = 0; i < tabs.length; i++) {
                  next = (next + direction + tabs.length) % tabs.length
                  if (!tabs[next].disabled) break
                }
                const nextId = tabs[next].id
                const nextEl = (event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)
                nextEl?.focus()
                setTab(nextId)
              }
            }}
            disabled={disabled}
            aria-disabled={disabled}
            role="tab"
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
          >
            <Icon size={14} /> {label}
            {id === 'results' && <span>{results.length}</span>}
            {badge && <em className="tab-badge">{badge}</em>}
          </button>
        ))}
      </nav>

      <div className="resource-tab-body">
        {detail.errors && Object.keys(detail.errors).length > 0 && (
          <div className="partial-data-warning">
            <AlertCircle size={14} />
            Some Flow360 fields were unavailable: {Object.keys(detail.errors).join(', ')}
          </div>
        )}

        {tab === 'overview' && (
          <div className="detail-overview">
            <div className="detail-section-heading">
              <div>
                <strong>Resource metadata</strong>
                <span>{dataSource === 'cache' ? 'Go snapshot from local disk' : 'Live data from Flow360'}</span>
              </div>
              <span className={`status-pill status-${resourceStatus(detail).toLowerCase()}`}>{resourceStatus(detail)}</span>
            </div>
            <dl className="detail-field-grid">
              {infoEntries.map(([key, value]) => {
                const formatted = formatValue(value, key)
                if (formatted === '—' && key === 'tags') return null
                return <div key={key}><dt>{humanize(key)}</dt><dd>{formatted}</dd></div>
              })}
            </dl>
            <div className="detail-section-heading compact">
              <div><strong>Execution state</strong><span>Terminal and success indicators</span></div>
            </div>
            <dl className="detail-field-grid">
              {stateEntries.map(([key, value]) => (
                <div key={key}><dt>{humanize(key)}</dt><dd>{formatValue(value, key)}</dd></div>
              ))}
            </dl>
          </div>
        )}

        {tab === 'summary' && (
          <JsonView value={detail.summary} empty="Flow360 did not return a summary for this resource." />
        )}

        {tab === 'parameters' && (
          <JsonView value={detail.simulation_params} empty="Flow360 did not return simulation parameters." />
        )}

        {tab === 'results' && (
          <div>
            {resultError && (
              <div className="detail-log-error result-error" role="alert">
                <AlertCircle size={15} />
                <span>{resultError}</span>
                <button onClick={() => setResultError('')}>Dismiss</button>
              </div>
            )}
            {previewResult && (
              <div
                ref={previewRef}
                className="result-preview-modal"
                role="dialog"
                aria-modal="true"
                aria-label="Result preview"
              >
                <div className="result-preview-header">
                  <strong>{previewResult.path}</strong>
                  <button
                    className="icon-button"
                    onClick={() => setPreviewResult(null)}
                    aria-label="Close preview"
                  >×</button>
                </div>
                <pre className="result-preview-content">{previewResult.content}</pre>
              </div>
            )}
            {results.length ? (
              <div className="result-list">
                <div className="result-list-head"><span>Result file</span><span>Type</span><span>Size</span><span>Actions</span></div>
                {results.map((result, index) => (
                  <div className="result-row" key={`${result.path || result.name}-${index}`}>
                    <span><FileOutput size={14} /><span><strong>{result.name || 'Unnamed result'}</strong><small>{result.path}</small></span></span>
                    <span>{result.file_type || '—'}</span>
                    <span>{formatBytes(result.size_bytes)}</span>
                    <span className="result-actions">
                      {(result.file_type?.toLowerCase() === 'csv' || (result.path && /\.csv$/i.test(result.path)) || (result.path && /\.(txt|dat)$/i.test(result.path))) && (
                        <button
                          className="result-action-btn"
                          onClick={async () => {
                            if (!result.path) return
                            setResultError('')
                            setResultAction({ path: result.path, kind: 'preview' })
                            try {
                              const content = await api.previewResult(resourceType, resourceId, result.path)
                              setPreviewResult({ path: result.path!, content })
                            } catch (e) {
                              setResultError(String(e).replace('Error: ', ''))
                            }
                            finally { setResultAction(null) }
                          }}
                          aria-label="Preview"
                          disabled={resultAction !== null}
                        >
                          {resultAction?.path === result.path && resultAction?.kind === 'preview'
                            ? <RefreshCw size={13} className="spin" />
                            : <Eye size={13} />}
                        </button>
                      )}
                      <button
                        className="result-action-btn"
                        onClick={async () => {
                          if (result.path) {
                            setResultError('')
                            setResultAction({ path: result.path, kind: 'download' })
                            try {
                              await api.downloadResult(resourceType, resourceId, result.path)
                            } catch (e) {
                              setResultError(String(e).replace('Error: ', ''))
                            } finally {
                              setResultAction(null)
                            }
                          }
                        }}
                        aria-label="Download"
                        disabled={resultAction !== null}
                      >
                        {resultAction?.path === result.path && resultAction?.kind === 'download'
                          ? <RefreshCw size={13} className="spin" />
                          : <Download size={13} />}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : <div className="detail-empty">This Case has no result files.</div>}
          </div>
        )}

        {tab === 'convergence' && (
          <div className="convergence-panel">
            <div className="detail-section-heading">
              <div>
                <strong>Deterministic convergence assessment</strong>
                <span>Residual and force histories are analyzed by the Go service, not inferred by AI.</span>
              </div>
              <button className="toolbar-refresh" onClick={() => refetchConvergence()} disabled={convergenceLoading}>
                <RefreshCw size={13} className={convergenceLoading ? 'spin' : ''} /> Refresh
              </button>
            </div>
            {convergenceLoading && <div className="detail-empty"><RefreshCw size={16} className="spin" /> Analyzing result files…</div>}
            {convergenceError && <div className="detail-log-error"><AlertCircle size={15} />{convergenceError}</div>}
            {convergence && (
              <>
                <div className={`convergence-banner convergence-${convergence.status}`}>
                  <BarChart3 size={18} />
                  <div><strong>{humanize(convergence.status)}</strong><p>{convergence.reason}</p></div>
                </div>
                {Object.entries(convergence.assessments).map(([name, assessment]) => (
                  <div className="convergence-metrics" key={name}>
                    <h4>{humanize(name)}</h4>
                    <p>{assessment.reason}</p>
                    <small>
                      Window {assessment.window_size} · threshold {assessment.threshold} · {assessment.algorithm_version}
                    </small>
                    <dl className="detail-field-grid">
                      {Object.entries(assessment.metrics ?? {}).map(([metricName, metric]) => (
                        <div key={metricName}>
                          <dt>{metricName}</dt>
                          <dd>{metric.final} · {metric.stable ? 'stable' : 'unstable'}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === 'compare' && (
          <div className="compare-panel">
            <GitCompare size={18} />
            <strong>Compare this Case</strong>
            <p>Select another Case from this Project to compare SimulationParams, KPI sources, and convergence risk.</p>
            <a
              className="geometry-plan-action"
              href={`/projects/${encodeURIComponent(String(detail.info?.project_id ?? ''))}/compare?cases=${encodeURIComponent(resourceId)}`}
            >
              Open Case Compare
            </a>
          </div>
        )}

        {tab === 'logs' && (
          <div>
            <div className="logs-controls">
              <span className="logs-elapsed">{logsElapsed ? `Loaded in ${logsElapsed}` : ''}</span>
              <label className="logs-tail-select">
                Tail:
                <select value={logsTail} onChange={(e) => { setLogsTail(Number(e.target.value)); setLogs(''); setLogsElapsed('') }}>
                  <option value={50}>50 lines</option>
                  <option value={200}>200 lines</option>
                  <option value={500}>500 lines</option>
                  <option value={1000}>1000 lines</option>
                </select>
              </label>
              <button className="toolbar-refresh" onClick={() => loadLogs(true)} disabled={logsLoading}>
                <RefreshCw size={13} className={logsLoading ? 'spin' : ''} />
                {logsLoading ? 'Loading…' : 'Reload'}
              </button>
            </div>
            {logsLoading && <div className="detail-empty"><RefreshCw size={16} className="spin" /> Reading the latest log lines…</div>}
            {logsError && (
              <div className="detail-log-error">
                <AlertCircle size={15} /><span>{logsError}</span>
                <button onClick={() => loadLogs(true)}>Retry</button>
              </div>
            )}
            {logs && <pre className="resource-logs">{logs}</pre>}
          </div>
        )}
      </div>
    </section>
  )
}
