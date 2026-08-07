import { describe, expect, it } from 'vitest'
import type { AgentAction } from '../api/client'
import { actionPlanConversionSummary, copilotHorizontalContainment, copilotScopeLabel, scopedDraftUpdateProposal, shouldShowCopilotClarification } from './CopilotPanel'

const clarification: AgentAction = {
  version: 'v1',
  kind: 'request-missing-input',
  message: 'Input required',
  questions: [{ field: 'velocity', message: 'Velocity?', urgency: 'required', type: 'number' }],
}

describe('Ask AI clarification visibility', () => {
  it('never displays over a closed Ask AI panel', () => {
    expect(shouldShowCopilotClarification(false, clarification)).toBe(false)
  })

  it('displays only after the session action has selected a clarification request', () => {
    expect(shouldShowCopilotClarification(true, null)).toBe(false)
    expect(shouldShowCopilotClarification(true, clarification)).toBe(true)
  })
})

describe('Ask AI horizontal overflow containment', () => {
  it('keeps the drawer and message list from scrolling horizontally', () => {
    expect(copilotHorizontalContainment).toEqual({ overflowX: 'hidden' })
  })
})

describe('Ask AI session scope', () => {
  it('distinguishes Draft, Resource, and Project conversations', () => {
    expect(copilotScopeLabel('draft')).toBe('Draft session')
    expect(copilotScopeLabel('resource')).toBe('Resource session')
    expect(copilotScopeLabel('project')).toBe('Project session')
  })
})

describe('Ask AI plan conversion feedback', () => {
  it('produces a visible local-plan completion summary', () => {
    expect(actionPlanConversionSummary({
      message: 'ready', results: [], total: 2, created: 1, failed: 1,
    })).toBe('1/2 Draft reviews ready')
  })
})

describe('Ask AI Draft update scope', () => {
  const update: AgentAction = {
    version: 'v1', kind: 'update-draft', message: 'Change alpha', proposals: [{
      id: 'edit-1', draft_id: 'draft-1', action: 'Draft', target: 'draft', name: 'Alpha',
      intent: 'Set alpha', patch: { alpha: 5 }, branch_preview: '', fields: [],
    }],
  }

  it('only exposes a patch for the current Draft scope', () => {
    expect(scopedDraftUpdateProposal(update, 'draft', 'draft-1')?.patch).toEqual({ alpha: 5 })
    expect(scopedDraftUpdateProposal(update, 'draft', 'draft-2')).toBeNull()
    expect(scopedDraftUpdateProposal(update, 'resource', 'draft-1')).toBeNull()
  })
})
