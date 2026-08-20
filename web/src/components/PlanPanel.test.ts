import { describe, expect, it } from 'vitest'
import { planEntryPresentation, reviewMatchesDraft, shouldLoadExistingReview, shouldStartDraftRunConfiguration } from './PlanPanel'

describe('PlanPanel entry experience', () => {
  it('opens current Draft runs at target selection instead of auto-submitting a Case review', () => {
    expect(shouldLoadExistingReview('draft-1', undefined)).toBe(false)
    expect(shouldStartDraftRunConfiguration('draft-1', undefined)).toBe(true)
    expect(shouldLoadExistingReview(undefined, 'plan-1')).toBe(true)
    expect(shouldStartDraftRunConfiguration('draft-1', 'plan-1')).toBe(false)
    expect(shouldLoadExistingReview(undefined, undefined)).toBe(false)
  })

  it('keeps AI parameter review separate from explicit run review', () => {
    expect(planEntryPresentation('review')).toEqual({
      title: 'Review proposal',
      subtitle: 'Review proposed parameters without changing the Flow360 Draft',
      dialogLabel: 'Proposed parameter review',
    })
    expect(planEntryPresentation('run').title).toBe('Review & Run')
  })

  it('only allows a Draft review to run the currently selected Flow360 Draft', () => {
    expect(reviewMatchesDraft('draft-current', 'draft-current')).toBe(true)
    expect(reviewMatchesDraft('draft-current', 'draft-other')).toBe(false)
    expect(reviewMatchesDraft(undefined, 'draft-other')).toBe(true)
  })
})
