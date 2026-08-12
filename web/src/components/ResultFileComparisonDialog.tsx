import { AlertCircle, BarChart3, FileSpreadsheet, RefreshCw, Table2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import { useFocusTrap } from '../lib/useFocusTrap'
import JsonPreview from './JsonPreview'
import { profileResultTable, recommendResultChart, ResultChartPanel, type ChartDataset } from './ResultChartPanel'
import { isTabularResult, parseResultTable, type ParsedResultTable } from './ResultTablePreview'

const MAX_COMPARISON_ROWS = 200
const PROGRESSION_HEADER = /^(pseudo_?step|step|iteration|iter|time|physical_?step|index|x|distance|station)$/i

export type ResultFileComparisonCase = {
  id: string
  name: string
  content?: string
}

type ParsedCase = ResultFileComparisonCase & { table: ParsedResultTable }

export function comparableResultHeaders(tables: ParsedResultTable[]): string[] {
  const [baseline, ...candidates] = tables
  if (!baseline) return []
  return baseline.headers.filter((header) => candidates.every((table) => table.headers.includes(header)))
}

export function resultCellDelta(baseline: string, candidate: string): string {
  if (baseline.trim() === '' || candidate.trim() === '') return '—'
  const left = Number(baseline)
  const right = Number(candidate)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return baseline === candidate ? '0' : '—'
  const delta = right - left
  if (delta === 0) return '0'
  return Math.abs(delta) >= 10_000 || Math.abs(delta) < 0.001
    ? delta.toExponential(4)
    : Number(delta.toPrecision(6)).toString()
}

function parseJSON(content?: string): unknown | undefined {
  if (content === undefined) return undefined
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

function resultValue(table: ParsedResultTable, rowIndex: number, header: string): string {
  const columnIndex = table.headers.indexOf(header)
  return columnIndex < 0 ? '' : table.rows[rowIndex]?.[columnIndex] ?? ''
}

export function ResultFileComparisonDialog({ path, cases, loading = false, error = '', onClose }: {
  path: string
  cases: ResultFileComparisonCase[]
  loading?: boolean
  error?: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const titleId = useId()
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose, 'button.icon-button')
  const tabular = isTabularResult(path)
  const parsedCases = useMemo<ParsedCase[]>(() => tabular
    ? cases.flatMap((item) => item.content === undefined ? [] : [{ ...item, table: parseResultTable(item.content, path) }])
    : [], [cases, path, tabular])
  const commonHeaders = useMemo(() => comparableResultHeaders(parsedCases.map((item) => item.table)), [parsedCases])
  const baseRecommendation = useMemo(() => parsedCases[0] ? recommendResultChart(parsedCases[0].table) : null, [parsedCases])
  const commonNumericHeaders = useMemo(() => {
    if (!parsedCases.length) return []
    return commonHeaders.filter((header) => parsedCases.every((item) => (
      profileResultTable(item.table).find((profile) => profile.name === header)?.numeric
    )))
  }, [commonHeaders, parsedCases])
  const measurementHeaders = commonNumericHeaders.filter((header) => !PROGRESSION_HEADER.test(header))
  const defaultHeader = baseRecommendation?.yColumns.find((header) => measurementHeaders.includes(header))
    ?? measurementHeaders[0]
    ?? commonNumericHeaders[0]
    ?? commonHeaders[0]
    ?? ''
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [selectedHeader, setSelectedHeader] = useState(defaultHeader)

  useEffect(() => {
    setSelectedHeader(defaultHeader)
    setView(commonNumericHeaders.length ? 'chart' : 'table')
  }, [defaultHeader, path, commonNumericHeaders.length])

  const datasets = useMemo<ChartDataset[]>(() => parsedCases.map((item) => ({ path: item.name, table: item.table })), [parsedCases])
  const chartRecommendation = baseRecommendation ? {
    ...baseRecommendation,
    yColumns: commonNumericHeaders.includes(selectedHeader) ? [selectedHeader] : [],
  } : null
  const maximumRows = Math.min(MAX_COMPARISON_ROWS, Math.max(0, ...parsedCases.map((item) => item.table.rows.length)))
  const jsonCases = useMemo(() => cases.map((item) => ({ ...item, value: parseJSON(item.content) })), [cases])
  const structuredJSON = /\.json$/i.test(path) && jsonCases.every((item) => item.content === undefined || item.value !== undefined)

  return (
    <div ref={dialogRef} className="result-preview-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <section className="result-preview-dialog result-compare-dialog">
        <header className="result-preview-header">
          <div><FileSpreadsheet size={16} /><span><strong id={titleId}>{t('Compare result file')}</strong><small>{path}</small></span></div>
          <button className="icon-button" onClick={onClose} aria-label={t('Close result preview')}><X size={15} /></button>
        </header>

        {loading && <div className="result-preview-state" role="status"><RefreshCw size={18} className="spin" />{t('Loading result data…')}</div>}
        {error && <div className="result-preview-state error" role="alert"><AlertCircle size={18} />{error}</div>}

        {!loading && !error && tabular && parsedCases.length > 0 && (
          <>
            <div className="result-preview-meta result-compare-meta">
              {parsedCases.map((item, index) => <span key={item.id}>{index === 0 ? t('Baseline') : t('Candidate')}: {item.name} · {item.table.totalRows.toLocaleString()} × {item.table.headers.length}</span>)}
              {parsedCases.some((item) => item.table.totalRows !== parsedCases[0].table.totalRows) && <em>{t('Row counts differ; missing rows remain visible.')}</em>}
              <div className="result-preview-view-toggle" role="group" aria-label={t('Result view')}>
                <button className={view === 'chart' ? 'selected' : ''} onClick={() => setView('chart')} disabled={!commonNumericHeaders.length}><BarChart3 size={12} />{t('Chart')}</button>
                <button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}><Table2 size={12} />{t('Aligned values')}</button>
              </div>
            </div>
            <div className="result-compare-fieldbar">
              <label>{t('Parameter')}<select value={selectedHeader} onChange={(event) => setSelectedHeader(event.target.value)}>{commonHeaders.map((header) => <option value={header} key={header}>{header}</option>)}</select></label>
              <span>{t('Rows are aligned by file order; candidate deltas use the first Case as baseline.')}</span>
            </div>
            {!commonHeaders.length && <div className="result-preview-empty">{t('The files do not have common columns to align.')}</div>}
            {view === 'chart' && selectedHeader && chartRecommendation && <ResultChartPanel key={selectedHeader} datasets={datasets} recommendation={chartRecommendation} />}
            {view === 'table' && selectedHeader && (
              <div className="result-preview-content result-compare-table-wrap">
                <table className="result-preview-table result-compare-table">
                  <thead><tr><th>{t('Row')}</th>{parsedCases.map((item) => <th key={item.id}>{item.name}</th>)}{parsedCases.slice(1).map((item) => <th key={`delta-${item.id}`}>Δ {item.name}</th>)}</tr></thead>
                  <tbody>{Array.from({ length: maximumRows }, (_, rowIndex) => {
                    const baselineValue = resultValue(parsedCases[0].table, rowIndex, selectedHeader)
                    return <tr key={rowIndex}><td className="numeric">{rowIndex + 1}</td>{parsedCases.map((item) => <td className={Number.isFinite(Number(resultValue(item.table, rowIndex, selectedHeader))) ? 'numeric' : ''} key={item.id}>{resultValue(item.table, rowIndex, selectedHeader) || '—'}</td>)}{parsedCases.slice(1).map((item) => <td className="numeric result-compare-delta" key={`delta-${item.id}`}>{resultCellDelta(baselineValue, resultValue(item.table, rowIndex, selectedHeader))}</td>)}</tr>
                  })}</tbody>
                </table>
                {Math.max(...parsedCases.map((item) => item.table.rows.length)) > MAX_COMPARISON_ROWS && <div className="result-preview-empty">{t('Aligned table shows the first 200 rows.')}</div>}
              </div>
            )}
          </>
        )}

        {!loading && !error && !tabular && structuredJSON && <div className="result-compare-raw-grid">{jsonCases.map((item) => <article key={item.id}><strong>{item.name}</strong><JsonPreview value={item.value} /></article>)}</div>}
        {!loading && !error && !tabular && !structuredJSON && <div className="result-compare-raw-grid">{cases.map((item) => <article key={item.id}><strong>{item.name}</strong><pre>{item.content ?? t('No data')}</pre></article>)}</div>}
      </section>
    </div>
  )
}
