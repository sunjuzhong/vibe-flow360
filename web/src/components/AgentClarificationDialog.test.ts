import { describe, expect, it } from 'vitest'
import {
  clarificationAnswerSummary,
  clarificationQuestionsSignature,
  agentClarificationPortalTarget,
  inferredClarificationDefault,
  inferredClarificationQuestionType,
  initialClarificationAnswers,
  resolvedClarificationQuestions,
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
  it('mounts the modal at the document body instead of inside an Agent session panel', () => {
    const body = {} as HTMLElement
    expect(agentClarificationPortalTarget({ body } as Pick<Document, 'body'>)).toBe(body)
  })

  it('uses typed defaults and serializes numbers', () => {
    expect(initialClarificationAnswers(questions)).toEqual({ velocity: 40, model: 'sa' })
    expect(serializedClarificationAnswers(questions, { velocity: '55', model: 'sa' })).toEqual({ velocity: 55, model: 'sa' })
  })

  it('keeps an unchanged polled form contract stable', () => {
    const refreshed = questions.map((question) => ({ ...question }))
    expect(refreshed).not.toBe(questions)
    expect(clarificationQuestionsSignature(refreshed)).toBe(clarificationQuestionsSignature(questions))
  })

  it('creates a readable session record', () => {
    const summary = clarificationAnswerSummary(questions, { velocity: 40, model: 'sa' })
    expect(summary).toContain('Freestream velocity (velocity): 40 m/s')
    expect(summary).toContain('Turbulence model (model): Spalart-Allmaras')
  })

  it('upgrades legacy untyped questions to friendly controls and safe defaults', () => {
    const legacy: AgentQuestion[] = [
      {
        field: 'operating_condition.velocity_magnitude',
        message: 'Confirm whether the new draft should retain 40 m/s.',
        urgency: 'required',
      },
      {
        field: 'time_stepping.step_size',
        message: 'Confirm whether I may derive the physical time step from the cylinder diameter.',
        urgency: 'required',
      },
      {
        field: 'geometry_asset',
        message: 'Provide a supported CAD geometry.',
        urgency: 'required',
      },
    ]

    const resolved = resolvedClarificationQuestions(legacy)
    expect(resolved.map((question) => question.type)).toEqual(['number', 'boolean', 'text'])
    expect(resolved[0]).toMatchObject({ default: 40, unit: 'm/s' })
    expect(resolved[1].default).toBe(true)
    expect(inferredClarificationQuestionType(legacy[2])).toBe('text')
    expect(inferredClarificationDefault(legacy[2])).toBeUndefined()
  })
})
