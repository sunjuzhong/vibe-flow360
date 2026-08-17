import { describe, expect, it } from 'vitest'
import { APIError, type DynamicFormSchema } from '../api/client'
import { applyDraftAIProposal, buildDraftParameters, configuredExpressionPaths, createJSONMergePatch, draftAIAssistPatch, draftAutoSyncReady, draftParameterErrorMessage, draftReviewRunReady, parseParameterJSON } from './DraftParameterEditor'

describe('Draft parameter editor', () => {
  const schema: DynamicFormSchema = {
    type: 'object',
    properties: {
      meshing: {
        type: 'object',
        properties: {
          defaults: {
            type: 'object',
            properties: {
              target_surface_node_count: { type: 'integer' },
            },
          },
        },
      },
    },
  }

  it('serializes edited fields while preserving private and unknown Flow360 values', () => {
    expect(buildDraftParameters(schema, {
      version: '25.2',
      private_attribute_asset_cache: { project_entity_info: { faces: ['wing'] } },
      meshing: {
        private_attribute_registry_bucket_name: 'bucket',
        defaults: { target_surface_node_count: '1000000' },
      },
    })).toEqual({
      version: '25.2',
      private_attribute_asset_cache: { project_entity_info: { faces: ['wing'] } },
      meshing: {
        private_attribute_registry_bucket_name: 'bucket',
        defaults: { target_surface_node_count: 1000000 },
      },
    })
  })

  it('does not restore a known optional field removed in Form mode', () => {
    expect(buildDraftParameters(schema, {
      version: '25.2',
      meshing: {},
    })).toEqual({ version: '25.2', meshing: {} })
  })

  it('accepts only a JSON object in JSON mode', () => {
    expect(parseParameterJSON('{"version":"25.2"}')).toEqual({ version: '25.2' })
    expect(() => parseParameterJSON('[]')).toThrow('must be a JSON object')
  })

  it('collects only configured typed Expression paths for pre-save validation', () => {
    const expressionSchema: DynamicFormSchema = {
      type: 'object',
      properties: {
        time_stepping: {
          type: 'object',
          properties: {
            step_size: {
              type: 'union',
              variants: [
                { type: 'quantity', unit: 's', value_schema: { type: 'number' } },
                { type: 'expression' },
              ],
            },
          },
        },
      },
    }
    expect(configuredExpressionPaths(expressionSchema, {
      time_stepping: { step_size: { type_name: 'expression', expression: '1 * u.s' } },
    })).toEqual(['time_stepping.step_size'])
    expect(configuredExpressionPaths(expressionSchema, {
      time_stepping: { step_size: { value: 1, units: 's' } },
    })).toEqual([])
  })

  it('builds a JSON Merge Patch for AI changes without replacing unchanged values', () => {
    expect(createJSONMergePatch(
      { operating_condition: { alpha: 0, beta: 0 }, outputs: ['forces'] },
      { operating_condition: { alpha: 5 }, outputs: ['forces'] },
    )).toEqual({ operating_condition: { alpha: 5, beta: null } })
  })

  it('builds an empty AI patch from the Draft baseline when the editor candidate cannot be serialized', () => {
    const baseline = { fluid: { density: { value: 1.225, units: 'unsupported-unit' } } }
    const candidate = null

    expect(draftAIAssistPatch(baseline, candidate)).toEqual({})
  })

  it('applies an AI proposal on top of the current unsaved candidate', () => {
    expect(applyDraftAIProposal(
      { operating_condition: { alpha: 0, beta: 0 } },
      { operating_condition: { alpha: 5, beta: 0 } },
      { operating_condition: { beta: 2 } },
    )).toEqual({ operating_condition: { alpha: 5, beta: 2 } })
  })

  it('auto-syncs only the latest validated candidate and stops retrying a failed revision', () => {
    const ready = {
      dirty: true,
      saving: false,
      validating: false,
      candidate: { version: '25.2' },
      fingerprint: '{"version":"25.2"}',
      validatedFingerprint: '{"version":"25.2"}',
      hasValidation: true,
      failedSyncFingerprint: '',
    }
    expect(draftAutoSyncReady(ready)).toBe(true)
    expect(draftAutoSyncReady({ ...ready, validatedFingerprint: 'older' })).toBe(false)
    expect(draftAutoSyncReady({ ...ready, saving: true })).toBe(false)
    expect(draftAutoSyncReady({ ...ready, failedSyncFingerprint: ready.fingerprint })).toBe(false)
  })

  it('enables Review & Run only for the latest synced and valid revision', () => {
    const ready = {
      dirty: false,
      saving: false,
      syncError: '',
      validationValid: true,
      fingerprint: 'latest',
      validatedFingerprint: 'latest',
    }
    expect(draftReviewRunReady(ready)).toBe(true)
    expect(draftReviewRunReady({ ...ready, dirty: true })).toBe(false)
    expect(draftReviewRunReady({ ...ready, syncError: 'offline' })).toBe(false)
    expect(draftReviewRunReady({ ...ready, validationValid: false })).toBe(false)
    expect(draftReviewRunReady({ ...ready, validatedFingerprint: 'older' })).toBe(false)
  })

  it('turns release policy API errors into an actionable localized message', () => {
    const error = new APIError('raw backend message', {
      code: 'flow360_release_not_supported',
      cloud_version: '25.11.2',
      supported_release: '25.10',
    })
    const translated = draftParameterErrorMessage(error, () => '项目版本 {cloudVersion}，当前应用支持 {supportedRelease}。')
    expect(translated).toBe('项目版本 25.11.2，当前应用支持 25.10。')
  })
})
