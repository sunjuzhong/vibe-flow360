import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DynamicFormSchema } from '../api/client'
import { cleanSchemaDescription, hydrateSchemaValue, initialValue, SchemaFormFields, serializeValue } from './SchemaForm'

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

  it('hydrates an existing union value into the matching editor variant', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      variants: [
        { type: 'string' },
        { type: 'quantity', unit: 'm/s', value_schema: { type: 'number' } },
      ],
    }
    expect(hydrateSchemaValue(schema, { value: 30, units: 'm/s' }, true)).toEqual({
      variant: 1,
      value: { value: 30, units: 'm/s' },
    })
  })

  it('normalizes declared legacy unit names to Flow360 wire tokens', () => {
    const schema: DynamicFormSchema = {
      type: 'quantity',
      title: 'Length',
      unit: 'm',
      unit_options: ['m', 'mm'],
      unit_aliases: { meter: 'm' },
      value_schema: { type: 'number' },
    }
    expect(initialValue(schema)).toEqual({ value: '', units: 'm' })
    expect(serializeValue(schema, { value: '1', units: 'meter' })).toEqual({ value: 1, units: 'm' })
    expect(() => serializeValue(schema, { value: '1', units: 'parsec' })).toThrow('unsupported stored unit')
  })

  it('serializes a schema-provided entity assignment', () => {
    const schema: DynamicFormSchema = {
      type: 'entity_assignment',
      title: 'Assign boundaries',
      default_model: 'existing:0',
      default_entities: ['face-1', 'face-2'],
      recommendation: {
        title: 'Keep Wall',
        reason: 'The existing Wall selected every surface.',
        confidence: 'high',
      },
      model_choices: [{ value: 'existing:0', label: 'Wall · Wall' }],
      entity_choices: [
        { value: 'face-1', label: 'face-1' },
        { value: 'face-2', label: 'face-2' },
      ],
    }
    expect(initialValue(schema)).toEqual({ model: 'existing:0', entities: ['face-1', 'face-2'] })
    expect(serializeValue(schema, {
      model: 'existing:0',
      entities: ['face-1', 'face-2'],
    })).toEqual({
      model: 'existing:0',
      entities: ['face-1', 'face-2'],
    })
  })

  it('serializes an incompatible field recovery as a merge-patch removal', () => {
    const schema: DynamicFormSchema = {
      type: 'field_removal',
      title: 'Remove unsupported meshing setting',
      recommendation: {
        title: 'Use legacy mesher defaults',
        reason: 'This field is not supported by the active mesher.',
        confidence: 'high',
      },
    }
    expect(initialValue(schema)).toBeNull()
    expect(serializeValue(schema, 100000)).toBeNull()
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: null,
      onChange: () => undefined,
    }))
    expect(markup).toContain('Schema-safe repair')
    expect(markup).toContain('Use legacy mesher defaults')
    expect(markup).not.toContain('type="number"')
  })

  it('keeps optional stage values sparse so inherited parameters are not overwritten', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        meshing: {
          type: 'object',
          properties: {
            defaults: {
              type: 'object',
              properties: {
                surface_max_edge_length: { type: 'quantity', unit: 'meter', value_schema: { type: 'number' } },
                curvature_resolution_angle: { type: 'quantity', unit: 'degree', value_schema: { type: 'number' } },
              },
            },
          },
        },
        operating_condition: { type: 'object', properties: {} },
      },
    }
    expect(initialValue(schema, true)).toEqual({})
    expect(serializeValue(schema, {
      meshing: { defaults: { surface_max_edge_length: { value: '0.05', units: 'meter' } } },
    }, true)).toEqual({
      meshing: { defaults: { surface_max_edge_length: { value: 0.05, units: 'meter' } } },
    })
  })

  it('renders the complete schema while keeping absent values sparse', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        meshing: {
          type: 'object',
          title: 'Meshing',
          properties: {
            defaults: {
              type: 'object',
              properties: {
                target_surface_node_count: { type: 'integer', title: 'Target surface node count' },
              },
            },
          },
        },
        operating_condition: {
          type: 'object',
          title: 'Operating Condition',
          properties: {
            velocity_magnitude: { type: 'number', title: 'Velocity magnitude' },
          },
        },
      },
    }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { meshing: { defaults: { target_surface_node_count: 500000 } } },
      sparse: true,
      showAll: true,
      onChange: () => undefined,
    }))

    expect(markup).toContain('Target surface node count')
    expect(markup).toContain('value="500000"')
    expect(markup).toContain('Operating Condition')
    expect(markup).toContain('Velocity magnitude')
    expect(markup).toContain('Not configured')
    expect(markup).not.toContain('schema-add-field')
    expect(serializeValue(schema, { meshing: { defaults: { target_surface_node_count: 500000 } } }, true)).toEqual({
      meshing: { defaults: { target_surface_node_count: 500000 } },
    })
  })

  it('renders Draft root groups as tabs and nested objects as collapsible sections', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      title: 'Simulation parameters',
      properties: {
        meshing: {
          type: 'object',
          title: 'Meshing',
          properties: {
            defaults: {
              type: 'object',
              title: 'Defaults',
              properties: {
                target_count: { type: 'integer', title: 'Target count' },
              },
            },
          },
        },
        models: {
          type: 'object',
          title: 'Models',
          properties: {},
        },
      },
    }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { meshing: { defaults: { target_count: 500000 } } },
      sparse: true,
      showAll: true,
      rootTabs: true,
      collapsibleObjects: true,
      onChange: () => undefined,
    }))

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('role="tab"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('Meshing')
    expect(markup).toContain('Models')
    expect(markup).toContain('schema-section')
    expect(markup).toContain('Defaults')
    expect(markup).toContain('Target count')
    expect(markup).toContain('role="tabpanel"')
  })

  it('moves Draft descriptions into help tooltips and removes schema reference noise', () => {
    const description = 'Solver settings and numerical models. See ref: `Volume Models <volume_models>` and :ref:`Surface Models <surface_models>` for more details.'
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        models: {
          type: 'array',
          title: 'Models',
          description,
          items: { type: 'string' },
        },
      },
    }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: {},
      sparse: true,
      showAll: true,
      rootTabs: true,
      collapsibleObjects: true,
      onChange: () => undefined,
    }))

    expect(cleanSchemaDescription(description)).toBe('Solver settings and numerical models.')
    expect(markup).toContain('aria-label="About Models"')
    expect(markup).toContain('role="tooltip"')
    expect(markup).toContain('Solver settings and numerical models.')
    expect(markup).not.toContain('volume_models')
    expect(markup).not.toContain('surface_models')
    expect(markup).not.toContain('See ref')
  })
})
