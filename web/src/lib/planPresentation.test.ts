import { describe, expect, it } from 'vitest'
import { executionTemplate, preflightPrimaryAction } from './planPresentation'

describe('preflightPrimaryAction', () => {
  it('asks for schema-backed inputs before opening generic Agent Recovery', () => {
    expect(preflightPrimaryAction(false, true)).toBe('structured-inputs')
    expect(preflightPrimaryAction(false, false)).toBe('agent-diagnosis')
    expect(preflightPrimaryAction(true, true)).toBe('validate')
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
