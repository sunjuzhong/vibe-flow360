import { describe, expect, it } from 'vitest'
import { buildArtifactMatrix, parseSweepValues, toggleCaseSelection } from './ComparePage'

describe('ComparePage URL and sweep helpers', () => {
  it('keeps Case selection order stable for URL restoration', () => {
    expect(toggleCaseSelection(['case-a'], 'case-b')).toEqual(['case-a', 'case-b'])
    expect(toggleCaseSelection(['case-a', 'case-b'], 'case-a')).toEqual(['case-b'])
  })

  it('parses finite sweep values and rejects malformed entries', () => {
    expect(parseSweepValues('-2, 0, 3.5, nope')).toEqual([-2, 0, 3.5])
  })

  it('aligns result artifacts by path and keeps missing evidence visible', () => {
    const cases = [
      {
        id: 'case-a', name: 'A', status: 'completed', params: {}, convergence: { status: 'converged', reason: '' }, kpis: [],
        visualization: { available: true },
        artifacts: [{ path: 'results/forces.csv', category: 'forces', previewable: true, visualization: false }],
      },
      {
        id: 'case-b', name: 'B', status: 'completed', params: {}, convergence: { status: 'converged', reason: '' }, kpis: [],
        visualization: { available: false },
        artifacts: [{ path: 'results/residual.csv', category: 'residuals', previewable: true, visualization: false }],
      },
    ]
    const matrix = buildArtifactMatrix(cases)
    expect(matrix.map((row) => row.path)).toEqual(['results/forces.csv', 'results/residual.csv'])
    expect(matrix[0].byCase['case-a']?.category).toBe('forces')
    expect(matrix[0].byCase['case-b']).toBeUndefined()
  })
})
