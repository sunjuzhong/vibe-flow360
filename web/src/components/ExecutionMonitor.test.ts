import { describe, expect, it } from 'vitest'
import type { SimulationPlan } from '../api/client'
import { displayedExecutionProgress, isExecutionTrackable } from './ExecutionMonitor'

function plan(status: SimulationPlan['status']): SimulationPlan {
  return {
    id: 'plan-1',
    project_id: 'project-1',
    source_id: 'geometry-1',
    source_type: 'Geometry',
    target: 'surface-mesh',
    name: 'Surface mesh',
    intent: '',
    patch: {},
    revision: 1,
    differences: [],
    validations: [],
    command_preview: [],
    status,
    created_at: '2026-07-31T00:00:00Z',
    updated_at: '2026-07-31T00:00:00Z',
  }
}

describe('execution monitoring eligibility', () => {
  it.each(['running', 'submitted', 'reconciling', 'completed', 'failed'] as const)(
    'tracks %s plans',
    (status) => expect(isExecutionTrackable(plan(status))).toBe(true),
  )

  it.each(['draft', 'approved'] as const)(
    'does not poll %s plans',
    (status) => expect(isExecutionTrackable(plan(status))).toBe(false),
  )
})

describe('execution progress', () => {
  it('does not invent percentages for non-terminal lifecycle states', () => {
    expect(displayedExecutionProgress('running')).toBeUndefined()
    expect(displayedExecutionProgress('submitted')).toBeUndefined()
    expect(displayedExecutionProgress('reconciling')).toBeUndefined()
  })

  it('uses only a reported percentage or a terminal 100%', () => {
    expect(displayedExecutionProgress('submitted', 42)).toBe(42)
    expect(displayedExecutionProgress('completed')).toBe(100)
    expect(displayedExecutionProgress('failed')).toBe(100)
  })
})
