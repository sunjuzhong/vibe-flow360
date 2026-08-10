import { describe, expect, it, vi } from 'vitest'
import { createT05Environment, t05ConfiguredPatch, t05Params, t05Progress, validateT05Setup } from './t05'

describe('T05 wake volume refinement', () => {
  it('validates baseline and focused-wake strategies', () => {
    expect(validateT05Setup(t05Params(false)).every((check) => check.passed)).toBe(true)
    expect(validateT05Setup(t05Params(true)).every((check) => check.passed)).toBe(true)
  })

  it('registers every refinement and output entity in the Draft entity catalog', () => {
    for (const focused of [false, true]) {
      const params = t05Params(focused) as any
      const registered = params.private_attribute_asset_cache.project_entity_info.draft_entities
      expect(registered.map((entity: any) => entity.private_attribute_entity_type_name)).toEqual([
        'Sphere', 'Box', 'Cylinder', 'Slice',
      ])
      expect(new Set(registered.map((entity: any) => entity.private_attribute_id)).size).toBe(4)
    }

    const dangling = structuredClone(t05Params(false)) as any
    dangling.private_attribute_asset_cache.project_entity_info.draft_entities = []
    expect(validateT05Setup(dangling).find((check) => check.id === 'entities')?.passed).toBe(false)
  })

  it('merges only Draft entities into the remote Geometry entity catalog', () => {
    const patch = t05ConfiguredPatch(false) as any
    expect(patch.private_attribute_asset_cache.project_entity_info.draft_entities).toHaveLength(4)
    expect(patch.private_attribute_asset_cache.project_entity_info.grouped_faces).toBeUndefined()
    expect(patch.private_attribute_asset_cache.project_length_unit).toBeUndefined()
  })

  it('extends the focused variant and tightens crossflow spacing', () => {
    const refinements = (t05Params(true) as any).meshing.refinements
    const box = refinements.find((item: any) => item.refinement_type === 'StructuredBoxRefinement')
    const storedBox = box.entities.stored_entities[0]
    expect(storedBox.size.value[0]).toBe(12.5)
    expect(box.spacing_axis2.value).toBe(0.08)
    expect(box.spacing_axis1.value).toBeGreaterThan(box.spacing_axis2.value)
  })

  it('tracks six tutorial decisions', () => expect(t05Progress(['question', 'regions', 'regions'])).toBe(33))

  it('creates a Geometry Project and two configured Drafts', async () => {
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, ...input }))
    const result = await createT05Environment(
      { folderId: 'folder-5', projectName: 'T05 experiment' },
      {
        stageImport: vi.fn(async () => ({ id: 'import-5' }) as any),
        approveImport: vi.fn(async () => ({ id: 'import-5' }) as any),
        runImport: vi.fn(async () => ({ result: { project_id: 'project-5', root_resource_id: 'geometry-5' } }) as any),
        createConfiguredDraft: createConfiguredDraft as any,
      },
      () => undefined,
      vi.fn(async () => new Response('cylinder geometry')) as typeof fetch,
    )
    expect(createConfiguredDraft).toHaveBeenCalledTimes(2)
    expect(createConfiguredDraft.mock.calls[0][1].patch.private_attribute_asset_cache.project_entity_info.draft_entities).toHaveLength(4)
    expect(result).toMatchObject({ projectId: 'project-5', rootResourceId: 'geometry-5' })
  })
})
