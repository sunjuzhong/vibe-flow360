import { describe, expect, it } from 'vitest'
import { buildParameterSelectionPresets } from './parameterSelectionGroups'

const params = {
  private_attribute_asset_cache: {
    project_entity_info: {
      face_group_tag: 'groupName',
      grouped_faces: [
        [{
          name: 'body00001',
          private_attribute_id: 'body00001',
          private_attribute_tag_key: 'groupByBodyId',
          private_attribute_sub_components: ['face-1', 'face-2', 'face-3'],
        }],
        [
          {
            name: 'wing',
            private_attribute_id: 'wing',
            private_attribute_tag_key: 'groupName',
            private_attribute_sub_components: ['face-1', 'face-2'],
          },
          {
            name: 'fuselage',
            private_attribute_id: 'fuselage',
            private_attribute_tag_key: 'groupName',
            private_attribute_sub_components: ['face-3'],
          },
        ],
        ['face-1', 'face-2', 'face-3'].map((id) => ({
          name: id,
          private_attribute_id: id,
          private_attribute_tag_key: 'faceId',
          private_attribute_sub_components: [id],
        })),
      ],
    },
  },
}

describe('buildParameterSelectionPresets', () => {
  it('maps parameter groups onto granular manifest items', () => {
    expect(buildParameterSelectionPresets(params, 'face', [
      { id: 'face-1', name: 'Face 1' },
      { id: 'face-2', name: 'Face 2' },
      { id: 'face-3', name: 'Face 3' },
    ])).toEqual([
      {
        id: 'face:groupByBodyId:body00001',
        label: 'body00001',
        tag: 'groupByBodyId',
        memberIds: ['face-1', 'face-2', 'face-3'],
      },
      {
        id: 'face:groupName:wing',
        label: 'wing',
        tag: 'groupName',
        memberIds: ['face-1', 'face-2'],
      },
    ])
  })

  it('uses active parameter groups to map coarser manifest items into a parent preset', () => {
    expect(buildParameterSelectionPresets({ simulation_params: params }, 'face', [
      { id: 'wing', name: 'Wing' },
      { id: 'fuselage', name: 'Fuselage' },
    ])).toEqual([{
      id: 'face:groupByBodyId:body00001',
      label: 'body00001',
      tag: 'groupByBodyId',
      memberIds: ['wing', 'fuselage'],
    }])
  })

  it('omits singleton, unmappable, and duplicate presets', () => {
    expect(buildParameterSelectionPresets(params, 'edge', [
      { id: 'edge-1' },
      { id: 'edge-2' },
    ])).toEqual([])
    expect(buildParameterSelectionPresets(params, 'face', [{ id: 'wing' }])).toEqual([])
  })
})
