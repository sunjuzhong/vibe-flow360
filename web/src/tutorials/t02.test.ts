import { describe, expect, it, vi } from 'vitest'
import { createT02Environment, t02Paths, t02PlanParams, t02Progress } from './t02'

describe('T02 project entry paths', () => {
  it('removes the stages that precede each root', () => {
    expect(t02Paths['surface-mesh'].required).toEqual(['VolumeMesh', 'Case'])
    expect(t02Paths['volume-mesh'].required).toEqual(['Case'])
  })

  it('adds volume meshing only to the SurfaceMesh path', () => {
    expect(t02PlanParams('surface-mesh', 0)).toHaveProperty('meshing')
    expect(t02PlanParams('volume-mesh', 0)).not.toHaveProperty('meshing')
    expect((t02PlanParams('volume-mesh', 5).operating_condition as any).alpha.value).toBe(5)
  })

  it('creates the selected Project root and two Case Plans', async () => {
    const calls: any[] = []
    const client = {
      stageImport: vi.fn(async (form: FormData) => { calls.push([form.get('source_type'), (form.get('files') as File).name]); return { id: 'import-2' } as any }),
      approveImport: vi.fn(async () => ({ id: 'import-2' }) as any),
      runImport: vi.fn(async () => ({ result: { project_id: 'prj-2', root_resource_id: 'vm-2' } }) as any),
      createPlan: vi.fn(async (input: any) => ({ id: `plan-${input.name}`, ...input })),
    }
    const stages: string[] = []
    const result = await createT02Environment({ folderId: 'folder-2', projectName: 'T02', entry: 'volume-mesh', file: new File(['mesh'], 'mesh.cgns') }, client, (stage) => stages.push(stage))
    expect(calls).toEqual([['volume-mesh', 'mesh.cgns']])
    expect(client.createPlan).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ projectId: 'prj-2', geometryId: 'vm-2' })
    expect(stages).toEqual(['staging', 'creating-project', 'creating-plans', 'ready'])
  })

  it('tracks six lesson decisions', () => expect(t02Progress(['question', 'tree', 'tree'])).toBe(33))
})
