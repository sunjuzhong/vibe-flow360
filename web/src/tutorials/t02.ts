import caseTemplate from '../../../tutorials/T02-project-entry-paths/simulation.json'
import surfaceMeshing from '../../../tutorials/T02-project-entry-paths/variants/surface-mesh-entry.patch.json'
import type { SimulationPlan } from '../api/client'
import { mergeTutorialPatch, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'

export type T02Entry = 'surface-mesh' | 'volume-mesh'

export const t02Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Choose the entry point', summary: 'Start from the earliest artifact you still need to change.' },
  { id: 'tree', label: '02', title: 'Read the resource tree', summary: 'See which upstream stages disappear for each root type.' },
  { id: 'stages', label: '03', title: 'Compare required stages', summary: 'Separate skipped work from work that is already trusted.' },
  { id: 'validation', label: '04', title: 'Understand validation context', summary: 'Learn why the same parameters validate differently by root.' },
  { id: 'decision', label: '05', title: 'Select a reusable path', summary: 'Balance iteration freedom, cost, and provenance.' },
  { id: 'run', label: '06', title: 'Create the Web environment', summary: 'Upload a mesh and create two reviewable Case Plans.' },
]

export const t02Paths = {
  geometry: { root: 'Geometry', required: ['SurfaceMesh', 'VolumeMesh', 'Case'], skipped: [], best: 'CAD or boundary semantics may still change.' },
  'surface-mesh': { root: 'SurfaceMesh', required: ['VolumeMesh', 'Case'], skipped: ['Geometry', 'Surface meshing'], best: 'Surface discretization is trusted; volume resolution is still open.' },
  'volume-mesh': { root: 'VolumeMesh', required: ['Case'], skipped: ['Geometry', 'Surface meshing', 'Volume meshing'], best: 'The complete mesh is approved and only physics should vary.' },
} as const

export function t02Progress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t02Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t02Steps.length) * 100)
}

export function t02PlanParams(entry: T02Entry, alpha: 0 | 5): Record<string, unknown> {
  const baseline = { ...(caseTemplate as unknown as Record<string, unknown>) }
  delete baseline.meshing
  const patch = alpha === 5 ? { operating_condition: { alpha: { value: 5, units: 'degree' }, private_attribute_input_cache: { alpha: { value: 5, units: 'degree' } } } } : {}
  const withAlpha = mergeTutorialPatch(baseline, patch) as Record<string, unknown>
  return entry === 'surface-mesh'
    ? mergeTutorialPatch(withAlpha, surfaceMeshing) as Record<string, unknown>
    : withAlpha
}

function identifier(result: unknown, key: string): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ''
  const value = (result as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT02Environment(
  input: { folderId: string; projectName: string; entry: T02Entry; file: File },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void = () => undefined,
): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  const form = new FormData()
  form.set('name', input.projectName)
  form.set('source_type', input.entry)
  form.set('unit', 'm')
  form.set('workflow', 'standard')
  form.set('solver_version', 'release-25.10')
  form.set('folder_id', input.folderId)
  form.set('tags', 'tutorial,T02')
  form.append('files', input.file, input.file.name)
  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id')
  const rootId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !rootId) throw new Error('Flow360 created the Project without returning its mesh identifiers.')

  onStage('creating-plans')
  const sourceType = input.entry === 'surface-mesh' ? 'SurfaceMesh' : 'VolumeMesh'
  const shared = { project_id: projectId, project_name: input.projectName, source_id: rootId, source_type: sourceType, source_name: `T02 ${sourceType}`, target: 'case' }
  const plans: SimulationPlan[] = await Promise.all([
    client.createPlan({ ...shared, name: 'T02 baseline · α 0°', intent: 'Review the direct Case path from the uploaded mesh at zero degrees.', patch: t02PlanParams(input.entry, 0) }),
    client.createPlan({ ...shared, name: 'T02 variant · α 5°', intent: 'Review the same mesh path with only angle of attack changed.', patch: t02PlanParams(input.entry, 5) }),
  ])
  onStage('ready')
  return { projectId, geometryId: rootId, baselinePlan: plans[0], variantPlan: plans[1] }
}
