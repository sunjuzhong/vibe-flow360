import { describe, expect, it } from 'vitest'
import { parseSweepValues, toggleCaseSelection } from './ComparePage'

describe('ComparePage URL and sweep helpers', () => {
  it('keeps Case selection order stable for URL restoration', () => {
    expect(toggleCaseSelection(['case-a'], 'case-b')).toEqual(['case-a', 'case-b'])
    expect(toggleCaseSelection(['case-a', 'case-b'], 'case-a')).toEqual(['case-b'])
  })

  it('parses finite sweep values and rejects malformed entries', () => {
    expect(parseSweepValues('-2, 0, 3.5, nope')).toEqual([-2, 0, 3.5])
  })
})
