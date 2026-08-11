import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { fingerprintResultContent, ResultTablePreview, isTabularResult, parseResultTable, preloadCompatibleResultCandidates, summarizeResultTable } from './ResultTablePreview'

describe('parseResultTable', () => {
  it('parses quoted CSV cells and fills uneven rows', () => {
    const table = parseResultTable('name,value,note\nwing,1.25,"left, right"\ntail,2', 'forces.csv')

    expect(table.headers).toEqual(['name', 'value', 'note'])
    expect(table.rows).toEqual([
      ['wing', '1.25', 'left, right'],
      ['tail', '2', ''],
    ])
    expect(table.totalRows).toBe(2)
    expect(table.delimiter).toBe('comma')
  })

  it('detects tab and whitespace separated result data', () => {
    expect(parseResultTable('step\tresidual\n1\t0.1', 'residual.dat').delimiter).toBe('tab')
    expect(parseResultTable('step residual\n1 0.1', 'residual.txt').rows[0]).toEqual(['1', '0.1'])
  })

  it('removes all-empty trailing columns emitted by Flow360 CSV files', () => {
    const table = parseResultTable('step,value,\n1,0.1,\n2,0.05,', 'residual.csv')

    expect(table.headers).toEqual(['step', 'value'])
    expect(table.rows).toEqual([['1', '0.1'], ['2', '0.05']])
  })

  it('recognizes previewable result types', () => {
    expect(isTabularResult('force.CSV')).toBe(true)
    expect(isTabularResult('monitor.bin', 'dat')).toBe(true)
    expect(isTabularResult('volume.vtu')).toBe(false)
  })

  it('summarizes every parsed row and bounds representative samples for AI interpretation', () => {
    const table = parseResultTable(`step,value,label\n${Array.from({ length: 5101 }, (_, index) => `${index + 1},${index * 2},${index % 2 ? 'odd' : 'even'}`).join('\n')}`, 'result.csv')
    const summary = summarizeResultTable(table, 'project:test:case:test', 'result.csv', 'zh-CN', 'a'.repeat(64))

    expect(summary.total_rows).toBe(5101)
    expect(summary.scope).toBe('project:test:case:test')
    expect(summary.fingerprint).toBe('a'.repeat(64))
    expect(table.rows).toHaveLength(5000)
    expect(summary.columns.find((column) => column.field === 'value')?.mean).toBe(5100)
    expect(summary.columns.find((column) => column.field === 'label')?.unique).toBe(2)
    expect(summary.sample_rows).toHaveLength(24)
    expect(summary.sample_rows.at(-1)?.step).toBe('5101')
  })

  it('fingerprints full CSV content for stable cache invalidation', async () => {
    const first = await fingerprintResultContent('step,value\n1,0.1')
    const same = await fingerprintResultContent('step,value\n1,0.1')
    const changed = await fingerprintResultContent('step,value\n1,0.2')

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(same).toBe(first)
    expect(changed).not.toBe(first)
  })

  it('preloads every unique CSV and returns only compatible candidates', async () => {
    const base = parseResultTable('step,force\n1,0.1\n2,0.2', 'base.csv')
    const contents: Record<string, string> = {
      'compatible.csv': 'iteration,force\n1,0.3\n2,0.4',
      'short.csv': 'step,force\n1,0.3',
      'different.csv': 'iteration,heat\n1,3\n2,4',
    }
    const loaded: string[] = []
    const progress: Array<[number, number, number]> = []
    const result = await preloadCompatibleResultCandidates(
      base,
      [
        { path: 'compatible.csv', label: 'Compatible' },
        { path: 'short.csv' },
        { path: 'different.csv' },
        { path: 'failed.csv' },
        { path: 'compatible.csv', label: 'Duplicate' },
      ],
      async (path) => {
        loaded.push(path)
        if (!(path in contents)) throw new Error('unavailable')
        return contents[path]
      },
      (checked, total, failed) => progress.push([checked, total, failed]),
    )

    expect(loaded.sort()).toEqual(['compatible.csv', 'different.csv', 'failed.csv', 'short.csv'])
    expect(result.compatible.map((candidate) => candidate.path)).toEqual(['compatible.csv'])
    expect(result.compatible[0].label).toBe('Duplicate')
    expect(result.failed).toBe(1)
    expect(progress.at(-1)).toEqual([4, 4, 1])
  })
})

describe('ResultTablePreview', () => {
  it('renders an accessible adaptive result explorer', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider><ResultTablePreview path="results/forces.csv" content={'step,cl\n1,0.5\n2,0.7'} onClose={() => undefined} /></I18nProvider>,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('result-chart-panel')
    expect(markup).toContain('Adaptive view')
    expect(markup).toContain('Chart')
    expect(markup).toContain('Table')
    expect(markup).toContain('Close result preview')
    expect(markup).toContain('AI interpretation')
    expect(markup).toContain('result-chart-hit-point')
  })
})
