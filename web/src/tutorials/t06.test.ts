import { describe, expect, it, vi } from 'vitest'
import { createT06Environment, t06ConfiguredPatch, t06Params, t06Progress, validateT06Setup } from './t06'

describe('T06 farfield selection', () => {
  it('validates automatic, compact, and manual strategies', () => {
    for (const strategy of ['automatic', 'compact', 'manual'] as const) {
      expect(validateT06Setup(t06Params(strategy)).every((check) => check.passed)).toBe(true)
    }
  })

  it('changes only automatic relative size for the compact candidate', () => {
    const automatic = (t06Params('automatic') as any).meshing.volume_zones[0]
    const compact = (t06Params('compact') as any).meshing.volume_zones[0]
    expect(automatic.type).toBe('AutomatedFarfield')
    expect(automatic.relative_size).toBe(20)
    expect(compact.relative_size).toBe(8)
    expect(compact.enclosed_entities).toEqual(automatic.enclosed_entities)
  })

  it('uses UserDefinedFarfield only in the manual-domain artifact', () => {
    const zones = (t06Params('manual') as any).meshing.volume_zones
    expect(zones[0]).toMatchObject({ type: 'UserDefinedFarfield', name: 'Provided external domain' })
    expect(zones.some((zone: any) => zone.type === 'AutomatedFarfield')).toBe(false)
  })

  it('registers the nested CustomVolume and bounding Cylinder without replacing remote face groups', () => {
    const patch = t06ConfiguredPatch('automatic') as any
    expect(patch.private_attribute_asset_cache.project_entity_info.draft_entities.map((entity: any) => entity.private_attribute_entity_type_name)).toEqual(['Cylinder', 'CustomVolume'])
    expect(patch.private_attribute_asset_cache.project_entity_info.grouped_faces).toBeUndefined()
    expect(patch.private_attribute_asset_cache.project_length_unit).toBeUndefined()
  })

  it('tracks six tutorial decisions', () => expect(t06Progress(['question', 'topology', 'topology'])).toBe(33))

  it('creates two automatic Drafts from body-only CAD', async () => {
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, ...input }))
    const result = await createT06Environment('automatic', { folderId: 'folder-6', projectName: 'T06 automatic' }, {
      stageImport: vi.fn(async () => ({ id: 'import-6' }) as any),
      approveImport: vi.fn(async () => ({ id: 'import-6' }) as any),
      runImport: vi.fn(async () => ({ result: { project_id: 'project-6', root_resource_id: 'geometry-6' } }) as any),
      createConfiguredDraft: createConfiguredDraft as any,
    }, () => undefined, vi.fn(async () => new Response('body-only geometry')) as typeof fetch)
    expect(createConfiguredDraft).toHaveBeenCalledTimes(2)
    expect(result.variantDraft).toBeDefined()
  })

  it('creates one manual Draft from the closed fluid-domain CAD', async () => {
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, ...input }))
    const result = await createT06Environment('manual', { folderId: 'folder-6', projectName: 'T06 manual' }, {
      stageImport: vi.fn(async () => ({ id: 'import-6m' }) as any),
      approveImport: vi.fn(async () => ({ id: 'import-6m' }) as any),
      runImport: vi.fn(async () => ({ result: { project_id: 'project-6m', root_resource_id: 'geometry-6m' } }) as any),
      createConfiguredDraft: createConfiguredDraft as any,
    }, () => undefined, vi.fn(async () => new Response('closed fluid domain')) as typeof fetch)
    expect(createConfiguredDraft).toHaveBeenCalledTimes(1)
    expect(result.variantDraft).toBeUndefined()
    expect(createConfiguredDraft.mock.calls[0][1].patch.meshing.volume_zones[0].type).toBe('UserDefinedFarfield')
  })
})
