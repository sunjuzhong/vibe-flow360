import { describe, expect, it, vi } from 'vitest'
import { createT09Environment, t09ConfiguredPatch, t09Params, t09Progress, validateT09Setup } from './t09'

describe('T09 nested rotation', () => {
  it('validates shared-zone and nested-zone strategies', () => {
    expect(validateT09Setup(t09Params(false)).every((check) => check.passed)).toBe(true)
    expect(validateT09Setup(t09Params(true)).every((check) => check.passed)).toBe(true)
  })

  it('adds a spherical zone and parent-relative motion only in the variant', () => {
    const baseline = t09Params(false) as any; const nested = t09Params(true) as any
    expect(baseline.meshing.volume_zones.filter((zone: any) => zone.type === 'RotationSphere')).toHaveLength(0)
    expect(nested.meshing.volume_zones.filter((zone: any) => zone.type === 'RotationSphere')).toHaveLength(1)
    const child = nested.models.find((model: any) => model.name === 'Inner relative rotation')
    expect(child.spec.value.value).toBe(-500)
    expect(child.parent_volume.private_attribute_id).toBe('90000000-0000-4000-8000-000000000901')
  })

  it('registers all analytic entities without copying canonical Geometry groups', () => {
    const patch = t09ConfiguredPatch(true) as any
    expect(patch.private_attribute_asset_cache.project_entity_info.draft_entities).toHaveLength(4)
    expect(patch.private_attribute_asset_cache.project_entity_info.draft_entities.map((item: any) => item.private_attribute_entity_type_name)).toEqual(['Cylinder', 'Sphere', 'Cylinder', 'Slice'])
    expect(patch.private_attribute_asset_cache.project_entity_info.grouped_faces).toBeUndefined()
  })

  it('tracks six engineering decisions', () => { expect(t09Progress(['question', 'roles', 'roles'])).toBe(33) })

  it('creates one bundled Geometry Project and two configured Case Drafts', async () => {
    const stageImport = vi.fn(async (_form: FormData) => ({ id: 'import-9' }) as any)
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, ...input }))
    const result = await createT09Environment({ folderId: 'folder-9', projectName: 'T09 nested rotor' }, {
      stageImport,
      approveImport: vi.fn(async () => ({ id: 'import-9' }) as any),
      runImport: vi.fn(async () => ({ result: { project_id: 'project-9', root_resource_id: 'geometry-9' } }) as any),
      createConfiguredDraft: createConfiguredDraft as any,
    }, () => undefined, vi.fn(async () => new Response('bundled coaxial rotor')) as typeof fetch)
    expect(stageImport.mock.calls[0]?.[0].get('source_type')).toBe('geometry')
    expect(createConfiguredDraft.mock.calls.map((call) => call[1].name)).toEqual(['T09 baseline · shared rotating zone', 'T09 variant · nested rotating zones'])
    expect(result).toMatchObject({ projectId: 'project-9', rootResourceId: 'geometry-9' })
  })
})
