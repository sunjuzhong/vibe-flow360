import { AlertCircle, BarChart3, FileSpreadsheet, Loader2, RefreshCw, Sparkles, Table2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api, type ResultInterpretationRequest } from '../api/client'
import { useI18n } from '../i18n'
import { useFocusTrap } from '../lib/useFocusTrap'
import { DatasetPicker, datasetCompatibility, recommendResultChart, ResultChartPanel, type ChartDataset } from './ResultChartPanel'

const MAX_CHART_ROWS = 5000
const MAX_TABLE_ROWS = 200
const MAX_PREVIEW_COLUMNS = 40

export type ParsedResultTable = {
  headers: string[]
  rows: string[][]
  analysisRows: string[][]
  totalRows: number
  truncated: boolean
  delimiter: 'comma' | 'tab' | 'whitespace'
}

export function summarizeResultTable(table: ParsedResultTable, path: string, language: string): ResultInterpretationRequest {
  const clip = (value: string, maximum = 500) => value.length > maximum ? `${value.slice(0, maximum)}…` : value
  const columns = table.headers.map((field, columnIndex) => {
    const values = table.analysisRows.map((row) => row[columnIndex] ?? '')
    const present = values.filter((value) => value.trim() !== '')
    const numbers = present.map(Number).filter(Number.isFinite)
    const numeric = present.length > 0 && numbers.length / present.length >= 0.9
    const base = {
      field: clip(field, 160),
      kind: numeric ? 'numeric' as const : 'text' as const,
      count: present.length,
      missing: values.length - present.length,
      unique: new Set(present).size,
      first: present[0] === undefined ? undefined : clip(present[0]),
      last: present[present.length - 1] === undefined ? undefined : clip(present[present.length - 1]),
    }
    if (!numeric) return { ...base, sample_values: Array.from(new Set(present)).slice(0, 8).map((value) => clip(value)) }
    return {
      ...base,
      minimum: Math.min(...numbers),
      maximum: Math.max(...numbers),
      mean: numbers.reduce((sum, value) => sum + value, 0) / numbers.length,
    }
  })
  const sampleIndexes = new Set<number>()
  const sampleCount = Math.min(24, table.analysisRows.length)
  for (let index = 0; index < sampleCount; index += 1) {
    sampleIndexes.add(sampleCount === 1 ? 0 : Math.round(index * (table.analysisRows.length - 1) / (sampleCount - 1)))
  }
  return {
    path,
    language,
    total_rows: table.totalRows,
    delimiter: table.delimiter,
    columns,
    sample_rows: Array.from(sampleIndexes).map((rowIndex) => Object.fromEntries(
      table.headers.map((header, columnIndex) => [clip(header, 160), clip(table.analysisRows[rowIndex]?.[columnIndex] ?? '')]),
    )),
  }
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
  const analysisRows = dataRows.map((row) => (
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  ))
  const rows = analysisRows.slice(0, MAX_CHART_ROWS)

  return {
    headers,
    rows,
    analysisRows,
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
  const { t, language } = useI18n()
  const titleId = useId()
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose, 'button.icon-button')
  const table = useMemo(() => content === undefined ? null : parseResultTable(content, path), [content, path])
  const recommendation = useMemo(() => table ? recommendResultChart(table) : null, [table])
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [extraDatasets, setExtraDatasets] = useState<ChartDataset[]>([])
  const [tablePath, setTablePath] = useState(path)
  const [candidateLoading, setCandidateLoading] = useState('')
  const [candidateError, setCandidateError] = useState('')
  const [interpretation, setInterpretation] = useState('')
  const [interpretationError, setInterpretationError] = useState('')
  const [interpreting, setInterpreting] = useState(false)
  const datasets = useMemo<ChartDataset[]>(() => table ? [{ path, table }, ...extraDatasets] : extraDatasets, [extraDatasets, path, table])
  const selectedTable = datasets.find((dataset) => dataset.path === tablePath) ?? datasets[0]

  useEffect(() => {
    setExtraDatasets([])
    setTablePath(path)
    setCandidateError('')
    setInterpretation('')
    setInterpretationError('')
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

  const interpret = async () => {
    if (!table || interpreting) return
    setInterpreting(true)
    setInterpretationError('')
    try {
      const result = await api.interpretResult(summarizeResultTable(table, path, language))
      setInterpretation(result.interpretation)
    } catch (failure) {
      setInterpretationError(String(failure).replace('Error: ', ''))
    } finally {
      setInterpreting(false)
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
          <button className="icon-button" onClick={onClose} aria-label={t('Close result preview')}><X size={15} /></button>
        </header>

        {loading && (
          <div className="result-preview-state" role="status">
            <RefreshCw size={18} className="spin" /> {t('Loading result data…')}
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
              <span>{t(`${table.totalRows.toLocaleString()} data rows`)}</span>
              <span>{t(`${table.headers.length} columns`)}</span>
              <span>{t(`${table.delimiter} separated`)}</span>
              {table.truncated && <em>{t('Chart data truncated')}</em>}
              {table.totalRows > MAX_TABLE_ROWS && <em>{t(`Table shows first ${MAX_TABLE_ROWS}`)}</em>}
              <button className="result-ai-trigger" type="button" onClick={() => void interpret()} disabled={interpreting || table.rows.length === 0}>
                {interpreting ? <Loader2 className="spin" size={12} /> : <Sparkles size={12} />}
                {t(interpreting ? 'Interpreting…' : interpretation ? 'Interpret again' : 'AI interpretation')}
              </button>
              <div className="result-preview-view-toggle" role="group" aria-label={t('Result view')}>
                <button className={view === 'chart' ? 'selected' : ''} onClick={() => setView('chart')} disabled={!recommendation?.yColumns.length}><BarChart3 size={12} />{t('Chart')}</button>
                <button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}><Table2 size={12} />{t('Table')}</button>
              </div>
            </div>
            {(interpretation || interpretationError) && (
              <section className={`result-ai-interpretation${interpretationError ? ' error' : ''}`} aria-live="polite">
                <header><Sparkles size={14} /><strong>{t('AI interpretation')}</strong><button type="button" onClick={() => { setInterpretation(''); setInterpretationError('') }} aria-label={t('Close AI interpretation')}><X size={12} /></button></header>
                {interpretationError ? <p role="alert">{t(interpretationError)}</p> : <ReactMarkdown>{interpretation}</ReactMarkdown>}
              </section>
            )}
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
                  <label className="result-table-dataset-select">{t('Dataset')}<select value={selectedTable.path} onChange={(event) => setTablePath(event.target.value)}>{datasets.map((dataset) => <option value={dataset.path} key={dataset.path}>{dataset.path.split('/').pop()}</option>)}</select></label>
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
                {selectedTable.table.rows.length === 0 && <div className="result-preview-empty">{t('This result contains headers but no data rows.')}</div>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
