import { describe, expect, it, vi } from 'vitest'
import { createT08Environment, t08ConfiguredPatch, t08Params, t08Progress, validateT08Setup } from './t08'

describe('T08 automotive wind tunnel', () => {
  it('validates stationary-floor and moving-ground strategies', () => {
    expect(validateT08Setup(t08Params(false)).every((check) => check.passed)).toBe(true)
    expect(validateT08Setup(t08Params(true)).every((check) => check.passed)).toBe(true)
  })

  it('holds the analytic tunnel fixed while changing its floor model', () => {
    const baseline = (t08Params(false) as any).meshing.volume_zones[0]
    const variant = (t08Params(true) as any).meshing.volume_zones[0]
    expect(baseline.floor_type.type_name).toBe('StaticFloor')
    expect(variant.floor_type.type_name).toBe('WheelBelts')
    expect([baseline.width, baseline.height, baseline.inlet_x_position, baseline.outlet_x_position]).toEqual([variant.width, variant.height, variant.inlet_x_position, variant.outlet_x_position])
  })

  it('uses four signed rolling-wheel wall models only in the variant', () => {
    const rotations = (moving: boolean) => (t08Params(moving) as any).models.map((model: any) => model.velocity).filter((velocity: any) => velocity?.type_name === 'WallRotation')
    expect(rotations(false)).toHaveLength(0)
    expect(rotations(true).map((item: any) => item.angular_velocity.value)).toEqual([125, -125, 125, -125])
  })

  it('registers the wake Box and preserves remote Geometry groups in configured patches', () => {
    const patch = t08ConfiguredPatch(true) as any
    expect(patch.private_attribute_asset_cache.project_entity_info.draft_entities).toHaveLength(1)
    expect(patch.private_attribute_asset_cache.project_entity_info.draft_entities[0]).toMatchObject({ type_name: 'Box', name: 'Automotive wake corridor' })
    expect(patch.private_attribute_asset_cache.project_entity_info.grouped_faces).toBeUndefined()
  })

  it('tracks six engineering decisions', () => {
    expect(t08Progress(['question', 'tunnel', 'tunnel'])).toBe(33)
  })

  it('creates one bundled Geometry Project and two configured Case Drafts', async () => {
    const stageImport = vi.fn(async (_form: FormData) => ({ id: 'import-8' }) as any)
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, ...input }))
    const result = await createT08Environment({ folderId: 'folder-8', projectName: 'T08 automotive tunnel' }, {
      stageImport,
      approveImport: vi.fn(async () => ({ id: 'import-8' }) as any),
      runImport: vi.fn(async () => ({ result: { project_id: 'project-8', root_resource_id: 'geometry-8' } }) as any),
      createConfiguredDraft: createConfiguredDraft as any,
    }, () => undefined, vi.fn(async () => new Response('bundled automotive geometry')) as typeof fetch)
    expect(stageImport.mock.calls[0]?.[0].get('source_type')).toBe('geometry')
    expect(stageImport.mock.calls[0]?.[0].get('unit')).toBe('m')
    expect(createConfiguredDraft.mock.calls.map((call) => call[1].name)).toEqual(['T08 baseline · stationary floor', 'T08 variant · moving ground and wheels'])
    expect(result).toMatchObject({ projectId: 'project-8', rootResourceId: 'geometry-8' })
  })
})
