import baselineDocument from '../../../tutorials/T01-first-lift-drag/simulation.json'
import alphaFivePatch from '../../../tutorials/T01-first-lift-drag/variants/alpha-5deg.patch.json'
import geometryUrl from '../../../tutorials/T01-first-lift-drag/assets/geometry.csm?url'
import type { ImportPlan, SimulationPlan } from '../api/client'

export type TutorialStep = {
  id: string
  label: string
  title: string
  summary: string
}

export type SetupCheck = {
  id: string
  label: string
  detail: string
  passed: boolean
}

export type TutorialEnvironmentStage = 'staging' | 'creating-project' | 'creating-plans' | 'ready'

export type TutorialEnvironmentClient = {
  stageImport: (form: FormData) => Promise<ImportPlan>
  approveImport: (id: string) => Promise<ImportPlan>
  runImport: (id: string, sync?: boolean) => Promise<ImportPlan>
  createPlan: (input: {
    project_id: string
    project_name: string
    source_id: string
    source_type: string
    source_name: string
    target: string
    name: string
    intent: string
    patch: Record<string, unknown>
  }) => Promise<SimulationPlan>
}

export type TutorialEnvironmentResult = {
  projectId: string
  geometryId: string
  baselinePlan: SimulationPlan
  variantPlan: SimulationPlan
}

export const t01Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the question', summary: 'Start from the engineering decision, not the solver.' },
  { id: 'geometry', label: '02', title: 'Understand the geometry', summary: 'Confirm units and assign physical meaning to surfaces.' },
  { id: 'setup', label: '03', title: 'Review the setup', summary: 'Connect mesh, physics, reference values, and outputs.' },
  { id: 'variant', label: '04', title: 'Try a variant', summary: 'Change only angle of attack and inspect the semantic diff.' },
  { id: 'evidence', label: '05', title: 'Define trustworthy evidence', summary: 'Separate a completed run from a credible result.' },
  { id: 'run', label: '06', title: 'Continue to Flow360', summary: 'Review the paid boundary before creating a cloud run.' },
]

export const t01Baseline = baselineDocument as unknown as Record<string, unknown>
export const t01AlphaFivePatch = alphaFivePatch as unknown as Record<string, unknown>

export const t01ParameterCards = [
  { label: 'Velocity', value: '100 m/s', provenance: 'provided', why: 'Defines the flight condition and dynamic pressure.' },
  { label: 'Angle of attack', value: '0° baseline · 5° variant', provenance: 'provided', why: 'The single controlled difference between the two cases.' },
  { label: 'Reference area', value: '24 m²', provenance: 'derived', why: 'Normalizes force into CL and CD; a wrong value makes coefficients misleading.' },
  { label: 'Reference length', value: '2.4 m', provenance: 'derived', why: 'Defines the moment normalization used for aerodynamic reporting.' },
  { label: 'Farfield size', value: '50 geometry lengths', provenance: 'inferred', why: 'Keeps the outer boundary away from the aircraft disturbance.' },
  { label: 'First layer', value: '1 mm', provenance: 'inferred', why: 'Makes the wall-normal mesh assumption explicit for y+ review.' },
]

export const t01Evidence = [
  { title: 'Mesh reviewed', detail: 'No open boundaries, missing layers, or unacceptable local quality.' },
  { title: 'Residual reduction', detail: 'Primary residuals fall by at least three orders of magnitude.' },
  { title: 'Force stability', detail: 'CL and CD change by less than 1% over the final 200 pseudo-steps.' },
  { title: 'Surface fields', detail: 'Cp, Cf, yPlus, and CfVec are present and reviewable.' },
]

export function mergeTutorialPatch(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const base = target && typeof target === 'object' && !Array.isArray(target)
    ? { ...(target as Record<string, unknown>) }
    : {}
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete base[key]
    else base[key] = mergeTutorialPatch(base[key], value)
  }
  return base
}

export function t01ParamsForAlpha(alpha: 0 | 5): Record<string, unknown> {
  if (alpha === 0) return t01Baseline
  return mergeTutorialPatch(t01Baseline, t01AlphaFivePatch) as Record<string, unknown>
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function validateT01Setup(params: Record<string, unknown>): SetupCheck[] {
  const units = record(params.unit_system)
  const condition = record(params.operating_condition)
  const alpha = record(condition.alpha)
  const meshing = record(params.meshing)
  const models = Array.isArray(params.models) ? params.models.map(record) : []
  const outputs = Array.isArray(params.outputs) ? params.outputs.map(record) : []
  const outputFields = outputs.flatMap((output) => {
    const fields = record(output.output_fields)
    return Array.isArray(fields.items) ? fields.items : []
  })

  return [
    {
      id: 'version',
      label: 'Pinned Flow360 schema',
      detail: `SimulationParams ${String(params.version || 'missing')} · tutorial package 25.10.3`,
      passed: String(params.version || '').startsWith('25.10.'),
    },
    {
      id: 'units',
      label: 'Explicit SI units',
      detail: 'Geometry and reference quantities are interpreted in metres.',
      passed: units.name === 'SI',
    },
    {
      id: 'condition',
      label: 'Flight condition is complete',
      detail: `100 m/s · α ${String(alpha.value)}° · β 0°`,
      passed: record(condition.velocity_magnitude).value === 100 && (alpha.value === 0 || alpha.value === 5),
    },
    {
      id: 'mesh',
      label: 'Meshing intent is explicit',
      detail: 'Automated farfield and visible surface/boundary-layer defaults.',
      passed: Array.isArray(meshing.volume_zones) && meshing.volume_zones.length > 0,
    },
    {
      id: 'physics',
      label: 'Boundary semantics are assigned',
      detail: 'Fluid, aircraft Wall, and Freestream models are all present.',
      passed: ['Fluid', 'Wall', 'Freestream'].every((type) => models.some((model) => model.type === type)),
    },
    {
      id: 'outputs',
      label: 'Decision outputs are requested',
      detail: 'CL, CD, Cp, Cf, yPlus, and CfVec are included.',
      passed: ['CL', 'CD', 'Cp', 'Cf', 'yPlus', 'CfVec'].every((field) => outputFields.includes(field)),
    },
  ]
}

export function tutorialProgress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t01Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t01Steps.length) * 100)
}

function resultIdentifier(result: unknown, key: string): string {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return ''
  const value = (result as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT01Environment(
  input: { folderId: string; projectName: string },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void = () => undefined,
  fetchAsset: typeof fetch = fetch,
): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  const response = await fetchAsset(geometryUrl)
  if (!response.ok) throw new Error('The bundled T01 geometry could not be loaded.')
  const form = new FormData()
  form.set('name', input.projectName)
  form.set('source_type', 'geometry')
  form.set('unit', 'm')
  form.set('workflow', 'standard')
  form.set('solver_version', 'release-25.10')
  form.set('folder_id', input.folderId)
  form.set('tags', 'tutorial,T01')
  form.append('files', await response.blob(), 'geometry.csm')

  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = resultIdentifier(submitted.result, 'project_id')
  const geometryId = resultIdentifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the tutorial Project without returning its Geometry identifiers.')

  onStage('creating-plans')
  const shared = {
    project_id: projectId,
    project_name: input.projectName,
    source_id: geometryId,
    source_type: 'Geometry',
    source_name: 'T01 Airplane Geometry',
    target: 'case',
  }
  const [baselinePlan, variantPlan] = await Promise.all([
    client.createPlan({
      ...shared,
      name: 'T01 baseline · α 0°',
      intent: 'Create the reviewed T01 baseline Case at zero degrees angle of attack.',
      patch: t01ParamsForAlpha(0),
    }),
    client.createPlan({
      ...shared,
      name: 'T01 variant · α 5°',
      intent: 'Create the controlled T01 Case variant at five degrees angle of attack.',
      patch: t01ParamsForAlpha(5),
    }),
  ])
  onStage('ready')
  return { projectId, geometryId, baselinePlan, variantPlan }
}
