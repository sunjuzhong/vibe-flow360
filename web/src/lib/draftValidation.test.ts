import { describe, expect, it } from 'vitest'
import type { DraftParameterValidationResponse, DynamicFormSchema } from '../api/client'
import { candidateFingerprint, localDraftValidation, normalizeDraftValidation, resolveDraftIssuePath } from './draftValidation'

const schema: DynamicFormSchema = {
  type: 'object',
  required: ['meshing'],
  properties: {
    meshing: {
      type: 'object',
      properties: {
        refinements: {
          type: 'array',
          items: {
            type: 'object',
            properties: { spacing: { type: 'number', minimum: 0 } },
          },
        },
      },
    },
    outputs: { type: 'array', minItems: 1, items: { type: 'string' } },
  },
}

it('uses an order-independent exact candidate fingerprint', () => {
  expect(candidateFingerprint({ b: 2, a: { y: 2, x: 1 } }))
    .toBe(candidateFingerprint({ a: { x: 1, y: 2 }, b: 2 }))
  expect(candidateFingerprint({ values: [1, 2] })).not.toBe(candidateFingerprint({ values: [2, 1] }))
})

it('maps service paths to exact fields, nearest ancestors, or global feedback', () => {
  expect(resolveDraftIssuePath(schema, '/simulation_params/meshing/refinements/0/spacing'))
    .toEqual({ path: 'meshing.refinements.0.spacing', group: 'meshing', mapping: 'exact' })
  expect(resolveDraftIssuePath(schema, 'meshing.refinements[0].unknown.deep'))
    .toEqual({ path: 'meshing.refinements.0', group: 'meshing', mapping: 'ancestor' })
  expect(resolveDraftIssuePath(schema, 'private_attribute_cache.hidden'))
    .toEqual({ mapping: 'global' })
})

it('normalizes errors and warnings from the same source without making warnings blocking', () => {
  const response: DraftParameterValidationResponse = {
    schema_version: 1,
    valid: false,
    issues: [
      { level: 'warning', code: 'output', path: 'outputs', message: 'Review outputs' },
      { level: 'error', code: 'spacing', path: 'meshing.refinements.0.spacing', message: 'Invalid spacing' },
    ],
  }
  const result = normalizeDraftValidation(response, schema)
  expect(result).toMatchObject({ errors: 1, warnings: 1, blocking: true })
  expect(result.issues.map((issue) => issue.severity)).toEqual(['warning', 'error'])

  const warningOnly = normalizeDraftValidation({ ...response, valid: true, issues: response.issues.slice(0, 1) }, schema)
  expect(warningOnly).toMatchObject({ errors: 0, warnings: 1, blocking: false })
})

it('reports deterministic local format constraints before schema validation', () => {
  expect(localDraftValidation(schema, { meshing: { refinements: [{ spacing: -1 }] }, outputs: [] }).issues)
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'minimum', path: 'meshing.refinements.0.spacing' }),
      expect.objectContaining({ code: 'min_items', path: 'outputs' }),
    ]))
  expect(localDraftValidation(schema, null, 'Unexpected token at position 4'))
    .toMatchObject({ errors: 1, blocking: true, issues: [expect.objectContaining({ code: 'json_syntax', mapping: 'global' })] })
})
