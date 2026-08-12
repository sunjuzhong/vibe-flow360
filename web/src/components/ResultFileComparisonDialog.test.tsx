import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { comparableResultHeaders, ResultFileComparisonDialog, resultCellDelta } from './ResultFileComparisonDialog'
import { parseResultTable } from './ResultTablePreview'

describe('ResultFileComparisonDialog', () => {
  it('aligns only shared columns and computes numeric candidate deltas', () => {
    const baseline = parseResultTable('step,Cl,Cd\n1,0.1,1.2', 'forces.csv')
    const candidate = parseResultTable('step,Cl,Cm\n1,0.15,0.02', 'forces.csv')
    expect(comparableResultHeaders([baseline, candidate])).toEqual(['step', 'Cl'])
    expect(resultCellDelta('0.1', '0.15')).toBe('0.05')
    expect(resultCellDelta('stable', 'changed')).toBe('—')
  })

  it('renders an accessible modal with both Case datasets', () => {
    const markup = renderToStaticMarkup(<I18nProvider><ResultFileComparisonDialog
      path="results/forces.csv"
      cases={[
        { id: 'case-a', name: 'Baseline Case', content: 'step,Cl\n1,0.1\n2,0.2' },
        { id: 'case-b', name: 'Candidate Case', content: 'step,Cl\n1,0.15\n2,0.22' },
      ]}
      onClose={() => undefined}
    /></I18nProvider>)
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('Baseline Case')
    expect(markup).toContain('Candidate Case')
    expect(markup).toContain('result-chart-panel')
    expect(markup).toContain('Aligned values')
  })
})
