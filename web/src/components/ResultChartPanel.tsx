import { BarChart3, Check, LineChart, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../i18n'
import type { ParsedResultTable } from './ResultTablePreview'

export type ChartKind = 'line' | 'bar' | 'scatter'
export type ScaleKind = 'linear' | 'log'

export type ColumnProfile = {
  name: string
  index: number
  numeric: boolean
  numericRatio: number
  uniqueCount: number
  monotonic: boolean
  min?: number
  max?: number
}

export type ChartRecommendation = {
  xColumn: string | null
  yColumns: string[]
  kind: ChartKind
  scale: ScaleKind
  reason: string
  profiles: ColumnProfile[]
}

export type ChartDataset = {
  path: string
  table: ParsedResultTable
}

const SERIES_COLORS = ['#82a61f', '#287f8f', '#d08733', '#7656a6', '#d05161', '#4d74b8', '#4d9174', '#9b6d42']
const X_AXIS_HINTS = /^(pseudo_?step|step|iteration|iter|time|physical_?step|index|x|distance|station)$/i
const SERIES_HINTS = /(residual|force|moment|coefficient|cfl|drag|lift|heat|pressure|temperature|mach|velocity|value|_cont|mom[xyz]|energ|nuhat)/i
const SERIES_PENALTIES = /(step|iteration|iterations|index)/i

function finiteNumber(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function profileResultTable(table: ParsedResultTable): ColumnProfile[] {
  return table.headers.map((name, index) => {
    const values = table.rows.map((row) => row[index] ?? '').filter((value) => value.trim() !== '')
    const numbers = values.map(finiteNumber).filter((value): value is number => value !== null)
    const numericRatio = values.length ? numbers.length / values.length : 0
    const monotonic = numbers.length > 1 && numbers.every((value, position) => position === 0 || value >= numbers[position - 1])
    return {
      name,
      index,
      numeric: numericRatio >= 0.9 && numbers.length > 0,
      numericRatio,
      uniqueCount: new Set(values).size,
      monotonic,
      min: numbers.length ? Math.min(...numbers) : undefined,
      max: numbers.length ? Math.max(...numbers) : undefined,
    }
  })
}

export function recommendResultChart(table: ParsedResultTable): ChartRecommendation {
  const profiles = profileResultTable(table)
  const numeric = profiles.filter((profile) => profile.numeric)
  const candidates = numeric
    .filter((profile) => profile.min !== profile.max)
    .sort((left, right) => {
      const leftScore = Number(SERIES_HINTS.test(left.name)) * 2 - Number(SERIES_PENALTIES.test(left.name))
      const rightScore = Number(SERIES_HINTS.test(right.name)) * 2 - Number(SERIES_PENALTIES.test(right.name))
      return rightScore - leftScore
    })
  const yColumns = candidates.slice(0, 3).map((profile) => profile.name)
  const positiveValues = candidates
    .filter((profile) => yColumns.includes(profile.name))
    .flatMap((profile) => [profile.min, profile.max])
    .filter((value): value is number => value !== undefined && value > 0)
  const scale: ScaleKind = positiveValues.length > 1
    && Math.max(...positiveValues) / Math.min(...positiveValues) >= 1000
    && candidates.filter((profile) => yColumns.includes(profile.name)).every((profile) => (profile.min ?? 0) > 0)
    ? 'log'
    : 'linear'
  const kind: ChartKind = 'line'
  const reason = 'Row index preserves CSV row order even when step columns repeat or reset, so it is used as the default progression axis.'

  return { xColumn: null, yColumns, kind, scale, reason, profiles }
}

export function datasetCompatibility(base: ParsedResultTable, candidate: ParsedResultTable): { compatible: boolean; reason: string; commonNumeric: string[] } {
  if (base.totalRows !== candidate.totalRows) {
    return { compatible: false, reason: `Row count differs (${base.totalRows.toLocaleString()} vs ${candidate.totalRows.toLocaleString()}).`, commonNumeric: [] }
  }
  const baseProfiles = profileResultTable(base)
  const candidateProfiles = profileResultTable(candidate)
  const candidateByName = new Map(candidateProfiles.map((profile) => [profile.name, profile]))
  const commonNumeric = baseProfiles
    .filter((profile) => profile.numeric && candidateByName.get(profile.name)?.numeric)
    .map((profile) => profile.name)
  const sharedMeasurements = commonNumeric.filter((name) => !X_AXIS_HINTS.test(name) && !SERIES_PENALTIES.test(name))
  if (!sharedMeasurements.length) {
    return { compatible: false, reason: 'No shared numeric measurement columns were found beyond the progression axis.', commonNumeric }
  }
  return { compatible: true, reason: `${commonNumeric.length} shared numeric column${commonNumeric.length === 1 ? '' : 's'}.`, commonNumeric }
}

function fileLabel(path: string): string {
  return path.split('/').pop() || path
}

function sampleIndices(length: number, maximum = 320): number[] {
  if (length <= maximum) return Array.from({ length }, (_, index) => index)
  return Array.from({ length: maximum }, (_, index) => Math.round(index * (length - 1) / (maximum - 1)))
}

function formatTick(value: number): string {
  if (value === 0) return '0'
  if (Math.abs(value) >= 10_000 || Math.abs(value) < 0.001) return value.toExponential(1)
  return Number(value.toPrecision(4)).toString()
}

function ChartCanvas({ datasets, xColumn, yColumns, kind, scale }: {
  datasets: ChartDataset[]
  xColumn: string | null
  yColumns: string[]
  kind: ChartKind
  scale: ScaleKind
}) {
  const { t } = useI18n()
  const [hovered, setHovered] = useState<{
    dataset: string
    column: string
    xLabel: string
    value: number
    left: number
    top: number
  } | null>(null)
  const width = 900
  const height = 430
  const margin = { left: 70, right: 24, top: 28, bottom: 54 }
  const plotWidth = width - margin.left - margin.right
  const plotHeight = height - margin.top - margin.bottom
  const xProfile = xColumn ? profileResultTable(datasets[0].table).find((profile) => profile.name === xColumn) : undefined
  const categoryValues = xColumn && xProfile?.numeric === false
    ? Array.from(new Set(datasets[0].table.rows.map((row) => row[datasets[0].table.headers.indexOf(xColumn)] ?? '')))
    : []
  const categoryIndex = new Map(categoryValues.map((value, index) => [value, index]))
  const series = datasets.flatMap((dataset) => yColumns.map((column) => {
    const yIndex = dataset.table.headers.indexOf(column)
    const xIndex = xColumn ? dataset.table.headers.indexOf(xColumn) : -1
    const points = sampleIndices(dataset.table.rows.length).flatMap((rowIndex) => {
      const row = dataset.table.rows[rowIndex]
      const y = finiteNumber(row[yIndex] ?? '')
      const xValue = xIndex >= 0
        ? xProfile?.numeric === false ? categoryIndex.get(row[xIndex] ?? '') ?? null : finiteNumber(row[xIndex] ?? '')
        : rowIndex
      if (y === null || xValue === null || (scale === 'log' && y <= 0)) return []
      return [{ x: xValue, y, rowIndex, xLabel: xIndex >= 0 ? row[xIndex] ?? '' : String(rowIndex) }]
    })
    return { dataset: dataset.path, column, points }
  })).filter((entry) => entry.points.length)

  if (!series.length) {
    return <div className="result-chart-empty"><LineChart size={22} />{t('Choose at least one numeric series to chart.')}</div>
  }

  const xValues = series.flatMap((entry) => entry.points.map((point) => point.x))
  const rawYValues = series.flatMap((entry) => entry.points.map((point) => point.y))
  const yValues = scale === 'log' ? rawYValues.map(Math.log10) : rawYValues
  let xMin = Math.min(...xValues)
  let xMax = Math.max(...xValues)
  let yMin = Math.min(...yValues)
  let yMax = Math.max(...yValues)
  if (xMin === xMax) { xMin -= 1; xMax += 1 }
  if (yMin === yMax) { yMin -= Math.abs(yMin || 1) * 0.1; yMax += Math.abs(yMax || 1) * 0.1 }
  const yPadding = (yMax - yMin) * 0.08
  yMin -= yPadding
  yMax += yPadding
  const xScale = (value: number) => margin.left + (value - xMin) / (xMax - xMin) * plotWidth
  const yScale = (value: number) => margin.top + (1 - ((scale === 'log' ? Math.log10(value) : value) - yMin) / (yMax - yMin)) * plotHeight
  const ticks = Array.from({ length: 5 }, (_, index) => {
    const ratio = index / 4
    const transformed = yMax - ratio * (yMax - yMin)
    return { y: margin.top + ratio * plotHeight, value: scale === 'log' ? 10 ** transformed : transformed }
  })
  const showPoint = (entry: { dataset: string; column: string }, point: { x: number; y: number; xLabel: string }) => {
    setHovered({
      dataset: entry.dataset,
      column: entry.column,
      xLabel: point.xLabel,
      value: point.y,
      left: xScale(point.x) / width * 100,
      top: yScale(point.y) / height * 100,
    })
  }

  return (
    <div className="result-chart-canvas">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t(`${kind} chart of ${yColumns.join(', ')}`)} onPointerLeave={() => setHovered(null)}>
        <defs>
          <linearGradient id="result-chart-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fbfcf8" />
            <stop offset="1" stopColor="#f3f6ed" />
          </linearGradient>
        </defs>
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} rx="8" fill="url(#result-chart-bg)" />
        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={margin.left} x2={width - margin.right} y1={tick.y} y2={tick.y} stroke="#dfe5d7" strokeDasharray="3 5" />
            <text x={margin.left - 10} y={tick.y + 4} textAnchor="end" className="result-chart-axis-text">{formatTick(tick.value)}</text>
          </g>
        ))}
        <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} stroke="#aeb9a4" />
        {series.map((entry, seriesIndex) => {
          const color = SERIES_COLORS[seriesIndex % SERIES_COLORS.length]
          const points = entry.points.map((point) => `${xScale(point.x)},${yScale(point.y)}`).join(' ')
          if (kind === 'bar' && series.length === 1) {
            const barWidth = Math.max(2, Math.min(34, plotWidth / Math.max(1, entry.points.length) * 0.65))
            return <g key={`${entry.dataset}-${entry.column}`}>{entry.points.map((point) => {
              const y = yScale(point.y)
              return <rect key={point.rowIndex} x={xScale(point.x) - barWidth / 2} y={y} width={barWidth} height={Math.max(1, height - margin.bottom - y)} rx="2" fill={color} opacity=".84" tabIndex={0} aria-label={`${xColumn ?? t('Row')}: ${point.xLabel}; ${entry.column}: ${point.y}`} onPointerEnter={() => showPoint(entry, point)} onFocus={() => showPoint(entry, point)} onBlur={() => setHovered(null)} />
            })}</g>
          }
          return (
            <g key={`${entry.dataset}-${entry.column}`}>
              {kind === 'line' && <polyline points={points} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
              {entry.points.map((point, pointIndex) => (
                <circle className="result-chart-hit-point" key={`hit-${point.rowIndex}`} cx={xScale(point.x)} cy={yScale(point.y)} r="7" fill="transparent" tabIndex={pointIndex % Math.max(1, Math.floor(entry.points.length / 40)) === 0 ? 0 : -1} aria-label={`${xColumn ?? t('Row')}: ${point.xLabel}; ${entry.column}: ${point.y}`} onPointerEnter={() => showPoint(entry, point)} onFocus={() => showPoint(entry, point)} onBlur={() => setHovered(null)} />
              ))}
              {entry.points.filter((_, pointIndex) => kind === 'scatter' || pointIndex % Math.max(1, Math.floor(entry.points.length / 40)) === 0).map((point) => (
                <circle key={point.rowIndex} cx={xScale(point.x)} cy={yScale(point.y)} r={kind === 'scatter' ? 3 : 2.2} fill={color} pointerEvents="none" />
              ))}
            </g>
          )
        })}
        <text x={margin.left + plotWidth / 2} y={height - 15} textAnchor="middle" className="result-chart-label">{xColumn ?? t('Row index')}</text>
        <text transform={`translate(17 ${margin.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle" className="result-chart-label">{t(scale === 'log' ? 'Value · log₁₀ scale' : 'Value')}</text>
      </svg>
      {hovered && (
        <div className="result-chart-tooltip" role="tooltip" style={{ left: `${hovered.left}%`, top: `${hovered.top}%` }}>
          <strong>{fileLabel(hovered.dataset)}</strong>
          <dl>
            <div><dt>{xColumn ?? t('Row')}</dt><dd>{hovered.xLabel}</dd></div>
            <div><dt>{hovered.column}</dt><dd>{hovered.value}</dd></div>
          </dl>
        </div>
      )}
      <div className="result-chart-legend">
        {series.map((entry, index) => <span key={`${entry.dataset}-${entry.column}`}><i style={{ background: SERIES_COLORS[index % SERIES_COLORS.length] }} />{datasets.length > 1 && <b>{fileLabel(entry.dataset)}</b>}{entry.column}</span>)}
      </div>
    </div>
  )
}

export function ResultChartPanel({ datasets, recommendation, onRemoveDataset }: {
  datasets: ChartDataset[]
  recommendation: ChartRecommendation
  onRemoveDataset?: (path: string) => void
}) {
  const { t } = useI18n()
  const [xColumn, setXColumn] = useState<string | null>(recommendation.xColumn)
  const [yColumns, setYColumns] = useState<string[]>(recommendation.yColumns)
  const [kind, setKind] = useState<ChartKind>(recommendation.kind)
  const [scale, setScale] = useState<ScaleKind>(recommendation.scale)
  const numericProfiles = recommendation.profiles.filter((profile) => profile.numeric)
  const commonColumns = useMemo(() => recommendation.profiles.filter((profile) => datasets.every((dataset) => dataset.table.headers.includes(profile.name))), [datasets, recommendation.profiles])

  useEffect(() => {
    if (xColumn && !commonColumns.some((profile) => profile.name === xColumn)) setXColumn(null)
    const commonNumericNames = new Set(commonColumns.filter((profile) => profile.numeric).map((profile) => profile.name))
    setYColumns((current) => {
      const shared = current.filter((column) => commonNumericNames.has(column))
      if (shared.length) return shared
      return recommendation.yColumns.filter((column) => commonNumericNames.has(column)).slice(0, 3)
    })
  }, [commonColumns, recommendation.yColumns, xColumn])

  const toggleSeries = (column: string) => {
    setYColumns((current) => current.includes(column)
      ? current.filter((entry) => entry !== column)
      : current.length < 4 ? [...current, column] : current)
  }

  return (
    <div className="result-chart-panel">
      <aside className="result-chart-controls">
        <section>
          <span className="result-chart-kicker">{t('DATASETS')}</span>
          <div className="result-chart-datasets">
            {datasets.map((dataset, index) => (
              <div key={dataset.path}>
                <i style={{ background: SERIES_COLORS[(index * Math.max(1, yColumns.length)) % SERIES_COLORS.length] }} />
                <span><strong>{fileLabel(dataset.path)}</strong><small>{t(`${dataset.table.totalRows.toLocaleString()} rows`)}</small></span>
                {index > 0 && onRemoveDataset && <button onClick={() => onRemoveDataset(dataset.path)} aria-label={t(`Remove ${fileLabel(dataset.path)}`)}><X size={11} /></button>}
              </div>
            ))}
          </div>
        </section>
        <section>
          <label>{t('Horizontal axis')}<select value={xColumn ?? ''} onChange={(event) => setXColumn(event.target.value || null)}>
            <option value="">{t('Row index')}</option>
            {commonColumns.map((profile) => <option value={profile.name} key={profile.name}>{profile.name}</option>)}
          </select></label>
        </section>
        <section>
          <span className="result-chart-kicker">{t('SERIES · MAX 4')}</span>
          <div className="result-chart-series">
            {numericProfiles.filter((profile) => profile.name !== xColumn && datasets.every((dataset) => dataset.table.headers.includes(profile.name))).map((profile) => (
              <button className={yColumns.includes(profile.name) ? 'selected' : ''} onClick={() => toggleSeries(profile.name)} key={profile.name}>
                <span>{yColumns.includes(profile.name) && <Check size={10} />}</span>{profile.name}
              </button>
            ))}
          </div>
        </section>
        <section className="result-chart-control-grid">
          <label>{t('Chart')}<select value={kind} onChange={(event) => setKind(event.target.value as ChartKind)}><option value="line">{t('Line')}</option><option value="scatter">{t('Scatter')}</option><option value="bar">{t('Bar')}</option></select></label>
          <label>{t('Scale')}<select value={scale} onChange={(event) => setScale(event.target.value as ScaleKind)}><option value="linear">{t('Linear')}</option><option value="log">Log₁₀</option></select></label>
        </section>
      </aside>
      <main className="result-chart-stage">
        <div className="result-chart-insight"><BarChart3 size={14} /><span><strong>{t('Adaptive view')}</strong>{t(recommendation.reason)}</span></div>
        <ChartCanvas datasets={datasets} xColumn={xColumn} yColumns={yColumns} kind={kind} scale={scale} />
      </main>
    </div>
  )
}

export function DatasetPicker({ candidates, selected, loadingPath, error, onAdd }: {
  candidates: { path: string; label?: string }[]
  selected: string[]
  loadingPath?: string
  error?: string
  onAdd: (path: string) => void
}) {
  const { t } = useI18n()
  const available = candidates.filter((candidate) => !selected.includes(candidate.path))
  const [choice, setChoice] = useState('')
  return (
    <div className="result-dataset-picker">
      <label>{t('Compare compatible CSV')}<select value={choice} onChange={(event) => setChoice(event.target.value)} disabled={!available.length || Boolean(loadingPath)}>
        <option value="">{t(available.length ? 'Select another result…' : 'All compatible candidates selected')}</option>
        {available.map((candidate) => <option value={candidate.path} key={candidate.path}>{candidate.label ?? fileLabel(candidate.path)}</option>)}
      </select></label>
      <button disabled={!choice || Boolean(loadingPath)} onClick={() => { onAdd(choice); setChoice('') }}><Plus size={12} />{t(loadingPath ? 'Checking…' : 'Add dataset')}</button>
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
