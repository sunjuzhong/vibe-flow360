import baselineDocument from '../../../tutorials/T15-transition-des/simulation.json'
import transitionPatch from '../../../tutorials/T15-transition-des/variants/transition.patch.json'
import ddesPatch from '../../../tutorials/T15-transition-des/variants/ddes.patch.json'
import geometryUrl from '../../../tutorials/T15-transition-des/assets/high-lift-wing.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export type T15Mode = 'rans' | 'transition' | 'ddes'
export const t15Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Diagnose the missing physics', summary: 'Separate uncertainty in transition onset from uncertainty in unsteady separated structures.' },
  { id: 'models', label: '02', title: 'Map each question to Flow360', summary: 'Locate AFT beside SST and DDES inside the SST hybrid-model field.' },
  { id: 'scales', label: '03', title: 'Derive spatial and temporal scales', summary: 'Calculate Reynolds number, convective time, transition input, and DDES time-step ratio.' },
  { id: 'branches', label: '04', title: 'Compare three model branches', summary: 'Inspect fully turbulent RANS, transition RANS, and unsteady SST-DDES without treating them as one fidelity slider.' },
  { id: 'evidence', label: '05', title: 'Apply branch-specific evidence gates', summary: 'Review onset evidence for transition and grid-time-statistics evidence for DDES.' },
  { id: 'run', label: '06', title: 'Create three configured Case Drafts', summary: 'Create the supplied high-lift Project and synchronize RANS, transition, and DDES setups.' },
]
export const t15Baseline = baselineDocument as unknown as Record<string, unknown>
export const t15TransitionPatch = transitionPatch as unknown as Record<string, unknown>
export const t15DdesPatch = ddesPatch as unknown as Record<string, unknown>
export const t15ParameterCards = [
  { label: 'Reference chord and span', value: 'c = 1.0 m · b = 0.30 m', provenance: 'provided', why: 'Define the Reynolds scale and a finite span for three-dimensional separated structures.' },
  { label: 'Wind-tunnel condition', value: '50 m/s · α = 16°', provenance: 'provided', why: 'Places the deployed three-element wing near a separation-sensitive high-lift condition.' },
  { label: 'Facility disturbance', value: 'Tu = 0.10% · Ncrit ≈ 8.15', provenance: 'derived', why: 'Initializes the AFT transition branch from one defensible disturbance input.' },
  { label: 'Wall first layer', value: '15 μm', provenance: 'adapted', why: 'Starts a wall-resolved mesh that must still be checked through yPlus.' },
  { label: 'Separated-zone spacing', value: '0.015625 m', provenance: 'adapted', why: 'Provides about 19 cells across the tutorial span before a required spanwise sensitivity study.' },
  { label: 'DDES sampling budget', value: 'Δt = 0.0002 s · 50 tc', provenance: 'derived', why: 'Uses 100 steps per convective time and 5000 total steps as a sensitivity-study starting point.' },
]
export const t15Evidence = [
  { title: 'The missing-physics diagnosis is explicit', detail: 'Select transition only for onset uncertainty and DDES only for unresolved unsteady separation.' },
  { title: 'The shared physical basis is traceable', detail: 'Geometry, state, incidence, references, wall mesh, separated zone, and observables are common.' },
  { title: 'Transition onset has facility and field evidence', detail: 'Connect the 0.10% disturbance input and Ncrit conversion to solutionTransition, Cf, Cp, CL, and CD.' },
  { title: 'DDES has a hybrid-grid evidence chain', detail: 'Review shielding, wall distance, spanwise extent, LES-region spacing, and grid sensitivity.' },
  { title: 'DDES statistics are sampling independent', detail: 'Demonstrate time-step sensitivity, transient removal, stable block averages, and uncertainty.' },
  { title: 'The selected method is externally validated', detail: 'Use relevant transition, pressure, force, or spectral reference measurements.' },
]
export const t15Pedagogy: TutorialPedagogy = {
  learningObjectives: ['Diagnose whether transition onset or unsteady separation is the missing physics.', 'Configure the AFT transition solver from facility turbulence data.', 'Explain DDES shielding and LES grid-size controls.', 'Apply branch-specific mesh, time, statistics, and validation gates.'],
  cfdConcepts: [
    { id: 'transition', title: 'Transition changes wall shear and separation resistance', explanation: 'A laminar boundary layer has lower skin friction but often less resistance to an adverse pressure gradient.', misconception: 'Transition modelling only changes a displayed turbulence-intensity value.' },
    { id: 'hybrid', title: 'DDES is RANS near attached walls and LES-like after detachment', explanation: 'Shielding protects attached boundary layers while local grid scale controls resolved separated structures.', misconception: 'Enabling DDES makes every mesh cell an LES cell.' },
    { id: 'questions', title: 'The two upgrades answer different questions', explanation: 'Transition targets where turbulence begins; DDES targets time-dependent separated structures and statistics.', misconception: 'DDES is always a more accurate replacement for transition modelling.' },
  ],
  flow360Concepts: [
    { id: 'aft', title: 'Fluid owns the AFT transition solver', explanation: 'TransitionModelSolver sits beside kOmegaSST and accepts either facility intensity or Ncrit before serialization.', misconception: 'Intensity and Ncrit should both be supplied.' },
    { id: 'ddes', title: 'kOmegaSST owns DetachedEddySimulation', explanation: 'The hybrid_model declares DDES shielding and a shear-layer-adapted LES grid size.', misconception: 'DDES is a separate Fluid model.' },
    { id: 'outputs', title: 'Shared observables anchor the branches', explanation: 'Cp, Cf, yPlus, velocity, pressure, q-criterion, CL, and CD remain common; transition adds solutionTransition.', misconception: 'One q-criterion frame proves statistical convergence.' },
  ],
  derivations: [
    { id: 're', parameter: 'Chord Reynolds number', basis: 'Use ρ = 1.225 kg/m³, U = 50 m/s, c = 1.0 m, and μ ≈ 1.789×10⁻⁵ Pa·s.', calculation: 'Re_c = ρUc/μ = 3.42 × 10⁶', transfer: 'Recompute with the facility state and reference chord.' },
    { id: 'tc', parameter: 'Convective time', basis: 'Use c = 1.0 m and U = 50 m/s.', calculation: 'tc = c/U = 0.020 s', transfer: 'Report transient removal and averaging windows in convective times.' },
    { id: 'dt', parameter: 'DDES time-step ratio', basis: 'Use Δt = 0.0002 s and tc = 0.020 s.', calculation: 'Δt/tc = 0.01; 5000 steps span 50 tc', transfer: 'Establish smaller-step and local-CFL sensitivity.' },
    { id: 'ncrit', parameter: 'AFT disturbance input', basis: 'Use measured Tu = 0.10%; the Flow360 schema converts this single input.', calculation: 'Ncrit ≈ 8.15', transfer: 'Do not enter turbulence intensity and Ncrit simultaneously.' },
  ],
  experiments: [
    { id: 'branch', prediction: 'Which observation specifically justifies the transition branch?', options: ['Measured low freestream turbulence and uncertain laminar-to-turbulent onset', 'Persistent periodic loads caused by large separated structures'], controlledVariable: 'Geometry, state, incidence, references, mesh, wall treatment, and shared observables remain traceable.', observation: 'Connect solutionTransition to Cf, Cp, CL, and CD; do not claim resolved shedding.' },
    { id: 'ddes', prediction: 'What must be demonstrated before using a DDES mean CL value?', options: ['Time-step sensitivity, transient removal, and averaging-window convergence', 'One instantaneous q-criterion image with many vortices'], controlledVariable: 'The DDES branch explicitly changes hybrid closure and time advancement while retaining the physical configuration.', observation: 'Review shielding, LES-region resolution, histories, block averages, and uncertainty.' },
  ],
  failureModes: [
    { id: 'intensity', symptom: 'Transition moves strongly with an undocumented input.', cause: 'Facility disturbance was guessed or intensity and Ncrit were confused.', correction: 'Use measured turbulence, document conversion, and run sensitivity.' },
    { id: 'trip', symptom: 'The tunnel model transitions earlier than the clean simulation.', cause: 'Surface roughness, contamination, or a trip is absent.', correction: 'Represent or bound the trip effect rather than tuning Ncrit.' },
    { id: 'shielding', symptom: 'DDES switches inside an attached boundary layer.', cause: 'Grid-induced separation or inadequate shielding contaminates hybrid mode.', correction: 'Inspect hybrid-mode and wall-distance evidence and redesign the mesh.' },
    { id: 'span', symptom: 'Structures repeat across the span or remain two-dimensional.', cause: 'Span or spanwise resolution is insufficient.', correction: 'Increase span and resolution and compare spectra and statistics.' },
    { id: 'statistics', symptom: 'Mean CL changes when the averaging window moves.', cause: 'The transient remains or sampling is too short.', correction: 'Extend the run and demonstrate stable block averages and intervals.' },
  ],
  evidenceRubric: [
    { id: 'branch', observation: 'Missing-physics diagnosis', pass: 'The selected branch matches measured transition or unsteady-separation uncertainty.', fail: 'The method is chosen because it sounds advanced.' },
    { id: 'shared', observation: 'Shared configuration audit', pass: 'Geometry, state, references, wall mesh, and outputs are traceable.', fail: 'Unrelated settings change without explanation.' },
    { id: 'transition', observation: 'AFT onset evidence', pass: 'Facility input, solutionTransition, Cf, Cp, and forces agree.', fail: 'Transition is inferred from force difference alone.' },
    { id: 'grid', observation: 'DDES hybrid-grid evidence', pass: 'Shielding, wall distance, span, and LES-region resolution pass sensitivity.', fail: 'Nominal spacing is accepted without evidence.' },
    { id: 'time', observation: 'DDES statistical evidence', pass: 'Time step, transient, window convergence, and uncertainty are reported.', fail: 'One frame or arbitrary tail average is used.' },
    { id: 'validation', observation: 'External reference comparison', pass: 'Relevant transition, pressure, force, or spectral data support the decision.', fail: 'Agreement among Drafts is called validation.' },
  ],
  transferQuestions: [
    { prompt: 'Why is the DDES Draft not a one-field variant of steady RANS?', expected: 'It also requires unsteady advancement and statistical sampling, so the method and evidence contract change.' },
    { prompt: 'When should fully turbulent SST remain the selected method?', expected: 'When validated mean observables answer the decision and neither transition onset nor resolved unsteadiness matters materially.' },
  ],
}

export function t15Params(mode: T15Mode): Record<string, unknown> { if (mode === 'transition') return mergeTutorialPatch(t15Baseline, t15TransitionPatch) as Record<string, unknown>; if (mode === 'ddes') return mergeTutorialPatch(t15Baseline, t15DdesPatch) as Record<string, unknown>; return t15Baseline }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function quantity(value: unknown): number { return Number(record(value).value) }
function models(params: Record<string, unknown>) { return array(params.models).map(record) }
function draftEntities(params: Record<string, unknown>) { return array(record(record(params.private_attribute_asset_cache).project_entity_info).draft_entities).map(record) }
function storedEntities(value: unknown) { return array(record(value).stored_entities).map(record) }
export function t15ConfiguredPatch(mode: T15Mode): Record<string, unknown> { const params = t15Params(mode); const cache = record(params.private_attribute_asset_cache); return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher, project_entity_info: { draft_entities: draftEntities(params) } } } }
export function validateT15Setup(params: Record<string, unknown>): SetupCheck[] {
  const items = models(params); const fluid = items.find((item) => item.type === 'Fluid') || {}; const turbulence = record(fluid.turbulence_model_solver); const transition = record(fluid.transition_model_solver); const hybrid = record(turbulence.hybrid_model); const stepping = record(params.time_stepping); const condition = record(params.operating_condition); const mesh = record(params.meshing); const refs = array(mesh.refinements).map(record); const outputs = JSON.stringify(params.outputs); const mode: T15Mode = hybrid.shielding_function === 'DDES' ? 'ddes' : transition.type_name === 'AmplificationFactorTransport' ? 'transition' : 'rans'
  return [
    { id: 'state', label: 'The high-lift condition is shared', detail: 'All Drafts use 50 m/s air, 16° incidence, 1.0 m chord, and 0.30 m² reference area.', passed: quantity(condition.velocity_magnitude) === 50 && quantity(condition.alpha) === 16 && quantity(record(params.reference_geometry).area) === 0.3 },
    { id: 'closure', label: 'k-omega SST remains the parent closure', detail: 'RANS, transition, and DDES branches retain the same SST constants.', passed: turbulence.type_name === 'kOmegaSST' && record(turbulence.modeling_constants).type_name === 'kOmegaSSTConsts' },
    { id: 'branch', label: mode === 'rans' ? 'Fully turbulent RANS is selected' : mode === 'transition' ? 'AFT transition is selected' : 'SST-DDES is selected', detail: mode === 'rans' ? 'Transition is disabled and the method remains steady.' : mode === 'transition' ? 'Ncrit is approximately 8.15 and solutionTransition is requested.' : 'DDES shielding, shearLayerAdapted scale, and unsteady advancement are explicit.', passed: mode === 'rans' ? transition.type_name === 'None' && stepping.type_name === 'Steady' : mode === 'transition' ? Math.abs(Number(transition.N_crit) - 8.1498921919) < 1e-6 && stepping.type_name === 'Steady' && outputs.includes('solutionTransition') : hybrid.grid_size_for_LES === 'shearLayerAdapted' && stepping.type_name === 'Unsteady' && stepping.steps === 5000 && quantity(stepping.step_size) === 0.0002 },
    { id: 'mesh', label: 'Wall and three-dimensional separation controls are registered', detail: 'The shared mesh uses 15 μm first layers and 0.015625 m separated-zone spacing over a finite span.', passed: refs.some((item) => item.refinement_type === 'BoundaryLayer' && quantity(item.first_layer_thickness) === 0.000015) && refs.some((item) => item.refinement_type === 'UniformRefinement' && quantity(item.spacing) === 0.015625) && draftEntities(params).length === 2 },
    { id: 'boundaries', label: 'Three elements and the farfield are assigned', detail: 'Main wing, slat, and flap share a no-slip Wall with an AutomatedFarfield.', passed: items.some((item) => item.type === 'Wall' && storedEntities(item.entities).length === 3) && array(mesh.volume_zones).map(record).some((item) => item.type === 'AutomatedFarfield') },
    { id: 'evidence', label: 'Loading and separated-flow outputs are configured', detail: 'Cp, Cf, yPlus, velocity, pressure, q-criterion, wall distance, CL, and CD are requested.', passed: ['Cp', 'Cf', 'yPlus', 'velocity_m_per_s', 'pressure_pa', 'qcriterion', 'wallDistance', 'CL', 'CD'].every((field) => outputs.includes(field)) },
  ]
}
export function t15Progress(completed: string[]): number { const unique = new Set(completed.filter((id) => t15Steps.some((step) => step.id === id))); return Math.round((unique.size / t15Steps.length) * 100) }
function identifier(result: unknown, key: string): string { const value = record(result)[key]; return typeof value === 'string' ? value.trim() : '' }
export async function createT15Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging'); if (!(['rans', 'transition', 'ddes'] as T15Mode[]).every((mode) => validateT15Setup(t15Params(mode)).every((check) => check.passed))) throw new Error('The bundled T15 parameters contain an invalid model branch, time method, entity, or evidence contract.')
  const response = await fetchAsset(geometryUrl); if (!response.ok) throw new Error('The bundled T15 high-lift Geometry could not be loaded.')
  const form = new FormData(); form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T15'); form.append('files', await response.blob(), 'high-lift-wing.csm')
  const staged = await client.stageImport(form); const approved = await client.approveImport(staged.id); onStage('creating-project'); const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id'); if (!projectId || !geometryId) throw new Error('Flow360 created the T15 Project without returning its Geometry identifiers.')
  onStage('creating-drafts'); const [baselineDraft, variantDraft, ddesDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T15 baseline · fully turbulent SST', patch: t15ConfiguredPatch('rans') }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T15 branch · SST with AFT transition', patch: t15ConfiguredPatch('transition') }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T15 branch · unsteady SST-DDES', patch: t15ConfiguredPatch('ddes') }),
  ]); onStage('ready'); return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft, additionalDrafts: [ddesDraft] }
}
