import { describe, expect, it, vi } from 'vitest'
import { createT07Environment, t07ConfiguredPatch, t07Params, t07Progress, validateT07Setup } from './t07'

describe('T07 internal-flow meshing', () => {
  it('validates global-only and feature-aware strategies', () => {
    expect(validateT07Setup(t07Params(false)).every((check) => check.passed)).toBe(true)
    expect(validateT07Setup(t07Params(true)).every((check) => check.passed)).toBe(true)
  })

  it('uses one supplied domain and never generates an exterior farfield', () => {
    for (const featureAware of [false, true]) {
      const zones = (t07Params(featureAware) as any).meshing.volume_zones
      expect(zones.filter((zone: any) => zone.type === 'UserDefinedFarfield')).toHaveLength(1)
      expect(zones.some((zone: any) => zone.type === 'AutomatedFarfield')).toBe(false)
    }
  })

  it('registers the exact SeedpointVolume referenced by CustomZones', () => {
    const params = t07Params(false) as any
    const zoneSeed = params.meshing.volume_zones.find((zone: any) => zone.type === 'CustomZones').entities.stored_entities[0]
    const registered = params.private_attribute_asset_cache.project_entity_info.draft_entities[0]
    expect(zoneSeed).toMatchObject({ type: 'SeedpointVolume', name: 'Primary duct fluid', private_attribute_id: registered.private_attribute_id })
    expect(zoneSeed.point_in_mesh[0]).toEqual({ units: 'm', value: [1, 0, 2] })
  })

  it('adds only the five feature-aware refinements', () => {
    expect((t07Params(false) as any).meshing.refinements).toEqual([])
    const refinements = (t07Params(true) as any).meshing.refinements
    expect(refinements.map((item: any) => item.refinement_type)).toEqual([
      'SurfaceRefinement', 'SurfaceRefinement', 'BoundaryLayer', 'PassiveSpacing', 'PassiveSpacing',
    ])
  })

  it('preserves remote face groups while retaining the registered seed', () => {
    const cache = (t07ConfiguredPatch(true) as any).private_attribute_asset_cache
    expect(cache.project_entity_info.draft_entities).toHaveLength(1)
    expect(cache.project_entity_info.grouped_faces).toBeUndefined()
    expect(cache.project_length_unit).toBeUndefined()
  })

  it('tracks six tutorial decisions', () => {
    expect(t07Progress(['question', 'topology', 'topology'])).toBe(33)
  })

  it('creates one bundled Geometry Project and two configured VolumeMesh Drafts', async () => {
    const stageImport = vi.fn(async (_form: FormData) => ({ id: 'import-7' }) as any)
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, ...input }))
    const result = await createT07Environment({ folderId: 'folder-7', projectName: 'T07 internal duct' }, {
      stageImport,
      approveImport: vi.fn(async () => ({ id: 'import-7' }) as any),
      runImport: vi.fn(async () => ({ result: { project_id: 'project-7', root_resource_id: 'geometry-7' } }) as any),
      createConfiguredDraft: createConfiguredDraft as any,
    }, () => undefined, vi.fn(async () => new Response('bundled internal-flow geometry')) as typeof fetch)

    expect(stageImport.mock.calls[0]?.[0].get('source_type')).toBe('geometry')
    expect(stageImport.mock.calls[0]?.[0].get('unit')).toBe('m')
    expect(createConfiguredDraft).toHaveBeenCalledTimes(2)
    expect(createConfiguredDraft.mock.calls.map((call) => call[1].name)).toEqual([
      'T07 baseline · global internal mesh',
      'T07 variant · feature-aware internal mesh',
    ])
    expect(result).toMatchObject({ projectId: 'project-7', rootResourceId: 'geometry-7' })
  })
})
