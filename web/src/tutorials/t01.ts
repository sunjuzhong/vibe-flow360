import baselineDocument from '../../../tutorials/T01-first-lift-drag/simulation.json'
import alphaFivePatch from '../../../tutorials/T01-first-lift-drag/variants/alpha-5deg.patch.json'
import geometryUrl from '../../../tutorials/T01-first-lift-drag/assets/geometry.csm?url'
import type { ConfiguredDraft, ImportPlan } from '../api/client'
import type { TutorialPedagogy } from './pedagogy'

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

export type TutorialEnvironmentStage = 'staging' | 'creating-project' | 'creating-drafts' | 'ready'

export type TutorialEnvironmentClient = {
  stageImport: (form: FormData) => Promise<ImportPlan>
  approveImport: (id: string) => Promise<ImportPlan>
  runImport: (id: string, sync?: boolean) => Promise<ImportPlan>
  createConfiguredDraft: (projectId: string, input: {
    source_id: string
    name: string
    patch: Record<string, unknown>
  }) => Promise<ConfiguredDraft>
}

export type TutorialEnvironmentResult = {
  projectId: string
  rootResourceId: string
  baselineDraft: ConfiguredDraft
  variantDraft?: ConfiguredDraft
}

export const t01Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the question', summary: 'Define the aerodynamic quantities, controlled variable, and required outputs.' },
  { id: 'geometry', label: '02', title: 'Understand the geometry', summary: 'Confirm units and assign physical meaning to surfaces.' },
  { id: 'setup', label: '03', title: 'Review the setup', summary: 'Connect mesh, physics, reference values, and outputs.' },
  { id: 'variant', label: '04', title: 'Try a variant', summary: 'Change only angle of attack and inspect the semantic diff.' },
  { id: 'evidence', label: '05', title: 'Define acceptance evidence', summary: 'Set mesh, convergence, force, and surface-field criteria.' },
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

export const t01Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Explain how pressure and wall shear become lift, drag, and normalized coefficients.',
    'Map the controlled aerodynamic comparison to Flow360 SimulationParams and outputs.',
    'Reject a completed Case when mesh, convergence, forces, or fields provide insufficient evidence.',
  ],
  cfdConcepts: [
    { id: 'forces', title: 'Pressure and shear create aerodynamic force', explanation: 'Pressure acts normal to the aircraft and wall shear tangentially; integrating their components produces dimensional lift and drag.', misconception: 'Validate integrated force with residual and force histories plus mesh and surface-field checks.' },
    { id: 'coefficients', title: 'Coefficients normalize the comparison', explanation: 'CL and CD divide forces by dynamic pressure and reference area, while angle of attack changes flow direction relative to the aircraft.', misconception: 'Lift does not increase indefinitely with alpha because separation and stall can make the response nonlinear.' },
  ],
  flow360Concepts: [
    { id: 'condition', title: 'AerospaceCondition defines the freestream', explanation: 'Velocity, alpha, beta, thermal state, and reference frame form the operating condition used by models and boundaries.', misconception: 'Rotating a visual icon does not change Flow360 unless operating_condition.alpha changes in SimulationParams.' },
    { id: 'outputs', title: 'Outputs make evidence observable', explanation: 'ForceOutput and SurfaceOutput request integrated forces and Cp, Cf, yPlus, and CfVec for post-run review.', misconception: 'Requesting an output makes evidence available after a run; it does not prove convergence or correctness.' },
  ],
  derivations: [
    { id: 'coeff', parameter: 'Aerodynamic coefficient normalization', basis: 'Forces become comparable after division by dynamic pressure and reference area.', calculation: 'q = ½ρV² · CL = L/(qSref) · CD = D/(qSref)', transfer: 'Recalculate q and verify Sref whenever velocity, density, scale, or convention changes.' },
    { id: 'reference', parameter: 'Reference area and moment length', basis: 'The bundled aircraft uses 24 m² area and 2.4 m length for coefficient normalization.', calculation: 'Sref = 24 m² · Lref = 2.4 m', transfer: 'Use and document the same reference convention before comparing another design.' },
    { id: 'layer', parameter: 'First-layer baseline assumption versus y-plus', basis: 'The 1 mm baseline is an explicit assumption; this flow condition does not determine it.', calculation: 'production t₁ needs target y+, ρ, μ, V, and a wall-shear estimate', transfer: 'Derive t₁ for the operating point and verify actual yPlus after solving.' },
  ],
  experiments: [{ id: 'alpha', prediction: 'What is the most defensible expectation when only alpha changes from 0° to 5°?', options: ['Lift should increase and drag may also increase', 'Lift and drag must both remain unchanged'], controlledVariable: 'Only AerospaceCondition alpha changes; mesh, models, references, numerics, and outputs remain identical.', observation: 'Compare stable CL/CD histories, Cp patterns, separation indicators, and convergence—not one final force sample.' }],
  failureModes: [
    { id: 'reference', symptom: 'Coefficients look implausible while dimensional forces seem consistent.', cause: 'Reference area, length, units, or convention is wrong.', correction: 'Verify dimensional forces, geometry units, Sref, Lref, and convention before changing physics.' },
    { id: 'convergence', symptom: 'Residuals decrease while CL or CD still drift.', cause: 'The iterative solution is not force-stable or the flow is genuinely unsteady.', correction: 'Inspect histories, extend or revise the solve, and reconsider steady versus unsteady modeling.' },
    { id: 'mesh', symptom: 'Forces change materially after local mesh refinement.', cause: 'Force-producing curvature, layers, wakes, or pressure gradients were under-resolved.', correction: 'Run a controlled mesh-sensitivity comparison and require the conclusion to stabilize.' },
  ],
  evidenceRubric: [
    { id: 'mesh', observation: 'Mesh suitability', pass: 'Geometry, layers, wakes, transitions, and quality have no unresolved critical defect.', fail: 'A defect affects a force-producing region or wake.' },
    { id: 'convergence', observation: 'Residual and force convergence', pass: 'Residuals reduce substantially and CL/CD stay within tolerance over the review window.', fail: 'Forces drift, residuals remain problematic, or the signals contradict.' },
    { id: 'fields', observation: 'Surface-field sanity', pass: 'Cp, Cf, yPlus, and CfVec are coherent and explain the force trend.', fail: 'Fields are missing, discontinuous, or inconsistent with forces.' },
    { id: 'controlled', observation: 'Controlled alpha comparison', pass: 'Only alpha changes and both Cases use the same evidence window.', fail: 'Other setup or review differences confound the comparison.' },
  ],
  transferQuestions: [
    { prompt: 'If velocity doubles while CL stays similar, how should dimensional lift scale?', expected: 'Dynamic pressure scales with V², so lift is approximately four times larger at unchanged density and area.' },
    { prompt: 'Why does the 5° result not prove linear behavior up to 15°?', expected: 'Separation and stall are nonlinear and require additional controlled angles plus suitable steady or unsteady evidence.' },
  ],
}

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

  onStage('creating-drafts')
  const shared = {
    source_id: geometryId,
  }
  const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, {
      ...shared,
      name: 'T01 baseline · α 0°',
      patch: t01ParamsForAlpha(0),
    }),
    client.createConfiguredDraft(projectId, {
      ...shared,
      name: 'T01 variant · α 5°',
      patch: t01ParamsForAlpha(5),
    }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
