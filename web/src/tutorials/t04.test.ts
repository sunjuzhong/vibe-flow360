import { describe, expect, it, vi } from 'vitest'
import { createT04Environment, t04Params, t04Progress, validateT04Setup } from './t04'

describe('T04 airfoil edge refinement', () => {
  it('validates both mutually exclusive strategies', () => {
    expect(validateT04Setup(t04Params(false)).every((check) => check.passed)).toBe(true)
    expect(validateT04Setup(t04Params(true)).every((check) => check.passed)).toBe(true)
  })

  it('replaces explicit edge refinements in the Geometry AI variant', () => {
    const baseline = t04Params(false) as any
    const variant = t04Params(true) as any
    expect(baseline.meshing.refinements.some((item: any) => item.refinement_type === 'SurfaceEdgeRefinement')).toBe(true)
    expect(variant.meshing.refinements.some((item: any) => item.refinement_type === 'SurfaceEdgeRefinement')).toBe(false)
    expect(variant.meshing.refinements.some((item: any) => item.refinement_type === 'GeometryRefinement')).toBe(true)
    expect(variant.private_attribute_asset_cache.use_geometry_AI).toBe(true)
  })

  it('tracks six tutorial decisions', () => expect(t04Progress(['question', 'geometry', 'geometry'])).toBe(33))

  it('creates a Geometry Project and two configured Drafts', async () => {
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, simulation_params: input.patch, ...input }))
    const result = await createT04Environment(
      { folderId: 'folder-4', projectName: 'T04 experiment' },
      {
        stageImport: vi.fn(async () => ({ id: 'import-4' }) as any),
        approveImport: vi.fn(async () => ({ id: 'import-4' }) as any),
        runImport: vi.fn(async () => ({ result: { project_id: 'project-4', root_resource_id: 'geometry-4' } }) as any),
        createConfiguredDraft: createConfiguredDraft as any,
      },
      () => undefined,
      vi.fn(async () => new Response('airfoil geometry')) as typeof fetch,
    )
    expect(createConfiguredDraft).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ projectId: 'project-4', rootResourceId: 'geometry-4' })
  })
})
