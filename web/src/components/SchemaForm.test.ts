import { describe, expect, it } from 'vitest'
import type { DynamicFormSchema } from '../api/client'
import { initialValue, serializeValue } from './SchemaForm'

describe('schema-driven Flow360 form', () => {
  it('creates and serializes nested values without field-specific code', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        meshing: {
          type: 'object',
          properties: {
            defaults: {
              type: 'object',
              properties: {
                length: {
                  type: 'quantity',
                  title: 'Generated length',
                  unit: 'meter',
                  value_schema: { type: 'number', exclusiveMinimum: 0 },
                },
                enabled: { type: 'boolean', default: true },
                mode: { type: 'enum', options: ['coarse', 'fine'] },
              },
            },
          },
        },
      },
    }
    const initial = initialValue(schema) as Record<string, unknown>
    const meshing = initial.meshing as Record<string, unknown>
    const defaults = meshing.defaults as Record<string, unknown>
    defaults.length = { value: '0.01', units: 'm' }

    expect(serializeValue(schema, initial)).toEqual({
      meshing: {
        defaults: {
          length: { value: 0.01, units: 'm' },
          enabled: true,
          mode: 'coarse',
        },
      },
    })
  })

  it('serializes the active union variant', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      variants: [
        { type: 'string' },
        { type: 'quantity', unit: 'meter/second', value_schema: { type: 'number' } },
      ],
    }
    expect(serializeValue(schema, {
      variant: 1,
      value: { value: '30', units: 'm/s' },
    })).toEqual({ value: 30, units: 'm/s' })
  })

  it('serializes a schema-provided entity assignment', () => {
    const schema: DynamicFormSchema = {
      type: 'entity_assignment',
      title: 'Assign boundaries',
      default_model: 'existing:0',
      model_choices: [{ value: 'existing:0', label: 'Wall · Wall' }],
      entity_choices: [
        { value: 'face-1', label: 'face-1' },
        { value: 'face-2', label: 'face-2' },
      ],
    }
    expect(initialValue(schema)).toEqual({ model: 'existing:0', entities: [] })
    expect(serializeValue(schema, {
      model: 'existing:0',
      entities: ['face-1', 'face-2'],
    })).toEqual({
      model: 'existing:0',
      entities: ['face-1', 'face-2'],
    })
  })
})
