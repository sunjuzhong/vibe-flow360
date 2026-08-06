import { describe, expect, it } from 'vitest'
import {
  createT01Environment,
  mergeTutorialPatch,
  t01Baseline,
  t01ParamsForAlpha,
  tutorialProgress,
  validateT01Setup,
} from './t01'
import type { ConfiguredDraft, ImportPlan } from '../api/client'

describe('T01 browser tutorial', () => {
  it('uses the committed SimulationParams artifact as its baseline', () => {
    const checks = validateT01Setup(t01Baseline)
    expect(checks).toHaveLength(6)
    expect(checks.every((check) => check.passed)).toBe(true)
  })

  it('applies only the controlled five-degree patch', () => {
    const variant = t01ParamsForAlpha(5)
    const condition = variant.operating_condition as Record<string, Record<string, unknown>>
    const baselineCondition = t01Baseline.operating_condition as Record<string, Record<string, unknown>>

    expect(condition.alpha.value).toBe(5)
    expect(condition.private_attribute_input_cache.alpha).toEqual({ units: 'degree', value: 5 })
    expect(condition.velocity_magnitude).toEqual(baselineCondition.velocity_magnitude)
    expect(variant.meshing).toEqual(t01Baseline.meshing)
    expect(variant.models).toEqual(t01Baseline.models)
  })

  it('implements RFC 7396 deletion without mutating the source', () => {
    const source = { nested: { keep: 1, remove: 2 } }
    expect(mergeTutorialPatch(source, { nested: { remove: null } })).toEqual({ nested: { keep: 1 } })
    expect(source.nested.remove).toBe(2)
  })

  it('counts only known, unique lesson steps', () => {
    expect(tutorialProgress(['question', 'question', 'unknown'])).toBe(17)
    expect(tutorialProgress(['question', 'geometry', 'setup', 'variant', 'evidence', 'run'])).toBe(100)
  })

  it('creates a processed Project and two configured remote Drafts', async () => {
    const calls: string[] = []
    const draftInputs: Array<Record<string, unknown>> = []
    const staged = { id: 'import-1', status: 'draft' } as ImportPlan
    const approved = { ...staged, status: 'approved' } as ImportPlan
    const submitted = {
      ...approved,
      status: 'submitted',
      result: { project_id: 'prj-1', root_resource_id: 'geo-1' },
    } as ImportPlan
    const client = {
      stageImport: async (form: FormData) => {
        calls.push(`stage:${form.get('name')}:${form.get('folder_id')}:${(form.get('files') as File).name}`)
        return staged
      },
      approveImport: async (id: string) => { calls.push(`approve:${id}`); return approved },
      runImport: async (id: string, sync?: boolean) => { calls.push(`run:${id}:${sync}`); return submitted },
      createConfiguredDraft: async (projectId: string, input: Record<string, unknown>) => {
        draftInputs.push({ projectId, ...input })
        return { id: `draft-${draftInputs.length}`, project_id: projectId, simulation_params: input.patch, ...input } as ConfiguredDraft
      },
    }
    const stages: string[] = []

    const result = await createT01Environment(
      { folderId: 'folder-1', projectName: 'T01 experiment' },
      client,
      (stage) => stages.push(stage),
      async () => new Response('despmtr geometry', { status: 200 }),
    )

    expect(calls).toEqual(['stage:T01 experiment:folder-1:geometry.csm', 'approve:import-1', 'run:import-1:true'])
    expect(stages).toEqual(['staging', 'creating-project', 'creating-drafts', 'ready'])
    expect(result.projectId).toBe('prj-1')
    expect(draftInputs).toHaveLength(2)
    expect(draftInputs[0].projectId).toBe('prj-1')
    expect((draftInputs[0].patch as Record<string, Record<string, unknown>>).operating_condition.alpha).toEqual({ units: 'degree', value: 0 })
    expect((draftInputs[1].patch as Record<string, Record<string, unknown>>).operating_condition.alpha).toEqual({ units: 'degree', value: 5 })
    expect(result.baselineDraft.id).toBe('draft-1')
  })
})
