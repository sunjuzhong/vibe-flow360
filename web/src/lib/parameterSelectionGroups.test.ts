import { describe, expect, it } from 'vitest'
import { buildGeometryParameterSelectionPresets, buildParameterSelectionPresets } from './parameterSelectionGroups'

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
        id: 'face:groupName:fuselage',
        label: 'fuselage',
        tag: 'groupName',
        memberIds: ['face-3'],
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

  it('keeps semantic singleton aliases and expands body/file groups through the body index', () => {
    const realShape = {
      private_attribute_asset_cache: {
        project_entity_info: {
          face_group_tag: 'faceId',
          bodies_face_edge_ids: {
            body00001: { face_ids: ['face-1', 'face-2'] },
            body00002: { face_ids: ['face-3'] },
          },
          grouped_faces: [
            [
              { name: 'inlet', private_attribute_id: 'inlet', private_attribute_tag_key: 'builtinName', private_attribute_sub_components: ['face-1'] },
              { name: 'wall', private_attribute_id: 'wall', private_attribute_tag_key: 'builtinName', private_attribute_sub_components: ['face-2', 'face-3'] },
            ],
            [
              { name: 'body00001', private_attribute_id: 'body00001', private_attribute_tag_key: 'groupByBodyId', private_attribute_sub_components: ['face-1', 'face-2'] },
              { name: 'body00002', private_attribute_id: 'body00002', private_attribute_tag_key: 'groupByBodyId', private_attribute_sub_components: ['face-3'] },
            ],
            ['face-1', 'face-2', 'face-3'].map((id) => ({ name: id, private_attribute_id: id, private_attribute_tag_key: 'faceId', private_attribute_sub_components: [id] })),
          ],
          grouped_bodies: [
            [
              { name: 'body00001', private_attribute_id: 'body00001', private_attribute_tag_key: 'bodyId', private_attribute_sub_components: ['body00001'] },
              { name: 'body00002', private_attribute_id: 'body00002', private_attribute_tag_key: 'bodyId', private_attribute_sub_components: ['body00002'] },
            ],
            [{
              name: 'agent-geometry.step',
              private_attribute_id: 'agent-geometry.step',
              private_attribute_tag_key: 'groupByFile',
              private_attribute_sub_components: ['body00001', 'body00002'],
            }],
          ],
        },
      },
    }

    expect(buildParameterSelectionPresets(realShape, 'face', [
      { id: 'face-1' }, { id: 'face-2' }, { id: 'face-3' },
    ])).toEqual([
      { id: 'face:builtinName:inlet', label: 'inlet', tag: 'builtinName', memberIds: ['face-1'] },
      { id: 'face:builtinName:wall', label: 'wall', tag: 'builtinName', memberIds: ['face-2', 'face-3'] },
      { id: 'face:groupByBodyId:body00001', label: 'body00001', tag: 'groupByBodyId', memberIds: ['face-1', 'face-2'] },
      { id: 'face:groupByBodyId:body00002', label: 'body00002', tag: 'groupByBodyId', memberIds: ['face-3'] },
      { id: 'face:groupByFile:agent-geometry.step', label: 'agent-geometry.step', tag: 'groupByFile', memberIds: ['face-1', 'face-2', 'face-3'] },
    ])
  })

  it('builds body and file presets from both faces and edges, without partial fallback', () => {
    const geometryParams = {
      private_attribute_asset_cache: {
        project_entity_info: {
          face_group_tag: 'faceId',
          edge_group_tag: 'edgeId',
          bodies_face_edge_ids: {
            body00001: { face_ids: ['face-1', 'face-2'], edge_ids: ['edge-1', 'edge-2'] },
            body00002: { face_ids: ['face-3'], edge_ids: ['edge-3'] },
          },
          grouped_faces: [
            [{ name: 'body00001', private_attribute_id: 'body00001', private_attribute_tag_key: 'groupByBodyId', private_attribute_sub_components: ['face-1', 'face-2'] }],
            ['face-1', 'face-2', 'face-3'].map((id) => ({ name: id, private_attribute_id: id, private_attribute_tag_key: 'faceId', private_attribute_sub_components: [id] })),
          ],
          grouped_edges: [[
            'edge-1', 'edge-2', 'edge-3',
          ].map((id) => ({ name: id, private_attribute_id: id, private_attribute_tag_key: 'edgeId', private_attribute_sub_components: [id] }))],
          grouped_bodies: [
            [{ name: 'body00001', private_attribute_id: 'body00001', private_attribute_tag_key: 'bodyId', private_attribute_sub_components: ['body00001'] }],
            [{ name: 'model.step', private_attribute_id: 'model.step', private_attribute_tag_key: 'groupByFile', private_attribute_sub_components: ['body00001', 'body00002'] }],
          ],
        },
      },
    }

    expect(buildGeometryParameterSelectionPresets(
      geometryParams,
      [{ id: 'face-1' }, { id: 'face-2' }, { id: 'face-3' }],
      [{ id: 'edge-1' }, { id: 'edge-2' }],
    )).toEqual([
      {
        id: 'geometry:bodyId:body00001',
        label: 'body00001',
        tag: 'groupByBodyId',
        memberIds: ['face-1', 'face-2', 'edge-1', 'edge-2'],
        faceIds: ['face-1', 'face-2'],
        edgeIds: ['edge-1', 'edge-2'],
        available: true,
      },
      {
        id: 'geometry:groupByFile:model.step',
        label: 'model.step',
        tag: 'groupByFile',
        memberIds: [],
        faceIds: [],
        edgeIds: [],
        available: false,
      },
    ])
  })
})
