import { describe, expect, it } from 'vitest'
import { applyDraftSettings, readDraftSettings, type DraftSettings } from './DraftSettingsPanel'

const settings: DraftSettings = {
  unitSystem: 'Imperial',
  projectLengthUnit: 'inch',
  useGeometryAI: true,
  useBetaMesher: true,
}

describe('Draft settings', () => {
  it('reads runtime settings from canonical Flow360 fields', () => {
    expect(readDraftSettings({
      unit_system: { name: 'CGS' },
      private_attribute_asset_cache: {
        project_length_unit: { value: 1, units: 'mm' },
        use_geometry_AI: true,
        use_inhouse_mesher: true,
      },
    })).toEqual({
      unitSystem: 'CGS',
      projectLengthUnit: 'mm',
      useGeometryAI: true,
      useBetaMesher: true,
    })
  })

  it('uses safe defaults when older Drafts omit context metadata', () => {
    expect(readDraftSettings({})).toEqual({
      unitSystem: 'SI',
      projectLengthUnit: 'm',
      useGeometryAI: false,
      useBetaMesher: false,
    })
  })

  it('updates settings without dropping unrelated canonical metadata', () => {
    const next = applyDraftSettings({
      unit_system: { name: 'SI', custom: 'preserve' },
      private_attribute_asset_cache: { project_entity_info: { draft_entities: [{ id: 'e1' }] } },
      models: [{ type: 'Fluid' }],
    }, settings)
    expect(next).toMatchObject({
      unit_system: { name: 'Imperial', custom: 'preserve' },
      private_attribute_asset_cache: {
        project_length_unit: { value: 1, units: 'inch' },
        use_geometry_AI: true,
        use_inhouse_mesher: true,
        project_entity_info: { draft_entities: [{ id: 'e1' }] },
      },
      models: [{ type: 'Fluid' }],
    })
  })
})
