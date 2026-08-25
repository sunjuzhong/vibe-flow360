import { describe, expect, it, vi } from 'vitest'
import { applyDraftSelectionGroup, buildGeometryParameterSelectionPresets, buildParameterSelectionPresets, persistDraftSelectionGroup } from './parameterSelectionGroups'

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
    ])
  })

  it('omits unmappable semantic groups and derives bodies from the topology index', () => {
    const semanticParams = {
      private_attribute_asset_cache: {
        project_entity_info: {
          face_group_tag: 'faceName',
          edge_group_tag: 'edgeName',
          grouped_faces: [[{
            name: 'wing',
            private_attribute_id: 'wing-group',
            private_attribute_tag_key: 'faceName',
            private_attribute_sub_components: ['semantic-wing-face'],
          }]],
          grouped_edges: [[{
            name: 'leadingEdges',
            private_attribute_id: 'leading-group',
            private_attribute_tag_key: 'edgeName',
            private_attribute_sub_components: ['semantic-leading-edge'],
          }]],
          grouped_bodies: [[]],
          bodies_face_edge_ids: {
            body00001: { face_ids: ['face-1', 'face-2'], edge_ids: ['edge-1'] },
          },
        },
      },
    }

    expect(buildGeometryParameterSelectionPresets(
      semanticParams,
      [
        { id: 'face-1', path: ['Default CAD'] },
        { id: 'face-2', path: ['Default CAD'] },
      ],
      [{ id: 'edge-1', path: ['Default CAD'] }],
    )).toEqual([
      {
        id: 'geometry:bodyId:body00001',
        label: 'body00001',
        tag: 'groupByBodyId',
        memberIds: ['face-1', 'face-2', 'edge-1'],
        faceIds: ['face-1', 'face-2'],
        edgeIds: ['edge-1'],
        available: true,
      },
    ])
  })
})

describe('applyDraftSelectionGroup', () => {
  it('adds selected faces and edges to groupName schemes without changing the active grouping', () => {
    const source = {
      private_attribute_asset_cache: {
        project_entity_info: {
          face_group_tag: 'faceId',
          edge_group_tag: 'edgeId',
          face_attribute_names: ['faceId'],
          edge_attribute_names: ['edgeId'],
          grouped_faces: [[
            { name: 'face-1', private_attribute_id: 'face-1', private_attribute_tag_key: 'faceId', private_attribute_sub_components: ['raw-face-1'] },
          ]],
          grouped_edges: [[
            { name: 'edge-1', private_attribute_id: 'edge-1', private_attribute_tag_key: 'edgeId', private_attribute_sub_components: ['raw-edge-1'] },
          ]],
        },
      },
    }

    const next = applyDraftSelectionGroup(source, {
      name: ' control surfaces ',
      faces: [{ id: 'face-1' }],
      edges: [{ id: 'edge-1' }],
    })
    const info = next.private_attribute_asset_cache as {
      project_entity_info: Record<string, unknown>
    }
    expect(info.project_entity_info.face_group_tag).toBe('faceId')
    expect(info.project_entity_info.edge_group_tag).toBe('edgeId')
    expect(info.project_entity_info.face_attribute_names).toEqual(['faceId', 'groupName'])
    expect(info.project_entity_info.edge_attribute_names).toEqual(['edgeId', 'groupName'])
    expect(info.project_entity_info.grouped_faces).toEqual([
      source.private_attribute_asset_cache.project_entity_info.grouped_faces[0],
      [{
        name: 'control surfaces',
        private_attribute_entity_type_name: 'Surface',
        private_attribute_id: 'control surfaces',
        private_attribute_sub_components: ['raw-face-1'],
        private_attribute_tag_key: 'groupName',
      }],
    ])
    expect(info.project_entity_info.grouped_edges).toEqual([
      source.private_attribute_asset_cache.project_entity_info.grouped_edges[0],
      [{
        name: 'control surfaces',
        private_attribute_entity_type_name: 'Edge',
        private_attribute_id: 'control surfaces',
        private_attribute_sub_components: ['raw-edge-1'],
        private_attribute_tag_key: 'groupName',
      }],
    ])
  })

  it('appends to an existing groupName scheme and rejects empty or duplicate groups', () => {
    const source = {
      private_attribute_asset_cache: {
        project_entity_info: {
          grouped_faces: [[{
            name: 'Wing',
            private_attribute_id: 'wing',
            private_attribute_tag_key: 'groupName',
            private_attribute_sub_components: ['face-1'],
          }]],
        },
      },
    }
    expect(() => applyDraftSelectionGroup(source, { name: ' wing ', faces: [{ id: 'face-2' }], edges: [] }))
      .toThrow('already exists')
    expect(() => applyDraftSelectionGroup(source, { name: 'Tail', faces: [], edges: [] }))
      .toThrow('Select at least one face or edge')
    expect(() => applyDraftSelectionGroup(source, { name: ' ', faces: [{ id: 'face-2' }], edges: [] }))
      .toThrow('name is required')
  })

  it('preserves multi-entity legacy face and edge collections as schemes', () => {
    const legacyFaces = [{
      name: 'face-1',
      private_attribute_id: 'face-1',
      private_attribute_tag_key: 'faceId',
      private_attribute_sub_components: ['raw-face-1'],
    }, {
      name: 'face-2',
      private_attribute_id: 'face-2',
      private_attribute_tag_key: 'faceId',
      private_attribute_sub_components: ['raw-face-2'],
    }]
    const legacyEdges = [{
      name: 'edge-1',
      private_attribute_id: 'edge-1',
      private_attribute_tag_key: 'edgeId',
      private_attribute_sub_components: ['raw-edge-1'],
    }, {
      name: 'edge-2',
      private_attribute_id: 'edge-2',
      private_attribute_tag_key: 'edgeId',
      private_attribute_sub_components: ['raw-edge-2'],
    }]
    const next = applyDraftSelectionGroup({
      private_attribute_asset_cache: { project_entity_info: {
        face_group_tag: 'faceId',
        edge_group_tag: 'edgeId',
        face_attribute_names: ['faceId', 'groupName', 'groupName'],
        edge_attribute_names: ['edgeId', 'groupName', 'groupName'],
        grouped_faces: legacyFaces,
        grouped_edges: legacyEdges,
      } },
    }, {
      name: 'Wing',
      faces: [{ id: 'face-1' }],
      edges: [{ id: 'edge-2' }],
    })
    const cache = next.private_attribute_asset_cache as { project_entity_info: Record<string, unknown> }
    expect(cache.project_entity_info.face_attribute_names).toEqual(['faceId', 'groupName'])
    expect(cache.project_entity_info.edge_attribute_names).toEqual(['edgeId', 'groupName'])
    expect(cache.project_entity_info.grouped_faces).toEqual([
      legacyFaces,
      [expect.objectContaining({ name: 'Wing', private_attribute_sub_components: ['raw-face-1'] })],
    ])
    expect(cache.project_entity_info.grouped_edges).toEqual([
      legacyEdges,
      [expect.objectContaining({ name: 'Wing', private_attribute_sub_components: ['raw-edge-2'] })],
    ])
  })
})

describe('persistDraftSelectionGroup', () => {
  const baseline = {
    private_attribute_asset_cache: {
      project_entity_info: {
        face_group_tag: 'faceId',
        grouped_faces: [[
          { name: 'face-1', private_attribute_id: 'face-1', private_attribute_tag_key: 'faceId', private_attribute_sub_components: ['raw-face-1'] },
          { name: 'face-2', private_attribute_id: 'face-2', private_attribute_tag_key: 'faceId', private_attribute_sub_components: ['raw-face-2'] },
        ]],
      },
    },
  }

  it.each([
    ['invalid response', { valid: false, issues: [] }, 'invalid'],
    ['error issue', { valid: true, issues: [{ level: 'error', path: 'asset_cache', message: 'Rejected group' }] }, 'asset_cache: Rejected group'],
  ])('does not update or mutate current params after %s', async (_label, validation, message) => {
    const snapshot = structuredClone(baseline)
    const update = vi.fn(async (next: Record<string, unknown>) => ({ simulation_params: next }))
    await expect(persistDraftSelectionGroup(
      baseline,
      { name: 'Wing', faces: [{ id: 'face-1' }], edges: [] },
      vi.fn(async () => validation),
      update,
    )).rejects.toThrow(message)
    expect(update).not.toHaveBeenCalled()
    expect(baseline).toEqual(snapshot)
  })

  it('does not mutate current params when update rejects', async () => {
    const current = structuredClone(baseline)
    const snapshot = structuredClone(current)
    await expect(persistDraftSelectionGroup(
      current,
      { name: 'Wing', faces: [{ id: 'face-1' }], edges: [] },
      vi.fn(async () => ({ valid: true, issues: [] })),
      vi.fn(async () => { throw new Error('update failed') }),
    )).rejects.toThrow('update failed')
    expect(current).toEqual(snapshot)
  })

  it('validates before updating and preserves the first group on a consecutive save', async () => {
    const events: string[] = []
    const updateRequests: Record<string, unknown>[] = []
    const names = (candidate: Record<string, unknown>) => {
      const cache = candidate.private_attribute_asset_cache as { project_entity_info: { grouped_faces: Array<Array<{ name: string; private_attribute_tag_key: string }>> } }
      return cache.project_entity_info.grouped_faces.flat()
        .filter((entity) => entity.private_attribute_tag_key === 'groupName')
        .map((entity) => entity.name)
    }
    const validate = vi.fn(async (next: Record<string, unknown>) => {
      events.push(`validate:${names(next).at(-1)}`)
      return { valid: true, issues: [] }
    })
    const update = vi.fn(async (next: Record<string, unknown>) => {
      events.push(`update:${names(next).at(-1)}`)
      updateRequests.push(next)
      return { simulation_params: next }
    })

    let current: Record<string, unknown> = baseline
    current = await persistDraftSelectionGroup(
      current,
      { name: 'first', faces: [{ id: 'face-1' }], edges: [] },
      validate,
      update,
    )
    current = await persistDraftSelectionGroup(
      current,
      { name: 'second', faces: [{ id: 'face-2' }], edges: [] },
      validate,
      update,
    )

    expect(events).toEqual(['validate:first', 'update:first', 'validate:second', 'update:second'])
    expect(names(updateRequests[1])).toEqual(['first', 'second'])
    expect(names(current)).toEqual(['first', 'second'])
  })
})
