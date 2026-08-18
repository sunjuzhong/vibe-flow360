import baselineDocument from '../../../tutorials/T17-initialization-restart/simulation.json'
import targetUniformPatch from '../../../tutorials/T17-initialization-restart/variants/target-uniform.patch.json'
import targetExpressionPatch from '../../../tutorials/T17-initialization-restart/variants/target-expression.patch.json'
import targetRestartPatch from '../../../tutorials/T17-initialization-restart/variants/target-modified-restart.patch.json'
import geometryUrl from '../../../tutorials/T17-initialization-restart/assets/continuation-vane.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export type T17Mode = 'source' | 'uniform' | 'expression' | 'restart'

export const t17Steps: TutorialStep[] = [
  { id: 'decision', label: '01', title: 'Choose the initialization problem', summary: 'Separate a new field, an analytic seed, a same-mesh fork, and cross-mesh interpolation.' },
  { id: 'expressions', label: '02', title: 'Build bounded expression fields', summary: 'Use nondimensional variables and constants without introducing negative density, pressure, or unexplained discontinuities.' },
  { id: 'parent', label: '03', title: 'Qualify the parent Case', summary: 'Require converged physics, recorded provenance, and compatible target changes before reusing a solution.' },
  { id: 'restart', label: '04', title: 'Compose fork and modified restart', summary: 'Keep the parent identity in the workflow and the state transformation in SimulationParams.' },
  { id: 'evidence', label: '05', title: 'Prove acceleration and independence', summary: 'Compare startup bounds, computational work, loads, and fields across independent paths.' },
  { id: 'run', label: '06', title: 'Create three pre-run Drafts', summary: 'Create the source, target cold-start, and target expression-seed Drafts; fork only after the source Case exists.' },
]

export const t17Baseline = baselineDocument as unknown as Record<string, unknown>
export const t17TargetUniformPatch = targetUniformPatch as unknown as Record<string, unknown>
export const t17TargetExpressionPatch = targetExpressionPatch as unknown as Record<string, unknown>
export const t17TargetRestartPatch = targetRestartPatch as unknown as Record<string, unknown>

export const t17ParameterCards = [
  { label: 'Source condition', value: 'M = 0.30 · α = 8°', provenance: 'provided', why: 'Creates the developed parent solution on the shared mesh.' },
  { label: 'Target condition', value: 'M = 0.30 · α = 12°', provenance: 'controlled', why: 'Changes only incidence so initialization paths can be compared.' },
  { label: 'Uniform field', value: 'rho · u · v · w · p', provenance: 'baseline', why: 'Uses target freestream variables throughout the fluid domain.' },
  { label: 'Expression seed', value: '15% smooth wake deficit', provenance: 'evaluated', why: 'Tests a bounded analytic guess near the trailing edge without importing a Case.' },
  { label: 'Modified restart', value: 'Δα = 4° velocity rotation', provenance: 'evaluated', why: 'Transforms velocity from a real parent while retaining its developed density and pressure.' },
  { label: 'Final-state tolerance', value: 'CL/CD within 1%', provenance: 'required', why: 'Rejects a speedup when the accepted target still depends materially on its seed.' },
]

export const t17Evidence = [
  { title: 'The parent Case is identified and accepted', detail: 'Record Case, mesh, solver version, completion state, and the evidence used to trust it.' },
  { title: 'Startup state remains bounded', detail: 'Density and pressure stay positive; velocity and force transients remain physically explainable.' },
  { title: 'Computational work is measured', detail: 'Compare accepted pseudo-steps and wall time rather than judging residual shape alone.' },
  { title: 'Target loads are initialization-independent', detail: 'Final CL and CD agree within 1% after each branch satisfies the same convergence gate.' },
  { title: 'Target fields are initialization-independent', detail: 'Cp and midspan velocity/pressure differences meet the declared spatial tolerance.' },
  { title: 'Interpolation has its own transfer audit', detail: 'For a different mesh, verify overlap, region correspondence, conservation, and local extrema.' },
]

export const t17Pedagogy: TutorialPedagogy = {
  learningObjectives: ['Distinguish expression initialization, modified restart, fork, and interpolation.', 'Write bounded nondimensional initial-condition expressions.', 'Qualify a parent Case before reusing its state.', 'Prove both acceleration and final-state independence.'],
  cfdConcepts: [
    { id: 'memory', title: 'An initial field changes the path, not the target equations', explanation: 'A good seed can reduce startup transients, but the converged target must still satisfy the target boundary conditions and governing equations.', misconception: 'A plausible initial field guarantees the correct final solution.' },
    { id: 'basin', title: 'Multiple initialization paths expose sensitivity', explanation: 'Cold start, analytic seed, and restart should approach the same stable solution when the target problem has one relevant attractor.', misconception: 'The fastest branch is automatically the most accurate branch.' },
    { id: 'transfer', title: 'Mesh interpolation introduces a second approximation', explanation: 'Mapping a developed solution onto new cells can create conservation error and local extrema even when both meshes are individually valid.', misconception: 'Interpolation is a lossless copy.' },
  ],
  flow360Concepts: [
    { id: 'initial', title: 'NavierStokesInitialCondition defines a new field', explanation: 'The expressions use nondimensional rho, velocity, and pressure variables and may depend on x, y, z, constants, and supported functions.', misconception: 'The default rho, u, v, w, and p expressions mean zero flow.' },
    { id: 'modified', title: 'Modified restart transforms an imported parent state', explanation: 'NavierStokesModifiedRestartSolution supplies expressions, while the actual parent Case is selected by the fork workflow.', misconception: 'The SimulationParams patch contains the Case ID.' },
    { id: 'fork', title: 'Fork and interpolation are different workflow choices', explanation: 'A same-mesh fork continues from a parent state. interpolate_to_mesh is added only when transferring that state to another Volume Mesh.', misconception: 'Every fork requires a target mesh.' },
  ],
  derivations: [
    { id: 'angle', parameter: 'Restart velocity rotation', basis: 'The accepted source is 8° and the target is 12°.', calculation: 'Δα = 12° − 8° = 4° = 0.069813 rad', transfer: 'Rotate only when coordinate axes and angle convention match the target setup.' },
    { id: 'rotation', parameter: 'x-z velocity transform', basis: 'Use the parent velocity components u and w.', calculation: "u' = cos(Δα)u − sin(Δα)w; w' = sin(Δα)u + cos(Δα)w", transfer: 'Keep rho and p unchanged only when that assumption is physically defensible.' },
    { id: 'deficit', parameter: 'Expression-seed lower bound', basis: 'The Gaussian multiplier has a maximum deficit of 0.15.', calculation: 'u_seed / u∞ ≥ 1 − 0.15 = 0.85', transfer: 'Derive bounds analytically before submitting any spatial expression.' },
    { id: 'agreement', parameter: 'Load independence gate', basis: 'Use the cold-start converged load as the independent reference.', calculation: '|C_restart − C_cold| / max(|C_cold|, ε) ≤ 0.01', transfer: 'Set tolerance from the engineering decision and numerical uncertainty, not after seeing results.' },
  ],
  experiments: [
    { id: 'choice', prediction: 'The target uses the same mesh and only angle of attack changes after a trusted source Case. Which path should be tested?', options: ['Same-mesh fork with a controlled modified restart', 'Cross-mesh interpolation'], controlledVariable: 'Geometry, mesh, Mach, models, and outputs stay fixed.', observation: 'Compare the fork with an independent 12° cold start before accepting saved work.' },
    { id: 'mesh', prediction: 'A refined target Volume Mesh is introduced. What new evidence is required?', options: ['Overlap, conservation, region correspondence, and post-transfer extrema', 'Only a successful submission status'], controlledVariable: 'Use the same accepted parent Case while changing only the target mesh.', observation: 'Treat transfer error separately from solver convergence on the target mesh.' },
  ],
  failureModes: [
    { id: 'fake-parent', symptom: 'A restart Draft is created before any source Case exists.', cause: 'Schema configuration was confused with workflow provenance.', correction: 'Run and accept the source, then create the fork from its real Case node.' },
    { id: 'bad-parent', symptom: 'The child converges quickly to an incorrect load.', cause: 'The parent solution was incomplete, incompatible, or physically wrong.', correction: 'Audit parent convergence, mesh, models, state bounds, and target delta.' },
    { id: 'expression', symptom: 'The first steps show severe pressure or density excursions.', cause: 'The expression is discontinuous, dimensional, or not analytically bounded.', correction: 'Use nondimensional variables, smooth transitions, and derived min/max bounds.' },
    { id: 'path', symptom: 'Cold start and restart settle at materially different loads.', cause: 'One branch is not converged, the flow is multistable/unsteady, or the target change is too large.', correction: 'Extend and compare histories, reduce the continuation step, and inspect fields.' },
    { id: 'interpolation', symptom: 'Transferred fields contain spikes near boundaries or interfaces.', cause: 'Mesh overlap or physical-region correspondence is insufficient.', correction: 'Inspect transfer coverage and extrema; revise the target mesh or initialize affected regions explicitly.' },
  ],
  evidenceRubric: [
    { id: 'provenance', observation: 'Parent provenance', pass: 'Real parent Case and mesh IDs plus acceptance evidence are recorded.', fail: 'Only a project name or parameter snapshot is available.' },
    { id: 'bounds', observation: 'Startup state', pass: 'rho and p remain positive and all extrema are explained.', fail: 'The branch advances with unexplained clipping or spikes.' },
    { id: 'cost', observation: 'Acceleration', pass: 'Accepted steps or wall time improve under equal convergence criteria.', fail: 'A steeper early residual is the only evidence.' },
    { id: 'loads', observation: 'Final loads', pass: 'CL and CD agree with the independent cold start within 1%.', fail: 'The faster branch retains a material load offset.' },
    { id: 'fields', observation: 'Final fields', pass: 'Cp and midspan field differences meet the declared tolerance.', fail: 'Only integral loads are compared.' },
    { id: 'mapping', observation: 'Cross-mesh transfer', pass: 'Coverage, conservation, region mapping, and extrema pass.', fail: 'Interpolation is accepted because the run started.' },
  ],
  transferQuestions: [
    { prompt: 'Where does the identity of the restart parent belong?', expected: 'In the fork workflow through the selected parent Case; ModifiedRestartSolution only defines how the imported state is transformed.' },
    { prompt: 'What proves that an initialization strategy accelerated rather than biased the result?', expected: 'Lower measured work together with converged load and field agreement against an independent initialization.' },
  ],
}

export function t17Params(mode: T17Mode): Record<string, unknown> {
  if (mode === 'uniform') return mergeTutorialPatch(t17Baseline, t17TargetUniformPatch) as Record<string, unknown>
  if (mode === 'expression') return mergeTutorialPatch(t17Baseline, t17TargetExpressionPatch) as Record<string, unknown>
  if (mode === 'restart') return mergeTutorialPatch(t17Baseline, t17TargetRestartPatch) as Record<string, unknown>
  return t17Baseline
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function quantity(value: unknown): number { return Number(record(value).value) }
function models(params: Record<string, unknown>) { return array(params.models).map(record) }
function draftEntities(params: Record<string, unknown>) { return array(record(record(params.private_attribute_asset_cache).project_entity_info).draft_entities).map(record) }
function storedEntities(value: unknown) { return array(record(value).stored_entities).map(record) }
export function t17ConfiguredPatch(mode: T17Mode): Record<string, unknown> { const params = t17Params(mode); const cache = record(params.private_attribute_asset_cache); return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher, project_entity_info: { draft_entities: draftEntities(params) } } } }
export function validateT17Setup(params: Record<string, unknown>): SetupCheck[] {
  const items = models(params); const fluid = items.find((item) => item.type === 'Fluid') || {}; const initial = record(fluid.initial_condition); const condition = record(params.operating_condition); const alpha = quantity(condition.alpha); const outputs = JSON.stringify(params.outputs); const entities = draftEntities(params); const isRestart = initial.type_name === 'NavierStokesModifiedRestartSolution'; const isExpression = !isRestart && record(initial.constants).wakeDeficit === '0.15'
  return [
    { id: 'condition', label: 'The source or target condition is explicit', detail: 'The source is Mach 0.30 at 8°; every target branch is Mach 0.30 at 12°.', passed: Number(record(condition.private_attribute_input_cache).mach) === 0.3 && [8, 12].includes(alpha) },
    { id: 'type', label: isRestart ? 'Modified restart transformation is selected' : isExpression ? 'Bounded expression initialization is selected' : 'Uniform freestream initialization is selected', detail: isRestart ? 'Velocity rotates by 4° while rho and p preserve the imported parent fields.' : isExpression ? 'A smooth 15% wake deficit is applied without a parent Case.' : 'rho, u, v, w, and p use the operating-condition freestream variables.', passed: isRestart ? record(initial.constants).deltaAlpha === '0.06981317008' && initial.rho === 'rho' && initial.p === 'p' : isExpression ? String(initial.u).includes('wakeDeficit') : ['rho', 'u', 'v', 'w', 'p'].every((key) => initial[key] === key) },
    { id: 'parent', label: 'Restart provenance remains a workflow requirement', detail: 'The restart patch has no fabricated Case ID and must be used only while forking a real accepted parent.', passed: !('case_id' in initial) && !('parent_id' in initial) },
    { id: 'mesh', label: 'The shared vane mesh is fully configured', detail: 'Curvature, wall layers, farfield, and the registered midspan Slice are present.', passed: array(record(params.meshing).refinements).length === 2 && entities.length === 1 && entities[0].private_attribute_entity_type_name === 'Slice' },
    { id: 'boundaries', label: 'The vane and farfield are assigned', detail: 'The vane is a no-slip Wall and the external domain uses AutomatedFarfield.', passed: items.some((item) => item.type === 'Wall' && storedEntities(item.entities).length === 1) && array(record(params.meshing).volume_zones).map(record).some((item) => item.type === 'AutomatedFarfield') },
    { id: 'evidence', label: 'Load and field comparison outputs are configured', detail: 'CL, CD, Cp, velocity, pressure, and vorticity support convergence and final-state comparisons.', passed: ['CL', 'CD', 'Cp', 'velocity_m_per_s', 'pressure_pa', 'vorticityMagnitude'].every((field) => outputs.includes(field)) },
  ]
}
export function t17Progress(completed: string[]): number { const unique = new Set(completed.filter((id) => t17Steps.some((step) => step.id === id))); return Math.round((unique.size / t17Steps.length) * 100) }
function identifier(result: unknown, key: string): string { const value = record(result)[key]; return typeof value === 'string' ? value.trim() : '' }
export async function createT17Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging'); if (!(['source', 'uniform', 'expression', 'restart'] as T17Mode[]).every((mode) => validateT17Setup(t17Params(mode)).every((check) => check.passed))) throw new Error('The bundled T17 parameters contain an invalid initialization, restart transformation, entity, or evidence contract.')
  const response = await fetchAsset(geometryUrl); if (!response.ok) throw new Error('The bundled T17 continuation-vane Geometry could not be loaded.')
  const form = new FormData(); form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T17'); form.append('files', await response.blob(), 'continuation-vane.csm')
  const staged = await client.stageImport(form); const approved = await client.approveImport(staged.id); onStage('creating-project'); const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id'); if (!projectId || !geometryId) throw new Error('Flow360 created the T17 Project without returning its Geometry identifiers.')
  onStage('creating-drafts'); const [sourceDraft, uniformDraft, expressionDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T17 source · 8° uniform start', patch: t17ConfiguredPatch('source') }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T17 target · 12° uniform start', patch: t17ConfiguredPatch('uniform') }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T17 target · 12° expression seed', patch: t17ConfiguredPatch('expression') }),
  ]); onStage('ready'); return { projectId, rootResourceId: geometryId, baselineDraft: sourceDraft, variantDraft: uniformDraft, additionalDrafts: [expressionDraft] }
}
