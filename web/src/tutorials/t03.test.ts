import { describe, expect, it, vi } from 'vitest'
import { createT03Environment, t03Params, t03Progress, validateT03Setup } from './t03'

describe('T03 browser tutorial', () => {
  it('validates both baseline and refined mesh configurations', () => {
    expect(validateT03Setup(t03Params(false)).every((check) => check.passed)).toBe(true)
    expect(validateT03Setup(t03Params(true)).every((check) => check.passed)).toBe(true)
  })

  it('applies only the controlled mesh values', () => {
    const baseline = t03Params(false) as any
    const refined = t03Params(true) as any
    expect(baseline.meshing.refinements[0].max_edge_length.value).toBe(0.25)
    expect(refined.meshing.refinements[0].max_edge_length.value).toBe(0.15)
    expect(refined.meshing.refinements[0].curvature_resolution_angle.value).toBe(6)
    expect(refined.meshing.refinements[1].first_layer_thickness.value).toBe(0.005)
    expect(refined.meshing.volume_zones).toEqual(baseline.meshing.volume_zones)
  })

  it('tracks progress only for T03 steps', () => {
    expect(t03Progress(['question', 'question', 'geometry', 'unknown'])).toBe(33)
  })

  it('creates a Geometry Project and two local VolumeMesh Plans', async () => {
    const calls: string[] = []
    const createPlan = vi.fn(async (input: any) => ({ id: `${input.name}-id`, preflight: { valid: true } }))
    const result = await createT03Environment(
      { folderId: 'folder-3', projectName: 'T03 experiment' },
      {
        stageImport: async (form) => {
          calls.push(`stage:${form.get('name')}:${form.get('folder_id')}:${(form.get('files') as File).name}`)
          return { id: 'import-3' } as any
        },
        approveImport: async (id) => { calls.push(`approve:${id}`); return { id } as any },
        runImport: async (id, sync) => {
          calls.push(`run:${id}:${sync}`)
          return { id, result: { project_id: 'project-3', root_resource_id: 'geometry-3' } } as any
        },
        createPlan: createPlan as any,
      },
      () => undefined,
      vi.fn(async () => new Response('cylinder geometry')) as typeof fetch,
    )
    expect(calls).toEqual(['stage:T03 experiment:folder-3:cylinder.csm', 'approve:import-3', 'run:import-3:true'])
    expect(createPlan).toHaveBeenCalledTimes(2)
    expect(createPlan.mock.calls.map(([input]) => input.target)).toEqual(['volume-mesh', 'volume-mesh'])
    expect(result).toMatchObject({ projectId: 'project-3', geometryId: 'geometry-3' })
  })
})
