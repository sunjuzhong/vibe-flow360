import { describe, expect, it } from 'vitest'
import { planEntryPresentation, shouldLoadExistingReview } from './PlanPanel'

describe('PlanPanel entry experience', () => {
  it('uses a stable loading state when opening an existing Draft review', () => {
    expect(shouldLoadExistingReview('draft-1', undefined)).toBe(true)
    expect(shouldLoadExistingReview(undefined, 'plan-1')).toBe(true)
    expect(shouldLoadExistingReview(undefined, undefined)).toBe(false)
  })

  it('keeps AI parameter review separate from explicit run review', () => {
    expect(planEntryPresentation('review')).toEqual({
      title: 'Draft changes',
      subtitle: 'Improve and approve parameters without running Flow360',
      dialogLabel: 'Draft parameter changes',
    })
    expect(planEntryPresentation('run').title).toBe('Review & Run')
  })
})
