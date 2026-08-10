import { describe, expect, it, vi } from 'vitest'
import { createT02Environment, t02ConfiguredPatch, t02Params, t02Progress, validateT02Setup } from './t02'

describe('T02 wind-tunnel similarity', () => {
  it('validates the Mach-only and Reynolds-matched conditions', () => {
    expect(validateT02Setup(t02Params(false)).every((check) => check.passed)).toBe(true)
    expect(validateT02Setup(t02Params(true)).every((check) => check.passed)).toBe(true)
  })

  it('holds Mach and velocity fixed while deriving the matched density', () => {
    const baseline = (t02Params(false) as any).operating_condition
    const matched = (t02Params(true) as any).operating_condition
    expect(baseline.private_attribute_input_cache.mach).toBe(0.18)
    expect(matched.private_attribute_input_cache.mach).toBe(0.18)
    expect(matched.private_attribute_input_cache.reynolds_mesh_unit).toBe(2_500_000)
    expect(matched.velocity_magnitude.value).toBeCloseTo(baseline.velocity_magnitude.value, 8)
    expect(baseline.thermal_state.density.value).toBeCloseTo(1.225, 3)
    expect(matched.thermal_state.density.value).toBeCloseTo(0.7303, 3)
  })

  it('preserves remote Geometry face groups in configured Draft patches', () => {
    for (const matched of [false, true]) {
      const cache = (t02ConfiguredPatch(matched) as any).private_attribute_asset_cache
      expect(cache.use_inhouse_mesher).toBeDefined()
      expect(cache.project_entity_info).toBeUndefined()
      expect(cache.project_length_unit).toBeUndefined()
    }
  })

  it('tracks six tutorial decisions', () => {
    expect(t02Progress(['question', 'derive', 'derive'])).toBe(33)
  })

  it('creates one bundled-Geometry Project and two configured Case Drafts', async () => {
    const stageImport = vi.fn(async (_form: FormData) => ({ id: 'import-2' }) as any)
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, ...input }))
    const fetchAsset = vi.fn(async () => new Response('bundled aircraft geometry')) as typeof fetch
    const result = await createT02Environment({ folderId: 'folder-2', projectName: 'T02 similarity' }, {
      stageImport,
      approveImport: vi.fn(async () => ({ id: 'import-2' }) as any),
      runImport: vi.fn(async () => ({ result: { project_id: 'project-2', root_resource_id: 'geometry-2' } }) as any),
      createConfiguredDraft: createConfiguredDraft as any,
    }, () => undefined, fetchAsset)

    expect(fetchAsset).toHaveBeenCalledTimes(1)
    expect(stageImport.mock.calls[0]?.[0].get('source_type')).toBe('geometry')
    expect(createConfiguredDraft).toHaveBeenCalledTimes(2)
    expect(createConfiguredDraft.mock.calls.map((call) => call[1].name)).toEqual([
      'T02 baseline · Mach-only ambient condition',
      'T02 variant · Mach and Reynolds matched',
    ])
    expect(result).toMatchObject({ projectId: 'project-2', rootResourceId: 'geometry-2' })
  })
})
