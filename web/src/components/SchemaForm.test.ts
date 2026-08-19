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

  it('round-trips Flow360 typed Expressions with their discriminator', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      title: 'Step Size',
      variants: [
        { type: 'quantity', unit: 's', value_schema: { type: 'number' } },
        {
          type: 'expression',
          expected_unit: 's',
          expected_dimension: 'time',
          wire_discriminator: { field: 'type_name', value: 'expression' },
          unit_suggestions: ['u.s'],
          function_suggestions: ['math.sqrt()'],
        },
      ],
    }
    const canonical = { type_name: 'expression', expression: '(123 - 5) * u.s' }
    const hydrated = hydrateSchemaValue(schema, canonical, true)
    expect(hydrated).toEqual({ variant: 1, value: canonical })
    expect(serializeValue(schema, hydrated)).toEqual(canonical)

    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: hydrated,
      onChange: () => undefined,
    }))
    expect(markup).toContain('Fixed value')
    expect(markup).toContain('Expression')
    expect(markup).toContain('Expected:')
    expect(markup).toContain('(123 - 5) * u.s')
  })

  it('keeps a selected object union discriminator in sparse form state', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      variants: [
        {
          type: 'object',
          title: 'Steady',
          properties: {
            type_name: { type: 'enum', options: ['Steady'], default: 'Steady' },
          },
        },
        {
          type: 'object',
          title: 'Unsteady',
          properties: {
            type_name: { type: 'enum', options: ['Unsteady'], default: 'Unsteady' },
            steps: { type: 'integer', required: true },
          },
        },
      ],
    }

    const unsteady = initialValue(schema.variants![1], true)
    expect(unsteady).toEqual({ type_name: 'Unsteady', steps: '' })
    expect(serializeValue(schema, { variant: 1, value: unsteady }, true)).toEqual({
      type_name: 'Unsteady',
      steps: 0,
    })
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { variant: 1, value: unsteady },
      onChange: () => undefined,
      sparse: true,
    }))
    expect(markup).not.toContain('Type Name')
  })

  it('hydrates an existing Output using its immutable output_type discriminator', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      variants: [
        { type: 'object', title: 'SurfaceOutput', properties: { output_type: { type: 'enum', options: ['SurfaceOutput'], default: 'SurfaceOutput' } } },
        { type: 'object', title: 'ForceOutput', properties: { output_type: { type: 'enum', options: ['ForceOutput'], default: 'ForceOutput' }, name: { type: 'string' } } },
      ],
    }
    const hydrated = hydrateSchemaValue(schema, { output_type: 'ForceOutput', name: 'forces', private_attribute_id: 'output-1' }, true)
    expect(hydrated).toEqual({
      variant: 1,
      value: { output_type: 'ForceOutput', name: 'forces', private_attribute_id: 'output-1' },
    })
    expect(serializeValue(schema, hydrated, true)).toEqual({ output_type: 'ForceOutput', name: 'forces', private_attribute_id: 'output-1' })
  })

  it('initializes a new complex item with required fields and explicit defaults only', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        output_type: { type: 'enum', options: ['SurfaceOutput'], default: 'SurfaceOutput' },
        output_fields: { type: 'array', items: { type: 'string' }, required: true },
        frequency: { type: 'integer', default: -1 },
        write_single_file: { type: 'boolean', default: false },
        optional_note: { type: 'string' },
        nullable_name: { type: 'string', default: null },
      },
    }
    expect(initialValue(schema, true)).toEqual({
      output_type: 'SurfaceOutput',
      output_fields: [],
      frequency: -1,
      write_single_file: false,
    })
  })

  it('labels optional field omission as reset or clear instead of destructive removal', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        frequency: { type: 'integer', title: 'Frequency', default: -1 },
        name: { type: 'string', title: 'Name' },
      },
    }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { frequency: -1, name: 'Surface output' },
      sparse: true,
      showAll: true,
      onChange: () => undefined,
    }))

    expect(markup).toContain('class="schema-remove-change schema-field-clear"')
    expect(markup).toContain('aria-label="Reset Frequency to default"')
    expect(markup).toContain('aria-label="Clear Name setting"')
    expect(markup).not.toContain('>Remove<')
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

  it('serializes vector quantities through their declared value schema', () => {
    const schema: DynamicFormSchema = {
      type: 'quantity',
      title: 'Moment Center',
      unit: 'm',
      value_schema: { type: 'array', items: { type: 'number' } },
    }
    expect(serializeValue(schema, { value: [0, '1.5', -2], units: 'm' })).toEqual({
      value: [0, 1.5, -2],
      units: 'm',
    })
  })

  it('selects the vector quantity branch when scalar and vector units match', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      variants: [
        { type: 'quantity', unit: 'm', value_schema: { type: 'number' } },
        { type: 'quantity', unit: 'm', value_schema: { type: 'array', items: { type: 'number' } } },
      ],
    }
    const canonical = { value: [1, 2, 3], units: 'm' }
    expect(hydrateSchemaValue(schema, canonical, true)).toEqual({ variant: 1, value: canonical })
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
    expect(markup.match(/>Meshing</g)).toHaveLength(1)
  })

  it('renders every first-level Draft field as the same collapsible section', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        meshing: {
          type: 'object',
          title: 'Meshing',
          properties: {
            defaults: {
              type: 'object',
              title: 'Defaults',
              properties: { target_count: { type: 'integer', title: 'Target count' } },
            },
            gap_treatment_strength: { type: 'number', title: 'Gap Treatment Strength' },
            outputs: { type: 'array', title: 'Outputs', items: { type: 'string' } },
          },
        },
      },
    }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { meshing: {} },
      sparse: true,
      showAll: true,
      rootTabs: true,
      collapsibleObjects: true,
      issues: [{ path: 'meshing.gap_treatment_strength', message: 'Required', level: 'error' }],
      onChange: () => undefined,
    }))

    expect(markup.match(/schema-root-field-section/g)).toHaveLength(3)
    expect(markup.match(/>Gap Treatment Strength</g)).toHaveLength(1)
    expect(markup.match(/>Outputs</g)).toHaveLength(1)
    expect(markup).toMatch(/schema-root-field-section schema-invalid" open=""/)
    expect(markup).toContain('schema-root-array')
    expect(markup).not.toContain('<legend')
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

  it('renders a root array with an empty state instead of a repeated fieldset heading', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        models: {
          type: 'array',
          title: 'Models',
          items: {
            type: 'object',
            properties: { name: { type: 'string', title: 'Model name' } },
          },
        },
      },
    }
    const emptyMarkup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: {},
      sparse: true,
      showAll: true,
      rootTabs: true,
      collapsibleObjects: true,
      onChange: () => undefined,
    }))
    const populatedMarkup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { models: [{ name: 'Fluid' }] },
      sparse: true,
      showAll: true,
      rootTabs: true,
      collapsibleObjects: true,
      onChange: () => undefined,
    }))

    expect(emptyMarkup).toContain('schema-root-array')
    expect(emptyMarkup).toContain('This list is empty')
    expect(emptyMarkup).not.toContain('<legend')
    expect(emptyMarkup.match(/>Models</g)).toHaveLength(1)
    expect(populatedMarkup).toContain('Item 1')
    expect(populatedMarkup).toContain('Edit')
    expect(populatedMarkup).not.toContain('Model name')
    expect(populatedMarkup).toContain('aria-label="Remove Models item 1"')
    expect(populatedMarkup).not.toContain('>0<')
  })

  it('round-trips schema-provided Surface and Slice entity payloads without exposing wire metadata', () => {
    const surface = {
      name: 'wing',
      private_attribute_id: 'surface-wing',
      private_attribute_entity_type_name: 'Surface',
      private_attribute_sub_components: ['face-1'],
    }
    const schema: DynamicFormSchema = {
      type: 'entity_list',
      title: 'Surfaces',
      entity_kind: 'Surface',
      entity_choices: [{ value: 'Surface:surface-wing', label: 'wing', model_type: 'Surface', payload: surface }],
    }
    const canonical = { stored_entities: [surface], selectors: ['wing*'] }
    const hydrated = hydrateSchemaValue(schema, canonical, true)
    expect(hydrated).toEqual({ entities: ['Surface:surface-wing'], selectors: ['wing*'] })
    expect(serializeValue(schema, hydrated, true)).toEqual(canonical)

    const markup = renderToStaticMarkup(createElement(SchemaFormFields, { schema, value: hydrated, onChange: () => undefined }))
    expect(markup).toContain('wing')
    expect(markup).toContain('Surface')
    expect(markup).not.toContain('private_attribute')
  })

  it('does not repeat a root union title below its tab', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        operating_condition: {
          type: 'union',
          title: 'Operating Condition',
          variants: [{
            type: 'object',
            title: 'GenericReferenceCondition',
            properties: { mach: { type: 'number', title: 'Mach' } },
          }],
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

    expect(markup).toContain('schema-root-union')
    expect(markup.match(/>Operating Condition</g)).toHaveLength(1)
    expect(markup).toContain('Value type')
    expect(markup).toContain('GenericReferenceCondition')
  })
})
