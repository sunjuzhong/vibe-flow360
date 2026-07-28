import {
  AlertCircle,
  Braces,
  FileOutput,
  FileText,
  Info,
  RefreshCw,
  ScrollText,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, type ResourceDetail } from '../api/client'

type Tab = 'overview' | 'summary' | 'parameters' | 'results' | 'logs'

type Props = {
  detail: ResourceDetail | null
  loading: boolean
  error: string
  resourceType: string
  resourceId: string
  onRetry: () => void
}

const baseTabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'summary', label: 'Summary', icon: FileText },
  { id: 'parameters', label: 'Parameters', icon: Braces },
]

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.map((part) => formatValue(part)).join(', ')
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
  const stateStatus = detail?.state?.status
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
}: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [logs, setLogs] = useState('')
  const [logsError, setLogsError] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)

  const tabs = useMemo(() => {
    const next = [...baseTabs]
    if (resourceType === 'Case') next.push({ id: 'results', label: 'Results', icon: FileOutput })
    next.push({ id: 'logs', label: 'Logs', icon: ScrollText })
    return next
  }, [resourceType])

  useEffect(() => {
    setTab('overview')
    setLogs('')
    setLogsError('')
  }, [resourceId])

  useEffect(() => {
    if (tab !== 'logs' || logs || logsLoading || logsError) return
    setLogsLoading(true)
    api.resourceLogs(resourceType, resourceId)
      .then(setLogs)
      .catch((cause) => setLogsError(String(cause).replace('Error: ', '')))
      .finally(() => setLogsLoading(false))
  }, [logs, logsError, logsLoading, resourceId, resourceType, tab])

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
      <nav className="resource-tabs" aria-label="Resource details">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>
            <Icon size={14} /> {label}
            {id === 'results' && <span>{results.length}</span>}
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
              <div><strong>Resource metadata</strong><span>Live data from Flow360</span></div>
              <span className={`status-pill status-${resourceStatus(detail).toLowerCase()}`}>{resourceStatus(detail)}</span>
            </div>
            <dl className="detail-field-grid">
              {infoEntries.map(([key, value]) => (
                <div key={key}><dt>{humanize(key)}</dt><dd>{formatValue(value)}</dd></div>
              ))}
            </dl>
            <div className="detail-section-heading compact">
              <div><strong>Execution state</strong><span>Terminal and success indicators</span></div>
            </div>
            <dl className="detail-field-grid">
              {stateEntries.map(([key, value]) => (
                <div key={key}><dt>{humanize(key)}</dt><dd>{formatValue(value)}</dd></div>
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
          results.length ? (
            <div className="result-list">
              <div className="result-list-head"><span>Result file</span><span>Type</span><span>Size</span></div>
              {results.map((result, index) => (
                <div className="result-row" key={`${result.path || result.name}-${index}`}>
                  <span><FileOutput size={14} /><span><strong>{result.name || 'Unnamed result'}</strong><small>{result.path}</small></span></span>
                  <span>{result.file_type || '—'}</span>
                  <span>{formatBytes(result.size_bytes)}</span>
                </div>
              ))}
            </div>
          ) : <div className="detail-empty">This Case has no result files.</div>
        )}

        {tab === 'logs' && (
          <div>
            {logsLoading && <div className="detail-empty"><RefreshCw size={16} className="spin" /> Reading the latest log lines…</div>}
            {logsError && (
              <div className="detail-log-error">
                <AlertCircle size={15} /><span>{logsError}</span>
                <button onClick={() => { setLogsError(''); setLogs('') }}>Retry</button>
              </div>
            )}
            {logs && <pre className="resource-logs">{logs}</pre>}
          </div>
        )}
      </div>
    </section>
  )
}
