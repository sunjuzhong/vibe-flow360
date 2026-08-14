import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import DraftEntityEditorDialog, {
  draftEntitySchema,
  normalizeDraftEntity,
  validateDraftEntityValue,
} from './DraftEntityEditorDialog'

describe('DraftEntityEditorDialog', () => {
  it('builds a type-specific dynamic schema', () => {
    expect(Object.keys(draftEntitySchema('Sphere').properties ?? {})).toEqual([
      'private_attribute_id', 'name', 'center', 'radius',
    ])
    expect(Object.keys(draftEntitySchema('PointArray2D').properties ?? {})).toEqual([
      'private_attribute_id', 'name', 'origin', 'u_axis_vector', 'v_axis_vector',
      'u_number_of_points', 'v_number_of_points',
    ])
  })

  it('normalizes Box constructor metadata and validates geometry constraints', () => {
    const value = {
      private_attribute_id: 'box-1', name: 'Wake box',
      axes: [[1, 0, 0], [0, 1, 0]],
      center: { value: [0, 0, 0], units: 'm' },
      size: { value: [1, 2, 3], units: 'm' },
    }
    expect(validateDraftEntityValue('Box', value)).toEqual([])
    expect(normalizeDraftEntity('Box', value)).toMatchObject({
      type_name: 'Box',
      private_attribute_entity_type_name: 'Box',
      private_attribute_constructor: 'from_principal_axes',
      private_attribute_input_cache: { name: 'Wake box', size: value.size },
    })
    expect(validateDraftEntityValue('Box', { ...value, size: { value: [1, 0, 3], units: 'm' } })).toContain('size values must be greater than zero.')
  })

  it('renders fixed vectors as compact components instead of mutable array cards', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <DraftEntityEditorDialog
          unit="m"
          initialType="Sphere"
          saving={false}
          onSave={async () => undefined}
          onClose={() => undefined}
        />
      </I18nProvider>,
    )
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('aria-labelledby=')
    expect(html).toContain('Entity type')
    expect(html).toContain('<output aria-label="Entity type" aria-readonly="true">Sphere</output>')
    expect(html).toContain('Entity ID')
    expect(html).toContain('readOnly="" aria-readonly="true"')
    expect(html).toContain('class="draft-entity-vector"')
    expect(html).toContain('aria-label="Center Units"')
    expect(html).not.toContain('<select aria-label="Entity type"')
    expect(html).not.toContain('Add item')
    expect(html).not.toContain('Remove Principal axes')
    expect(html).toContain('Save entity')
  })
})
