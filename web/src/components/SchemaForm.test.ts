import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DynamicFormSchema } from '../api/client'
import { cleanSchemaDescription, complexArrayCopy, complexArrayVariantGroup, configurationStatus, formatSchemaLabel, hydrateSchemaValue, initialValue, normalizeIssuePath, placeFloatingMenu, rootTabForIssuePath, schemaNeedsUserInput, SchemaFormFields, serializeValue } from './SchemaForm'
import { variantLabel } from './schema-fields/common'

describe('schema-driven Flow360 form', () => {
  it('keeps deep type menus inside the viewport and flips them above the trigger', () => {
    expect(placeFloatingMenu(
      { left: 650, right: 690, top: 700, bottom: 734, width: 40, height: 34 },
      { width: 290, height: 320 },
      { width: 700, height: 754 },
    )).toEqual({ left: 398, top: 375 })
  })

  it('uses collection-specific editor semantics instead of output copy', () => {
    expect(complexArrayCopy('models', 'Models')).toMatchObject({
      newKicker: 'NEW MODEL',
      editKicker: 'EDIT MODEL',
      fixedType: 'Model type is fixed after creation.',
      saveLabel: 'Save model',
    })
    expect(complexArrayCopy('meshing.refinements', 'Refinements').newKicker).toBe('NEW REFINEMENT')
    expect(complexArrayCopy('volume_zones', 'Volume Zones').closeLabel).toBe('Close volume zone editor')
    expect(complexArrayCopy('outputs', 'Outputs').newKicker).toBe('NEW OUTPUT')
  })

  it('groups searchable output and model choices with readable product categories', () => {
    expect(complexArrayVariantGroup('outputs', 'Outputs', 'SurfaceProbeOutput')).toBe('Probe')
    expect(complexArrayVariantGroup('outputs', 'Outputs', 'ForceOutput')).toBe('Force')
    expect(complexArrayVariantGroup('outputs', 'Outputs', 'TimeAverageVolumeOutput')).toBe('Volume')
    expect(complexArrayVariantGroup('outputs', 'Outputs', 'StreamlineOutput')).toBe('Render')
    expect(complexArrayVariantGroup('outputs', 'Outputs', 'SurfaceOutput')).toBe('Surface')
    expect(complexArrayVariantGroup('models', 'Models', 'Wall')).toBe('Boundary')
  })

  it('detects required input recursively for long-form filtering', () => {
    expect(schemaNeedsUserInput({ type: 'object', required: ['solver'], properties: { solver: { type: 'object', properties: {} } } })).toBe(true)
    expect(schemaNeedsUserInput({ type: 'object', properties: { optional: { type: 'string' } } })).toBe(false)
  })

  it('only presents a default state when the schema declares one explicitly', () => {
    expect(configurationStatus({ type: 'enum', default: 'auto' }, false, true)).toBe('Default value')
    expect(configurationStatus({ type: 'enum', options: ['auto'] }, false, true)).toBe('Not configured')
    expect(configurationStatus({ type: 'boolean', default: false }, false, true)).toBe('Default value')
    expect(configurationStatus({ type: 'enum', default: 'auto' }, true, true)).toBeUndefined()
  })

  it('omits unconfigured and zero-state badges from root navigation', () => {
    const schema: DynamicFormSchema = { type: 'object', properties: { alpha: { type: 'number', title: 'Alpha' } } }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { alpha: 2 },
      baseline: { alpha: 2 },
      rootTabs: true,
      collapsibleObjects: true,
      onChange: () => undefined,
    }))
    expect(markup).not.toContain('schema-root-tab-stats')
    expect(markup).not.toContain(' empty')
    expect(markup).not.toContain('>Set<')
    expect(markup).not.toContain('>Empty<')

    const changed = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { alpha: 3 },
      baseline: { alpha: 2 },
      rootTabs: true,
      collapsibleObjects: true,
      onChange: () => undefined,
    }))
    expect(changed).toContain('1 changed')
  })

  it('presents quantity-shaped objects directly without changing their wire shape', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        roughness_height: {
          type: 'object', title: 'Roughness Height',
          properties: { units: { type: 'string', required: true }, value: { type: 'number', minimum: 0, required: true } },
        },
      },
    }
    const canonical = { roughness_height: { units: 'm', value: 0.001 } }
    const hydrated = hydrateSchemaValue(schema, canonical, true)
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, { schema, value: hydrated, onChange: () => undefined }))
    expect(markup).toContain('schema-quantity-field')
    expect(markup).not.toContain('<details')
    expect(serializeValue(schema, hydrated, true)).toEqual(canonical)
  })

  it('keeps nullable wall-function state explicit and round-trips null unchanged', () => {
    const wallFunction: DynamicFormSchema = {
      type: 'object', title: 'Use Wall Function', nullable: true, default: null,
      properties: { wall_function_type: { type: 'enum', title: 'Wall Function Type', default: 'BoundaryLayer', options: ['BoundaryLayer', 'InnerLayer'] } },
    }
    const schema: DynamicFormSchema = { type: 'object', properties: { use_wall_function: wallFunction } }
    const hydrated = hydrateSchemaValue(schema, { use_wall_function: null }, true)
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, { schema, value: hydrated, showAll: true, onChange: () => undefined }))
    expect(markup).toContain('type="checkbox"')
    expect(markup).toContain('Disabled')
    expect(markup).not.toContain('Wall Function Type')
    expect(serializeValue(schema, hydrated, true)).toEqual({ use_wall_function: null })

    const enabled = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: hydrateSchemaValue(schema, { use_wall_function: { wall_function_type: 'InnerLayer' } }, true),
      showAll: true,
      onChange: () => undefined,
    }))
    expect(enabled).toContain('Wall Function Type')
  })

  it('shows heat specification as one domain picker with a direct branch value', () => {
    const quantityOrText: DynamicFormSchema = { type: 'union', title: 'Value', variants: [{ type: 'quantity', unit: 'W/m**2', unit_options: ['W/m**2'], value_schema: { type: 'number' } }, { type: 'string' }] }
    const heatSpec: DynamicFormSchema = {
      type: 'union', title: 'Heat Spec',
      variants: [
        { type: 'object', title: 'HeatFlux', properties: { type_name: { type: 'enum', default: 'HeatFlux', options: ['HeatFlux'] }, value: quantityOrText } },
        { type: 'object', title: 'Temperature', properties: { type_name: { type: 'enum', default: 'Temperature', options: ['Temperature'] }, value: { ...quantityOrText, variants: [{ type: 'quantity', unit: 'K', unit_options: ['K'], value_schema: { type: 'number' } }, { type: 'string' }] } } },
      ],
    }
    const schema: DynamicFormSchema = { type: 'object', properties: { heat_spec: heatSpec } }
    const canonical = { heat_spec: { type_name: 'HeatFlux', value: { value: 0, units: 'W/m**2' } } }
    const hydrated = hydrateSchemaValue(schema, canonical, true)
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, { schema, value: hydrated, showAll: true, onChange: () => undefined }))
    expect(markup.match(/schema-union-picker/g)).toHaveLength(1)
    expect(markup).toContain('Heat Flux')
    expect(markup).toContain('Temperature')
    expect(markup).not.toContain('Text value')
    expect(serializeValue(schema, hydrated, true)).toEqual(canonical)
  })

  it('uses domain labels for nested velocity choices instead of schema container types', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      variants: [
        { type: 'union', variants: [{ type: 'object', title: 'SlaterPorousBleed' }, { type: 'object', title: 'WallRotation' }] },
        { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } },
        { type: 'union', variants: [{ type: 'quantity' }, { type: 'expression' }] },
      ],
    }
    expect(schema.variants?.map(variantLabel)).toEqual(['Slater Porous Bleed / Wall Rotation', 'Vector', 'Fixed value / Expression'])
  })

  it('renders fixed numeric vectors as a structured tuple and preserves the wire array', () => {
    const vector: DynamicFormSchema = { type: 'tuple', title: 'Direction', minItems: 3, maxItems: 3, items: { type: 'number' } }
    const canonical = [0, 1, 0]
    const hydrated = hydrateSchemaValue(vector, canonical, true)
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, { schema: vector, value: hydrated, onChange: () => undefined }))
    expect(markup).toContain('schema-tuple-inputs')
    expect(markup).toContain('>X<')
    expect(markup).toContain('>Y<')
    expect(markup).toContain('>Z<')
    expect(serializeValue(vector, hydrated, true)).toEqual(canonical)
  })

  it('disables empty entity bulk actions and describes the current entity kind as an item', () => {
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema: { type: 'entity_list', title: 'Surfaces', entity_kind: 'Surface', entity_choices: [] },
      value: { entities: [] },
      onChange: () => undefined,
    }))
    expect(markup).toContain('<button type="button" disabled="">Select all</button>')
    expect(markup).toContain('No compatible entities')
    expect(markup).toContain('This field accepts: Surface.')
    expect(markup).toContain('Parameter entities panel')
    expect(markup).not.toContain('configuring this output')
  })

  it('formats schema class names as readable labels', () => {
    expect(formatSchemaLabel('SurfaceOutput')).toBe('Surface Output')
    expect(formatSchemaLabel('TimeAverageSurfaceOutput')).toBe('Time Average Surface Output')
  })

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

    const unsteady = initialValue(schema.variants![1], true) as Record<string, unknown>
    expect(unsteady).toEqual({ type_name: 'Unsteady', steps: '' })
    expect(serializeValue(schema, { variant: 1, value: { ...unsteady, steps: '1' } }, true)).toEqual({
      type_name: 'Unsteady',
      steps: 1,
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

  it('round-trips Flow360 refinements using schema-defined refinement_type discriminators', () => {
    const entityList: DynamicFormSchema = { type: 'entity_list', entity_kind: 'Surface', entity_choices: [] }
    const schema: DynamicFormSchema = {
      type: 'array',
      items: {
        type: 'union',
        variants: [
          {
            type: 'object',
            title: 'SurfaceEdgeRefinement',
            properties: {
              refinement_type: { type: 'enum', options: ['SurfaceEdgeRefinement'], default: 'SurfaceEdgeRefinement' },
              entities: entityList,
              feature_angle: { type: 'quantity', unit: 'degree', value_schema: { type: 'number' } },
            },
          },
          {
            type: 'object',
            title: 'SurfaceRefinement',
            properties: {
              refinement_type: { type: 'enum', options: ['SurfaceRefinement'], default: 'SurfaceRefinement' },
              entities: entityList,
              curvature_resolution_angle: { type: 'quantity', unit: 'degree', value_schema: { type: 'number' } },
            },
          },
          {
            type: 'object',
            title: 'PassiveSpacing',
            properties: {
              refinement_type: { type: 'enum', options: ['PassiveSpacing'], default: 'PassiveSpacing' },
              entities: entityList,
              type: { type: 'enum', options: ['projected', 'unchanged'] },
            },
          },
        ],
      },
    }
    const wing = { name: 'wing', private_attribute_id: 'surface-wing' }
    const symmetry = { name: 'symmetry', private_attribute_id: 'surface-symmetry' }
    const canonical = [
      {
        refinement_type: 'SurfaceRefinement',
        entities: { stored_entities: [wing] },
        curvature_resolution_angle: { value: 12, units: 'degree' },
      },
      {
        refinement_type: 'PassiveSpacing',
        entities: { stored_entities: [symmetry] },
        type: 'projected',
      },
    ]

    const hydrated = hydrateSchemaValue(schema, canonical, true) as Array<{ variant: number }>

    expect(hydrated.map((item) => item.variant)).toEqual([1, 2])
    expect(serializeValue(schema, hydrated, true)).toEqual(canonical)
  })

  it('initializes a new complex item with required fields and explicit defaults only', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        output_type: { type: 'enum', options: ['SurfaceOutput'], default: 'SurfaceOutput' },
        output_fields: { type: 'multi_select', options: ['Cp', 'yPlus'], value_key: 'items', required: true },
        frequency: { type: 'integer', default: -1 },
        write_single_file: { type: 'boolean', default: false },
        optional_note: { type: 'string' },
        nullable_name: { type: 'string', default: null },
      },
    }
    expect(initialValue(schema, true)).toEqual({
      output_type: 'SurfaceOutput',
      output_fields: { items: [] },
      frequency: -1,
      write_single_file: false,
    })
  })

  it('renders predefined Output fields as one multi-select and preserves its wire shape', () => {
    const schema: DynamicFormSchema = {
      type: 'multi_select',
      title: 'Output Fields',
      options: ['Cp', 'Mach', 'yPlus'],
      value_key: 'items',
      required: true,
    }
    const value = { items: ['Cp', 'yPlus'] }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value,
      onChange: () => undefined,
      sparse: true,
      showAll: true,
    }))

    expect(markup).toContain('class="schema-multi-select"')
    expect(markup).toContain('Cp')
    expect(markup).toContain('yPlus')
    expect(markup).toContain('2 selected')
    expect(markup).not.toContain('Add item')
    expect(markup).not.toContain('Item 1')
    expect(initialValue(schema, true)).toEqual({ items: [] })
    expect(hydrateSchemaValue(schema, value, true)).toEqual(value)
    expect(serializeValue(schema, value, true)).toEqual(value)
  })

  it('renders enum-array unions such as Output Format as one required multi-select', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      title: 'Output Format',
      minLength: 1,
      variants: [
        { type: 'array', items: { type: 'enum', options: ['paraview', 'tecplot', 'vtkhdf', 'ensight'] } },
        { type: 'enum', options: ['paraview', 'tecplot', 'both'] },
      ],
    }
    const value = hydrateSchemaValue(schema, ['paraview'], true)
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value,
      onChange: () => undefined,
      sparse: true,
      showAll: true,
    }))

    expect(markup).toContain('class="schema-multi-select"')
    expect(markup).toContain('paraview')
    expect(markup).toContain('tecplot')
    expect(markup).toContain('vtkhdf')
    expect(markup).toContain('ensight')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('Value type')
    expect(markup).not.toContain('Add item')
    expect(markup).not.toContain('Item 1')
    expect(serializeValue(schema, value, true)).toEqual(['paraview'])

    const legacyMarkup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: hydrateSchemaValue(schema, 'both', true),
      onChange: () => undefined,
      sparse: true,
      showAll: true,
    }))
    expect(legacyMarkup).toContain('2 selected')
  })

  it('renders Literal[-1] or PositiveInt as one constrained integer input', () => {
    const schema: DynamicFormSchema = {
      type: 'union',
      title: 'Frequency',
      variants: [
        { type: 'integer', exclusiveMinimum: 0 },
        { type: 'enum', options: [-1] },
      ],
    }
    const endOfSimulation = hydrateSchemaValue(schema, -1, true)
    const everyTenSteps = hydrateSchemaValue(schema, 10, true)
    expect(endOfSimulation).toEqual({ variant: 1, value: -1 })
    expect(everyTenSteps).toEqual({ variant: 0, value: 10 })

    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: endOfSimulation,
      onChange: () => undefined,
      sparse: true,
      showAll: true,
    }))
    expect(markup).toContain('schema-sentinel-integer')
    expect(markup).toContain('Use -1 for the end of the simulation')
    expect(markup).not.toContain('Value type')
    expect(markup).not.toContain('<select')
    expect(serializeValue(schema, endOfSimulation, true)).toBe(-1)
    expect(serializeValue(schema, everyTenSteps, true)).toBe(10)
    expect(() => serializeValue(schema, { variant: 0, value: '0' }, true)).toThrow('must be greater than 0')
    expect(() => serializeValue(schema, { variant: 0, value: '-2' }, true)).toThrow('must be greater than 0')
    expect(() => serializeValue(schema, { variant: 0, value: '1.5' }, true)).toThrow('requires an integer')
    expect(() => serializeValue(schema, { variant: 0, value: '' }, true)).toThrow('requires a number')
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

  it('renders atomic root fields directly and keeps complex root fields collapsible', () => {
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

    expect(markup.match(/schema-root-field-section/g)).toHaveLength(2)
    expect(markup.match(/>Gap Treatment Strength</g)).toHaveLength(1)
    expect(markup.match(/>Outputs</g)).toHaveLength(1)
    expect(markup).toContain('id="schema-meshing-gap_treatment_strength"')
    expect(markup).toMatch(/id="schema-meshing-gap_treatment_strength"[^>]*aria-invalid="true"/)
    expect(markup).toContain('schema-root-array')
    expect(markup).not.toContain('<legend')
  })

  it('projects and focuses an issue from a non-current root tab into its section and field', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        meshing: {
          type: 'object',
          title: 'Meshing',
          properties: { defaults: { type: 'number', title: 'Defaults' } },
        },
        case: {
          type: 'object',
          title: 'Case',
          properties: {
            solver: {
              type: 'object',
              title: 'Solver',
              properties: { max_steps: { type: 'integer', title: 'Maximum steps' } },
            },
          },
        },
      },
    }
    const issue = { path: 'simulation_params.case.solver.max_steps', message: 'Must be greater than zero', level: 'error' as const }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { meshing: { defaults: 1 }, case: { solver: { max_steps: 0 } } },
      rootTabs: true,
      collapsibleObjects: true,
      issues: [issue],
      focusIssuePath: issue.path,
      focusIssueRequest: 1,
      onChange: () => undefined,
    }))

    expect(normalizeIssuePath(issue.path)).toBe('case.solver.max_steps')
    expect(rootTabForIssuePath(issue.path, ['meshing', 'case'])).toBe('case')
    expect(markup).toContain('id="schema-root-tab-case"')
    expect(markup).toMatch(/id="schema-root-tab-case"[^>]*aria-selected="true"/)
    expect(markup).toMatch(/schema-root-field-section schema-invalid" open=""/)
    expect(markup).toContain('id="schema-case-solver-max_steps"')
    expect(markup).toContain('Must be greater than zero')
  })

  it('projects deep complex-array issues onto the visible field section', () => {
    const schema: DynamicFormSchema = {
      type: 'object',
      properties: {
        case: {
          type: 'object',
          properties: {
            models: {
              type: 'array',
              title: 'Models',
              items: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        },
      },
    }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { case: { models: [{ name: '' }] } },
      rootTabs: true,
      collapsibleObjects: true,
      issues: [{ path: 'case.models.0.name', message: 'Name is required', level: 'error' }],
      focusIssuePath: 'case.models.0.name',
      onChange: () => undefined,
    }))

    expect(markup).toContain('id="schema-case-models"')
    expect(markup).toContain('schema-field-invalid')
    expect(markup).toContain('Name is required')
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
    expect(emptyMarkup.match(/>Models</g)).toHaveLength(2)
    expect(populatedMarkup).toContain('Item 1')
    expect(populatedMarkup).toContain('Edit')
    expect(populatedMarkup).not.toContain('Model name')
    expect(populatedMarkup).toContain('aria-label="Remove Models item 1"')
    expect(populatedMarkup).not.toContain('>0<')
  })

  it('never renders a whole-group clear action while retaining per-item remove controls', () => {
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
    const render = (models: unknown[]) => renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { models },
      sparse: true,
      showAll: true,
      rootTabs: true,
      collapsibleObjects: true,
      removeLabel: 'Remove',
      onChange: () => undefined,
    }))

    expect(render([{ name: 'Fluid' }])).not.toContain('schema-root-remove')
    const multipleMarkup = render([{ name: 'Fluid' }, { name: 'Wall' }])
    expect(multipleMarkup).not.toContain('schema-root-remove')
    expect(multipleMarkup).not.toContain('Remove all Models')
    expect(multipleMarkup.match(/schema-array-remove/g)).toHaveLength(2)
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
    expect(hydrated).toEqual({
      entities: ['Surface:surface-wing'],
      selectors: ['wing*'],
      matched_stored_entities: [{ value: 'Surface:surface-wing', payload: surface }],
    })
    expect(serializeValue(schema, hydrated, true)).toEqual(canonical)

    const markup = renderToStaticMarkup(createElement(SchemaFormFields, { schema, value: hydrated, onChange: () => undefined }))
    expect(markup).toContain('wing')
    expect(markup).toContain('Surface')
    expect(markup).not.toContain('private_attribute')
  })

  it('strictly round-trips a stored canonical entity when a catalog choice has the same type and id', () => {
    const catalogEdge = {
      name: 'Trailing edge',
      private_attribute_id: 'edge-shared',
      private_attribute_entity_type_name: 'Edge',
    }
    const storedEdge = {
      ...catalogEdge,
      private_attribute_sub_components: ['edge-segment-1', 'edge-segment-2'],
      private_attribute_registry_bucket: { source: 'draft', revision: 4 },
    }
    const schema: DynamicFormSchema = {
      type: 'entity_list',
      title: 'Edges',
      entity_kind: 'Edge',
      entity_choices: [{ value: 'Edge:edge-shared', label: 'Trailing edge', model_type: 'Edge', payload: catalogEdge }],
    }
    const canonical = { stored_entities: [storedEdge] }

    const hydrated = hydrateSchemaValue(schema, canonical, true)

    expect(hydrated).toEqual({
      entities: ['Edge:edge-shared'],
      selectors: [],
      matched_stored_entities: [{ value: 'Edge:edge-shared', payload: storedEdge }],
    })
    expect(serializeValue(schema, hydrated, true)).toEqual(canonical)
  })

  it('preserves canonical entity payloads that are not present in the current form choices', () => {
    const unmatched = {
      name: 'AI selected face',
      private_attribute_id: 'surface-from-canonical-preflight',
      private_attribute_entity_type_name: 'Surface',
    }
    const schema: DynamicFormSchema = {
      type: 'entity_list',
      title: 'Surfaces',
      entity_kind: 'Surface',
      entity_choices: [],
    }
    const canonical = { stored_entities: [unmatched] }

    const hydrated = hydrateSchemaValue(schema, canonical, true)

    expect(hydrated).toEqual({
      entities: [],
      selectors: [],
      unmatched_stored_entities: [unmatched],
    })
    expect(serializeValue(schema, hydrated, true)).toEqual(canonical)
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
    expect(markup.match(/>Operating Condition</g)).toHaveLength(2)
    expect(markup).toContain('Value type')
    expect(markup).toContain('Generic Reference Condition')
  })

  it('keeps raw schema paths out of the draft root-tab form surface', () => {
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
              properties: {
                boundary_layer_growth_rate: { type: 'number', title: 'Boundary Layer Growth Rate' },
                first_layer_height: { type: 'quantity', title: 'First Layer Height', unit: 'm', value_schema: { type: 'number' } },
              },
            },
          },
        },
      },
    }
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value: { meshing: { defaults: { boundary_layer_growth_rate: 1.2, first_layer_height: { value: 0.01, units: 'm' } } } },
      sparse: true,
      showAll: true,
      rootTabs: true,
      collapsibleObjects: true,
      onChange: () => undefined,
    }))

    expect(markup).toContain('Boundary Layer Growth Rate')
    expect(markup).toContain('First Layer Height')
    expect(markup).not.toContain('meshing.defaults.boundary_layer_growth_rate')
    expect(markup).not.toContain('meshing.defaults.first_layer_height')
  })

  it('applies the shared required, disabled, and warning contract across schema editors', () => {
    const disabled = { disabled: true, required: true }
    const schema: DynamicFormSchema = {
      type: 'object',
      required: ['text', 'number', 'select', 'toggle', 'quantity', 'multi', 'entities', 'variant', 'array', 'expression', 'fallback'],
      properties: {
        text: { type: 'string', title: 'Text', ...disabled },
        number: { type: 'number', title: 'Number', ...disabled },
        select: { type: 'enum', title: 'Select', options: ['one'], ...disabled },
        toggle: { type: 'boolean', title: 'Toggle', ...disabled },
        quantity: { type: 'quantity', title: 'Quantity', unit: 'm', value_schema: { type: 'number' }, ...disabled },
        multi: { type: 'multi_select', title: 'Multi', options: ['Cp'], value_key: 'items', ...disabled },
        entities: { type: 'entity_list', title: 'Entities', entity_choices: [{ value: 'wing', label: 'Wing' }], ...disabled },
        variant: { type: 'union', title: 'Variant', variants: [{ type: 'string', title: 'Text variant' }, { type: 'number', title: 'Number variant' }], ...disabled },
        array: { type: 'array', title: 'Array', items: { type: 'string' }, ...disabled },
        expression: { type: 'expression', title: 'Expression', wire_discriminator: { field: 'type_name', value: 'expression' }, ...disabled },
        fallback: { type: 'json', title: 'JSON fallback', ...disabled },
      },
    }
    const value = hydrateSchemaValue(schema, {
      text: 'air', number: 1, select: 'one', toggle: true,
      quantity: { value: 1, units: 'm' }, multi: { items: ['Cp'] },
      entities: { stored_entities: [] }, variant: 'fixed', array: ['item'],
      expression: { type_name: 'expression', expression: '1 * u.m' }, fallback: { custom: true },
    }, true)
    const markup = renderToStaticMarkup(createElement(SchemaFormFields, {
      schema,
      value,
      sparse: true,
      showAll: true,
      issues: [{ path: 'text', level: 'warning', message: 'Review this value.' }],
      onChange: () => undefined,
    }))

    expect((markup.match(/field-shell--disabled/g) ?? []).length).toBeGreaterThanOrEqual(11)
    expect((markup.match(/aria-required="true"/g) ?? []).length).toBeGreaterThanOrEqual(8)
    expect(markup).toContain('field-shell--warning')
    expect(markup).toContain('Review this value.')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('schema-multi-select')
    expect(markup).toContain('schema-entity-list')
    expect(markup).toContain('schema-union-picker')
    expect(markup).toContain('schema-array-editor')
    expect(markup).toContain('schema-expression')
    expect(markup).toContain('plan-code-input')
  })
})
