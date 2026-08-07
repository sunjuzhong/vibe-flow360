import { describe, expect, it } from 'vitest'
import type { DynamicFormSchema } from '../api/client'
import { buildDraftParameters, configuredExpressionPaths, parseParameterJSON } from './DraftParameterEditor'

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
})
