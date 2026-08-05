import { describe, expect, it } from 'vitest'
import type { AgentAction } from '../api/client'
import { shouldShowCopilotClarification } from './CopilotPanel'

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
