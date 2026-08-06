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

  it('creates a Geometry Project and two configured VolumeMesh Drafts', async () => {
    const calls: string[] = []
    const createConfiguredDraft = vi.fn(async (projectId: string, input: any) => ({ id: `${input.name}-id`, project_id: projectId, simulation_params: input.patch, ...input }))
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
        createConfiguredDraft: createConfiguredDraft as any,
      },
      () => undefined,
      vi.fn(async () => new Response('cylinder geometry')) as typeof fetch,
    )
    expect(calls).toEqual(['stage:T03 experiment:folder-3:cylinder.csm', 'approve:import-3', 'run:import-3:true'])
    expect(createConfiguredDraft).toHaveBeenCalledTimes(2)
    expect(createConfiguredDraft.mock.calls.map(([projectId]) => projectId)).toEqual(['project-3', 'project-3'])
    expect(result).toMatchObject({ projectId: 'project-3', rootResourceId: 'geometry-3' })
  })
})
