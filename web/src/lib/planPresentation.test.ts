import { describe, expect, it } from 'vitest'
import { executionTemplate, preflightPrimaryAction, schemaContainsRecommendation, schemaRequiresUserInput } from './planPresentation'

describe('preflightPrimaryAction', () => {
  it('asks for schema-backed inputs before opening generic Agent Recovery', () => {
    expect(preflightPrimaryAction(false, true)).toBe('structured-inputs')
    expect(preflightPrimaryAction(false, false)).toBe('agent-diagnosis')
    expect(preflightPrimaryAction(true, true)).toBe('validate')
  })
})

describe('schemaContainsRecommendation', () => {
  it('finds nested schema-safe recovery recommendations', () => {
    expect(schemaContainsRecommendation({
      type: 'object',
      properties: {
        meshing: {
          type: 'object',
          properties: {
            target: {
              type: 'field_removal',
              recommendation: { title: 'Remove it', reason: 'Unsupported', confidence: 'high' },
            },
          },
        },
      },
    })).toBe(true)
    expect(schemaContainsRecommendation({ type: 'number' })).toBe(false)
  })

  it('distinguishes one-click repairs from mixed engineering inputs', () => {
    expect(schemaRequiresUserInput({
      type: 'object',
      properties: { target: { type: 'field_removal' } },
    })).toBe(false)
    expect(schemaRequiresUserInput({
      type: 'object',
      properties: { target: { type: 'field_removal' }, length: { type: 'quantity' } },
    })).toBe(true)
  })
})

describe('executionTemplate', () => {
  it('labels legacy generated patch placeholders as temporary files', () => {
    expect(executionTemplate([
      'flow360',
      'draft',
      'run',
      'geo-1',
      '--name',
      'Surface Mesh run',
      '--patch',
      '<generated-plan-patch.json>',
      '--up-to',
      'surface-mesh',
    ])).toContain('--name "Surface Mesh run" --patch <temporary-patch.json>')
  })
})
