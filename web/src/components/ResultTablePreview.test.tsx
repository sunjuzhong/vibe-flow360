import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ResultTablePreview, isTabularResult, parseResultTable } from './ResultTablePreview'

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
})

describe('ResultTablePreview', () => {
  it('renders accessible tabular result content', () => {
    const markup = renderToStaticMarkup(
      <ResultTablePreview path="results/forces.csv" content={'step,cl\n1,0.5'} onClose={() => undefined} />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('result-preview-table')
    expect(markup).toContain('<th>step</th>')
    expect(markup).toContain('<td class="numeric">0.5</td>')
    expect(markup).toContain('Close result preview')
  })
})
