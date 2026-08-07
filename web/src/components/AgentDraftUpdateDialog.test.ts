import { describe, expect, it } from 'vitest'
import { applyDraftMergePatch, draftParameterChanges } from './AgentDraftUpdateDialog'

describe('Agent Draft update review', () => {
  it('applies JSON merge patches without mutating the baseline', () => {
    const baseline = { operating_condition: { alpha: 0, beta: 2 }, outputs: ['forces'] }
    expect(applyDraftMergePatch(baseline, {
      operating_condition: { alpha: 5 },
      outputs: null,
    })).toEqual({ operating_condition: { alpha: 5, beta: 2 } })
    expect(baseline).toHaveProperty('outputs')
  })

  it('lists the exact changed parameter paths for confirmation', () => {
    expect(draftParameterChanges({ models: { turbulence: 'SA' }, alpha: 0 }, {
      models: { turbulence: 'SST' },
      alpha: 5,
    })).toEqual([
      { path: 'models.turbulence', before: 'SA', after: 'SST' },
      { path: 'alpha', before: 0, after: 5 },
    ])
  })
})
