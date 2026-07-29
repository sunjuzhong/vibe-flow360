import { describe, expect, it } from 'vitest'
import type { Intervention } from '../api/client'
import { chooseIntervention } from './InterventionPanel'

function intervention(id: string, planId: string, state = 'proposal'): Intervention {
  return {
    id,
    project_id: 'prj-1',
    plan_id: planId,
    type: 'preflight_error',
    state,
    reason: 'test',
    confidence: 0.8,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('chooseIntervention', () => {
  it('treats an empty API collection as no selection', () => {
    expect(chooseIntervention(null, 'plan-target')).toBeNull()
    expect(chooseIntervention(undefined, 'plan-target')).toBeNull()
  })

  it('opens the intervention belonging to the plan that requested recovery', () => {
    const items = [
      intervention('intv-old', 'plan-old'),
      intervention('intv-target', 'plan-target'),
    ]
    expect(chooseIntervention(items, 'plan-target')?.id).toBe('intv-target')
  })

  it('preserves the active selection while polling', () => {
    const items = [
      intervention('intv-a', 'plan-a'),
      intervention('intv-b', 'plan-b'),
    ]
    expect(chooseIntervention(items, 'plan-a', 'intv-b')?.id).toBe('intv-b')
  })

  it('prefers an active recovery over resolved history', () => {
    const items = [
      intervention('intv-resolved', 'plan-a', 'resolved'),
      intervention('intv-active', 'plan-b', 'diagnosis'),
    ]
    expect(chooseIntervention(items)?.id).toBe('intv-active')
  })
})
