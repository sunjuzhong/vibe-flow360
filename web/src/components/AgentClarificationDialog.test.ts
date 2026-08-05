import { describe, expect, it } from 'vitest'
import {
  clarificationAnswerSummary,
  initialClarificationAnswers,
  serializedClarificationAnswers,
} from './AgentClarificationDialog'
import type { AgentQuestion } from '../api/client'

const questions: AgentQuestion[] = [
  { field: 'velocity', message: 'Freestream velocity', urgency: 'required', type: 'number', unit: 'm/s', default: 40 },
  {
    field: 'model', message: 'Turbulence model', urgency: 'required', type: 'select', default: 'sa',
    options: [{ value: 'sa', label: 'Spalart-Allmaras' }],
  },
]

describe('Agent clarification form helpers', () => {
  it('uses typed defaults and serializes numbers', () => {
    expect(initialClarificationAnswers(questions)).toEqual({ velocity: 40, model: 'sa' })
    expect(serializedClarificationAnswers(questions, { velocity: '55', model: 'sa' })).toEqual({ velocity: 55, model: 'sa' })
  })

  it('creates a readable session record', () => {
    const summary = clarificationAnswerSummary(questions, { velocity: 40, model: 'sa' })
    expect(summary).toContain('Freestream velocity (velocity): 40 m/s')
    expect(summary).toContain('Turbulence model (model): Spalart-Allmaras')
  })
})
