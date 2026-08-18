import baselineDocument from '../../../tutorials/T16-numerical-diagnostics/simulation.json'
import accuracyPatch from '../../../tutorials/T16-numerical-diagnostics/variants/accuracy.patch.json'
import krylovPatch from '../../../tutorials/T16-numerical-diagnostics/variants/krylov-slau2.patch.json'
import geometryUrl from '../../../tutorials/T16-numerical-diagnostics/assets/loaded-vane.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export type T16Mode = 'recovery' | 'accuracy' | 'krylov'
export const t16Steps: TutorialStep[] = [
  { id: 'symptom', label: '01', title: 'Classify the failure signature', summary: 'Separate nonlinear instability, poor linear reduction, stalled convergence, and a converged but untrustworthy answer.' },
  { id: 'evidence', label: '02', title: 'Locate the first failing evidence', summary: 'Read residual, CFL, force, state-bound, and maximum-residual-location histories together.' },
  { id: 'controls', label: '03', title: 'Map symptoms to numerical controls', summary: 'Connect flux, order, MUSCL, dissipation, linear solver, line search, and evaluation frequency to their actual roles.' },
  { id: 'ladder', label: '04', title: 'Follow the staged recovery ladder', summary: 'Recover bounded behavior, restore second order, then evaluate a compatible Krylov/SLAU2 branch separately.' },
  { id: 'acceptance', label: '05', title: 'Apply rollback and acceptance gates', summary: 'Require second-order load stability, mesh credibility, and solver-efficiency evidence before accepting a branch.' },
  { id: 'run', label: '06', title: 'Create three configured Case Drafts', summary: 'Create the supplied loaded-vane Project and synchronize recovery, accuracy, and Krylov/SLAU2 Drafts.' },
]
export const t16Baseline = baselineDocument as unknown as Record<string, unknown>
export const t16AccuracyPatch = accuracyPatch as unknown as Record<string, unknown>
export const t16KrylovPatch = krylovPatch as unknown as Record<string, unknown>
export const t16ParameterCards = [
  { label: 'Shared physical problem', value: 'M = 0.30 · α = 12°', provenance: 'provided', why: 'Keeps geometry, operating condition, turbulence model, mesh, and outputs fixed across numerical stages.' },
  { label: 'Recovery stage', value: 'Roe · 1st order · CFL × 0.25', provenance: 'diagnostic', why: 'Seeks a bounded trajectory and a useful failure location; it is not the final load configuration.' },
  { label: 'Accuracy stage', value: 'Roe · 2nd order · κ = −1', provenance: 'required', why: 'Restores stable second-order upwind reconstruction before loads are used.' },
  { label: 'Krylov stage', value: '15 × 25 · rtol = 0.05', provenance: 'evaluated', why: 'Tests steady nonlinear work using 15 Krylov iterations and 25 preconditioner sweeps.' },
  { label: 'Line search', value: '0.85 · 1.10 · step 100', provenance: 'evaluated', why: 'Rejects excessive nonlinear growth and couples accepted steps to adaptive CFL behavior.' },
  { label: 'SLAU2 branch', value: 'interior SLAU2 · Roe Jacobian', provenance: 'evaluated', why: 'Separates the interior residual flux from the implicit Jacobian choice; boundary fluxes remain Roe.' },
]
export const t16Evidence = [
  { title: 'The failure is classified before tuning', detail: 'Name the first failing history and its location; do not infer cause from one residual trace.' },
  { title: 'The recovery stage remains diagnostic', detail: 'Bounded states and interpretable histories are required, but first-order loads are not final evidence.' },
  { title: 'Second-order accuracy is restored', detail: 'Cp, CL, and CD remain stable after returning to second order and pass mesh sensitivity.' },
  { title: 'The linear solve performs useful work', detail: 'Review linear reduction per pseudo-step before increasing iterations or changing the nonlinear method.' },
  { title: 'Krylov compatibility is explicit', detail: 'The case is steady, velocity and pressure-density limiters are off, and line-search events are reviewed.' },
  { title: 'Accuracy and efficiency are judged separately', detail: 'Reference evidence supports loads; wall time and accepted-step behavior support solver efficiency.' },
]
export const t16Pedagogy: TutorialPedagogy = {
  learningObjectives: ['Classify solver symptoms before changing controls.', 'Explain the role of Roe/SLAU2, spatial order, MUSCL, and dissipation.', 'Restore second-order accuracy after conservative recovery.', 'Apply Krylov and line search only under compatible steady conditions.'],
  cfdConcepts: [
    { id: 'nonlinear', title: 'Residual growth is a symptom, not a diagnosis', explanation: 'A nonlinear spike can begin at a bad cell, a boundary inconsistency, a physical transient, or an over-aggressive update.', misconception: 'The Riemann solver is wrong whenever continuity rises.' },
    { id: 'order', title: 'First order trades resolution for robustness', explanation: 'A more diffusive reconstruction may establish bounded flow and expose the failure location, but it changes gradients and loads.', misconception: 'A low first-order residual proves the engineering answer.' },
    { id: 'linear', title: 'Linear and nonlinear convergence answer different questions', explanation: 'Linear reduction measures each implicit solve; nonlinear histories measure progress between pseudo-steps.', misconception: 'More linear iterations always fix nonlinear instability.' },
  ],
  flow360Concepts: [
    { id: 'flux', title: 'Roe and SLAU2 control interior inviscid fluxes', explanation: 'Roe is the general starting point. SLAU2 is an alternative interior flux; Flow360 still uses Roe on boundary fluxes.', misconception: 'Selecting SLAU2 replaces every boundary flux.' },
    { id: 'krylov', title: 'Krylov is a steady-only linear solver branch', explanation: 'Its preconditioner, relative tolerance, adaptive CFL behavior, and line search form one coupled convergence strategy.', misconception: 'Krylov is a drop-in option for unsteady runs or limiter-enabled cases.' },
    { id: 'frequency', title: 'Equation and Jacobian frequencies trade update cost for freshness', explanation: 'Less frequent updates can save work only when the stale system still produces accepted progress.', misconception: 'Larger frequency values always accelerate a case.' },
  ],
  derivations: [
    { id: 'velocity', parameter: 'Freestream speed', basis: 'Use M = 0.30 and a ≈ 340.3 m/s at 288.15 K.', calculation: 'U = Ma ≈ 102.1 m/s', transfer: 'Recompute from the actual thermal state rather than assuming one sound speed.' },
    { id: 're', parameter: 'Chord Reynolds number', basis: 'Use ρ = 1.225 kg/m³, U = 102.1 m/s, c = 1.0 m, and μ ≈ 1.789×10⁻⁵ Pa·s.', calculation: 'Re_c ≈ 6.99 × 10⁶', transfer: 'Use this scale when checking boundary-layer resolution and reference similarity.' },
    { id: 'work', parameter: 'Krylov preconditioner budget', basis: 'Use 15 Krylov iterations with at most 25 preconditioner sweeps each.', calculation: 'Nominal ceiling = 15 × 25 = 375 sweeps per pseudo-step', transfer: 'Compare actual residual reduction and wall time; the ceiling is not a performance guarantee.' },
    { id: 'growth', parameter: 'Line-search hard cap', basis: 'The configured maximum residual-growth ratio is 1.10 after activation step 100.', calculation: 'One accepted step may grow the monitored norm by at most 10%', transfer: 'Repeated cutbacks indicate that the underlying step or model still needs diagnosis.' },
  ],
  experiments: [
    { id: 'linear', prediction: 'The nonlinear residual decreases smoothly, but each linear solve barely reduces its residual. What should be inspected first?', options: ['Linear reduction, preconditioner work, and iteration budget', 'Switch immediately from Roe to SLAU2'], controlledVariable: 'Flux, order, CFL, mesh, and physics remain unchanged while linear-solver evidence is reviewed.', observation: 'Increase linear work only if the extra reduction improves nonlinear progress per wall time.' },
    { id: 'order', prediction: 'The case is bounded at first order but spikes immediately after second order is restored. What is the next action?', options: ['Locate the first failing cell and inspect mesh, boundaries, and reconstruction evidence', 'Accept the first-order CL as the final answer'], controlledVariable: 'The recovery and accuracy Drafts differ only in declared numerical-stage settings.', observation: 'Use state bounds and maximum-residual location to find the cause before adding arbitrary damping.' },
  ],
  failureModes: [
    { id: 'single-trace', symptom: 'A solver setting is changed after viewing only continuity residual.', cause: 'The failure channel and location were not classified.', correction: 'Correlate nonlinear, linear, CFL, force, state-bound, and maximum-residual evidence.' },
    { id: 'first-order', symptom: 'Loads are reported from the recovery Draft.', cause: 'Robustness was confused with discretization accuracy.', correction: 'Restore second order and repeat mesh and load-stability gates.' },
    { id: 'dissipation', symptom: 'Dissipation is reduced until the field looks sharper.', cause: 'No controlled sensitivity or validation criterion was defined.', correction: 'Keep one variable at a time and compare stable observables with reference evidence.' },
    { id: 'krylov-rules', symptom: 'Krylov validation fails or convergence behaves erratically.', cause: 'The run is unsteady or a velocity/pressure-density limiter is active.', correction: 'Use the standard linear solver or remove the incompatible choice only when physically justified.' },
    { id: 'line-search', symptom: 'Line search repeatedly cuts steps and CFL cannot grow.', cause: 'The nonlinear update remains too aggressive or the underlying setup is defective.', correction: 'Return to the accuracy Draft and inspect the first rejected-step location and state.' },
  ],
  evidenceRubric: [
    { id: 'diagnosis', observation: 'Failure classification', pass: 'The first failing channel, step, and location are recorded.', fail: 'A setting is changed from residual shape alone.' },
    { id: 'recovery', observation: 'Bounded diagnostic recovery', pass: 'States remain physical and histories become interpretable.', fail: 'First-order convergence is treated as final accuracy.' },
    { id: 'accuracy', observation: 'Second-order restoration', pass: 'Cp and forces stabilize and pass mesh sensitivity.', fail: 'Loads shift materially or depend on recovery settings.' },
    { id: 'linear', observation: 'Linear work efficiency', pass: 'Additional linear work improves nonlinear progress per wall time.', fail: 'Iteration counts increase without useful reduction.' },
    { id: 'krylov', observation: 'Krylov/SLAU2 branch', pass: 'Compatibility, accepted steps, line search, and load agreement pass.', fail: 'Speed alone is called success.' },
    { id: 'validation', observation: 'Engineering validation', pass: 'Second-order pressure or load evidence agrees with a relevant reference.', fail: 'Agreement among Drafts is called validation.' },
  ],
  transferQuestions: [
    { prompt: 'Why can a smooth residual history still be untrustworthy?', expected: 'It can be smooth under excessive dissipation, first-order reconstruction, poor mesh resolution, or an incorrect physical setup; stable loads and external evidence are still required.' },
    { prompt: 'Which evidence distinguishes poor linear reduction from nonlinear instability?', expected: 'Compare the within-step linear residual reduction with between-step nonlinear residual, CFL acceptance, and state histories.' },
  ],
}

export function t16Params(mode: T16Mode): Record<string, unknown> { if (mode === 'accuracy') return mergeTutorialPatch(t16Baseline, t16AccuracyPatch) as Record<string, unknown>; if (mode === 'krylov') return mergeTutorialPatch(t16Baseline, t16KrylovPatch) as Record<string, unknown>; return t16Baseline }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function quantity(value: unknown): number { return Number(record(value).value) }
function models(params: Record<string, unknown>) { return array(params.models).map(record) }
function draftEntities(params: Record<string, unknown>) { return array(record(record(params.private_attribute_asset_cache).project_entity_info).draft_entities).map(record) }
function storedEntities(value: unknown) { return array(record(value).stored_entities).map(record) }
export function t16ConfiguredPatch(mode: T16Mode): Record<string, unknown> { const params = t16Params(mode); const cache = record(params.private_attribute_asset_cache); return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher, project_entity_info: { draft_entities: draftEntities(params) } } } }
export function validateT16Setup(params: Record<string, unknown>): SetupCheck[] {
  const items = models(params); const fluid = items.find((item) => item.type === 'Fluid') || {}; const solver = record(fluid.navier_stokes_solver); const flux = record(solver.riemann_solver); const linear = record(solver.linear_solver); const search = record(solver.line_search); const condition = record(params.operating_condition); const mesh = record(params.meshing); const refs = array(mesh.refinements).map(record); const outputs = JSON.stringify(params.outputs); const mode: T16Mode = linear.type_name === 'KrylovLinearSolver' ? 'krylov' : solver.order_of_accuracy === 2 ? 'accuracy' : 'recovery'
  return [
    { id: 'state', label: 'The physical problem is shared', detail: 'All Drafts use Mach 0.30, 12° incidence, a 1.0 m chord, and 0.25 m² reference area.', passed: Number(record(condition.private_attribute_input_cache).mach) === 0.3 && quantity(condition.alpha) === 12 && quantity(record(params.reference_geometry).area) === 0.25 },
    { id: 'stage', label: mode === 'recovery' ? 'Conservative recovery is selected' : mode === 'accuracy' ? 'Second-order accuracy is restored' : 'Steady Krylov/SLAU2 evaluation is selected', detail: mode === 'recovery' ? 'Roe, first order, and CFL × 0.25 provide a diagnostic starting point.' : mode === 'accuracy' ? 'Roe and second-order upwind reconstruction restore the reporting configuration.' : 'SLAU2 interior flux, Roe Jacobian, Krylov, and line search are explicit.', passed: mode === 'recovery' ? flux.type_name === 'Roe' && solver.order_of_accuracy === 1 && solver.CFL_multiplier === 0.25 : mode === 'accuracy' ? flux.type_name === 'Roe' && solver.order_of_accuracy === 2 && solver.kappa_MUSCL === -1 : flux.type_name === 'SLAU2' && flux.jacobian === 'Roe' && linear.max_iterations === 15 && linear.max_preconditioner_iterations === 25 && search.activation_step === 100 },
    { id: 'compatibility', label: 'The linear-solver compatibility rules pass', detail: 'Krylov is steady-only and requires both state limiters to remain disabled.', passed: record(params.time_stepping).type_name === 'Steady' && (mode !== 'krylov' || (solver.limit_velocity === false && solver.limit_pressure_density === false)) },
    { id: 'mesh', label: 'Wall and adverse-gradient controls are registered', detail: 'The shared mesh includes wall layers, a local wake Box, and a midspan Slice.', passed: refs.some((item) => item.refinement_type === 'BoundaryLayer') && refs.some((item) => item.refinement_type === 'UniformRefinement') && draftEntities(params).length === 2 },
    { id: 'boundaries', label: 'The vane and farfield are assigned', detail: 'The vane is a no-slip Wall and the external domain uses AutomatedFarfield.', passed: items.some((item) => item.type === 'Wall' && storedEntities(item.entities).length === 1) && array(mesh.volume_zones).map(record).some((item) => item.type === 'AutomatedFarfield') },
    { id: 'observables', label: 'Loads and local-state outputs are configured', detail: 'Cp, Cf, yPlus, Mach, velocity, pressure, CL, and CD are available beside standard convergence histories.', passed: ['Cp', 'Cf', 'yPlus', 'Mach', 'velocity_m_per_s', 'pressure_pa', 'CL', 'CD'].every((field) => outputs.includes(field)) },
  ]
}
export function t16Progress(completed: string[]): number { const unique = new Set(completed.filter((id) => t16Steps.some((step) => step.id === id))); return Math.round((unique.size / t16Steps.length) * 100) }
function identifier(result: unknown, key: string): string { const value = record(result)[key]; return typeof value === 'string' ? value.trim() : '' }
export async function createT16Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging'); if (!(['recovery', 'accuracy', 'krylov'] as T16Mode[]).every((mode) => validateT16Setup(t16Params(mode)).every((check) => check.passed))) throw new Error('The bundled T16 parameters contain an invalid numerical stage, compatibility rule, entity, or evidence contract.')
  const response = await fetchAsset(geometryUrl); if (!response.ok) throw new Error('The bundled T16 loaded-vane Geometry could not be loaded.')
  const form = new FormData(); form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T16'); form.append('files', await response.blob(), 'loaded-vane.csm')
  const staged = await client.stageImport(form); const approved = await client.approveImport(staged.id); onStage('creating-project'); const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id'); if (!projectId || !geometryId) throw new Error('Flow360 created the T16 Project without returning its Geometry identifiers.')
  onStage('creating-drafts'); const [baselineDraft, variantDraft, krylovDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T16 stage 1 · conservative recovery', patch: t16ConfiguredPatch('recovery') }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T16 stage 2 · restored second order', patch: t16ConfiguredPatch('accuracy') }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T16 stage 3 · steady Krylov and SLAU2', patch: t16ConfiguredPatch('krylov') }),
  ]); onStage('ready'); return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft, additionalDrafts: [krylovDraft] }
}
