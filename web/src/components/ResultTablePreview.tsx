import { AlertCircle, BarChart3, FileSpreadsheet, RefreshCw, Table2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { useFocusTrap } from '../lib/useFocusTrap'
import { DatasetPicker, datasetCompatibility, recommendResultChart, ResultChartPanel, type ChartDataset } from './ResultChartPanel'

const MAX_CHART_ROWS = 5000
const MAX_TABLE_ROWS = 200
const MAX_PREVIEW_COLUMNS = 40

export type ParsedResultTable = {
  headers: string[]
  rows: string[][]
  totalRows: number
  truncated: boolean
  delimiter: 'comma' | 'tab' | 'whitespace'
}

function parseQuotedRows(content: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && content[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim() !== '')) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }

  row.push(cell)
  if (row.some((value) => value.trim() !== '')) rows.push(row)
  return rows
}

function detectDelimiter(content: string, path: string): ',' | '\t' | 'whitespace' {
  if (/\.csv$/i.test(path)) return ','
  const firstLine = content.split(/\r?\n/, 1)[0] ?? ''
  const commaCount = (firstLine.match(/,/g) ?? []).length
  const tabCount = (firstLine.match(/\t/g) ?? []).length
  if (tabCount > commaCount && tabCount > 0) return '\t'
  if (commaCount > 0) return ','
  return 'whitespace'
}

export function isTabularResult(path?: string, fileType?: string): boolean {
  const normalizedType = fileType?.toLowerCase()
  return normalizedType === 'csv'
    || normalizedType === 'txt'
    || normalizedType === 'dat'
    || Boolean(path && /\.(csv|txt|dat)$/i.test(path))
}

export function parseResultTable(content: string, path = ''): ParsedResultTable {
  const detected = detectDelimiter(content, path)
  const parsedRows = detected === 'whitespace'
    ? content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/))
    : parseQuotedRows(content, detected)

  let columnCount = Math.min(
    MAX_PREVIEW_COLUMNS,
    Math.max(1, ...parsedRows.map((row) => row.length)),
  )
  while (
    columnCount > 1
    && parsedRows.every((row) => (row[columnCount - 1] ?? '').trim() === '')
  ) {
    columnCount -= 1
  }
  const firstRow = parsedRows[0] ?? []
  const headers = Array.from({ length: columnCount }, (_, index) => (
    firstRow[index]?.trim() || `Column ${index + 1}`
  ))
  const dataRows = parsedRows.slice(1)
  const rows = dataRows.slice(0, MAX_CHART_ROWS).map((row) => (
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  ))

  return {
    headers,
    rows,
    totalRows: dataRows.length,
    truncated: dataRows.length > MAX_CHART_ROWS || parsedRows.some((row) => row.length > MAX_PREVIEW_COLUMNS),
    delimiter: detected === ',' ? 'comma' : detected === '\t' ? 'tab' : 'whitespace',
  }
}

function isNumericCell(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value))
}

export function ResultTablePreview({
  path,
  content,
  loading = false,
  error = '',
  candidates = [],
  loadCandidate,
  onClose,
}: {
  path: string
  content?: string
  loading?: boolean
  error?: string
  candidates?: { path: string; label?: string }[]
  loadCandidate?: (path: string) => Promise<string>
  onClose: () => void
}) {
  const titleId = useId()
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose, 'button.icon-button')
  const table = useMemo(() => content === undefined ? null : parseResultTable(content, path), [content, path])
  const recommendation = useMemo(() => table ? recommendResultChart(table) : null, [table])
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [extraDatasets, setExtraDatasets] = useState<ChartDataset[]>([])
  const [tablePath, setTablePath] = useState(path)
  const [candidateLoading, setCandidateLoading] = useState('')
  const [candidateError, setCandidateError] = useState('')
  const datasets = useMemo<ChartDataset[]>(() => table ? [{ path, table }, ...extraDatasets] : extraDatasets, [extraDatasets, path, table])
  const selectedTable = datasets.find((dataset) => dataset.path === tablePath) ?? datasets[0]

  useEffect(() => {
    setExtraDatasets([])
    setTablePath(path)
    setCandidateError('')
  }, [path])

  useEffect(() => {
    if (recommendation && recommendation.yColumns.length === 0) setView('table')
  }, [recommendation])

  const addDataset = async (candidatePath: string) => {
    if (!loadCandidate || !table || datasets.length >= 3) return
    setCandidateLoading(candidatePath)
    setCandidateError('')
    try {
      const candidateContent = await loadCandidate(candidatePath)
      const candidateTable = parseResultTable(candidateContent, candidatePath)
      const compatibility = datasetCompatibility(table, candidateTable)
      if (!compatibility.compatible) {
        setCandidateError(`${candidatePath.split('/').pop()}: ${compatibility.reason}`)
        return
      }
      setExtraDatasets((current) => [...current, { path: candidatePath, table: candidateTable }])
    } catch (candidateFailure) {
      setCandidateError(String(candidateFailure).replace('Error: ', ''))
    } finally {
      setCandidateLoading('')
    }
  }

  return (
    <div ref={dialogRef} className="result-preview-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <section className="result-preview-dialog">
        <header className="result-preview-header">
          <div>
            <FileSpreadsheet size={16} />
            <span>
              <strong id={titleId}>{path.split('/').pop() || path}</strong>
              <small>{path}</small>
            </span>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close result preview"><X size={15} /></button>
        </header>

        {loading && (
          <div className="result-preview-state" role="status">
            <RefreshCw size={18} className="spin" /> Loading result data…
          </div>
        )}
        {error && (
          <div className="result-preview-state error" role="alert">
            <AlertCircle size={18} /> {error}
          </div>
        )}
        {!loading && !error && table && (
          <>
            <div className="result-preview-meta">
              <span>{table.totalRows.toLocaleString()} data rows</span>
              <span>{table.headers.length} columns</span>
              <span>{table.delimiter} separated</span>
              {table.truncated && <em>Chart data truncated</em>}
              {table.totalRows > MAX_TABLE_ROWS && <em>Table shows first {MAX_TABLE_ROWS}</em>}
              <div className="result-preview-view-toggle" role="group" aria-label="Result view">
                <button className={view === 'chart' ? 'selected' : ''} onClick={() => setView('chart')} disabled={!recommendation?.yColumns.length}><BarChart3 size={12} />Chart</button>
                <button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}><Table2 size={12} />Table</button>
              </div>
            </div>
            {view === 'chart' && recommendation && (
              <>
                {loadCandidate && candidates.length > 0 && (
                  <DatasetPicker candidates={datasets.length >= 3 ? [] : candidates} selected={datasets.map((dataset) => dataset.path)} loadingPath={candidateLoading} error={candidateError} onAdd={(candidatePath) => void addDataset(candidatePath)} />
                )}
                <ResultChartPanel
                  datasets={datasets}
                  recommendation={recommendation}
                  onRemoveDataset={(datasetPath) => {
                    setExtraDatasets((current) => current.filter((dataset) => dataset.path !== datasetPath))
                    if (tablePath === datasetPath) setTablePath(path)
                  }}
                />
              </>
            )}
            {view === 'table' && selectedTable && (
              <div className="result-preview-content">
                {datasets.length > 1 && (
                  <label className="result-table-dataset-select">Dataset<select value={selectedTable.path} onChange={(event) => setTablePath(event.target.value)}>{datasets.map((dataset) => <option value={dataset.path} key={dataset.path}>{dataset.path.split('/').pop()}</option>)}</select></label>
                )}
                <table className="result-preview-table">
                  <thead>
                    <tr>{selectedTable.table.headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}</tr>
                  </thead>
                  <tbody>
                    {selectedTable.table.rows.slice(0, MAX_TABLE_ROWS).map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <td className={isNumericCell(cell) ? 'numeric' : ''} key={cellIndex}>{cell || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {selectedTable.table.rows.length === 0 && <div className="result-preview-empty">This result contains headers but no data rows.</div>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
