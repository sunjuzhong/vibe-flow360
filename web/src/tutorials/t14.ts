import baselineDocument from '../../../tutorials/T14-turbulence-models/simulation.json'
import sstPatch from '../../../tutorials/T14-turbulence-models/variants/k-omega-sst.patch.json'
import geometryUrl from '../../../tutorials/T14-turbulence-models/assets/rear-step-body.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t14Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the separated-wake decision', summary: 'Ask how turbulence closure affects rear-step separation, pressure recovery, and drag.' },
  { id: 'closure', label: '02', title: 'Connect RANS closure to Flow360', summary: 'Distinguish modeled stresses, SA, k-omega SST, and compatible freestream quantities.' },
  { id: 'scales', label: '03', title: 'Calculate flow and turbulence scales', summary: 'Derive Reynolds number, dynamic pressure, turbulent kinetic energy, and omega.' },
  { id: 'experiment', label: '04', title: 'Build the controlled model comparison', summary: 'Change the closure and its declared inlet quantities while holding the experiment fixed.' },
  { id: 'evidence', label: '05', title: 'Quantify model-form sensitivity', summary: 'Compare separation, wake recovery, pressure drag, wall treatment, mesh, and convergence.' },
  { id: 'run', label: '06', title: 'Create both configured Case Drafts', summary: 'Create the supplied rear-step Project and synchronize SA and SST setups.' },
]
export const t14Baseline = baselineDocument as unknown as Record<string, unknown>
export const t14SstPatch = sstPatch as unknown as Record<string, unknown>
export const t14ParameterCards = [
  { label: 'Wind-tunnel speed', value: '30 m/s', provenance: 'provided', why: 'Sets a height Reynolds number of approximately 2.46 million.' },
  { label: 'Reference height', value: '1.2 m', provenance: 'provided', why: 'Represents the body height controlling boundary-layer and wake scales.' },
  { label: 'Reference area', value: '1.44 m²', provenance: 'derived', why: 'Uses body height times width for one shared drag-coefficient convention.' },
  { label: 'SA freestream input', value: 'modified viscosity ratio 70', provenance: 'adapted', why: 'Initializes the one transported SA working variable.' },
  { label: 'SST freestream input', value: 'I = 0.5% · L = 0.01 m', provenance: 'adapted', why: 'Provides two physical scales used to initialize k and omega.' },
  { label: 'Wake spacing', value: '0.0625 m', provenance: 'adapted', why: 'Resolves the shear layer and reverse-flow corridor shared by both Drafts.' },
]
export const t14Evidence = [
  { title: 'The semantic diff is limited to closure-compatible fields', detail: 'Geometry, air state, 30 m/s speed, references, mesh, wall, steady steps, and outputs remain fixed.' },
  { title: 'Separation uses signed evidence', detail: 'Locate zero-Cf separation and reattachment and measure negative streamwise velocity on the center Slice.' },
  { title: 'Wake and drag share one convention', detail: 'Compare velocity deficit, base pressure, and stable CD using common scales and the same 1.44 m² area.' },
  { title: 'Wall and grid errors are checked independently', detail: 'Review y+, first-layer treatment, surface resolution, and wake refinement for both closures.' },
  { title: 'Model selection uses external reference evidence', detail: 'Treat the SA-to-SST spread as sensitivity; compare relevant experiment or higher-fidelity data before choosing.' },
]
export const t14Pedagogy: TutorialPedagogy = {
  learningObjectives: ['Explain why steady RANS requires a turbulence closure.', 'Distinguish one-equation SA from two-equation k-omega SST.', 'Connect each closure to compatible freestream turbulence quantities.', 'Assess model-form sensitivity without treating model agreement as validation.'],
  cfdConcepts: [
    { id: 'rans', title: 'RANS models unresolved turbulent stresses', explanation: 'A closure relates Reynolds stresses to the mean flow through modeled transport variables and eddy viscosity.', misconception: 'Steady RANS directly resolves turbulent eddies and shedding.' },
    { id: 'separation', title: 'Separated wakes challenge closure assumptions', explanation: 'Modeled turbulent transport influences shear-layer growth, reattachment, base pressure, and drag.', misconception: 'Geometry alone fixes separation and wake recovery.' },
    { id: 'uncertainty', title: 'Model spread is sensitivity, not truth', explanation: 'SA and SST encode different assumptions; their spread measures one source of model-form uncertainty.', misconception: 'Agreement between two models automatically validates the result.' },
  ],
  flow360Concepts: [
    { id: 'fluid', title: 'Fluid owns the turbulence solver', explanation: 'SpalartAllmaras or kOmegaSST sits under Fluid.turbulence_model_solver with its constants and numerics.', misconception: 'The turbulence model is a wall boundary condition.' },
    { id: 'inlet', title: 'Freestream owns turbulence quantities', explanation: 'SA receives a modified-viscosity ratio; SST receives intensity and length scale to initialize different variables.', misconception: 'One turbulence number has identical meaning for every closure.' },
    { id: 'output', title: 'Shared outputs make the comparison auditable', explanation: 'Both Drafts request Cp, Cf, yPlus, velocity, pressure, vorticity, mut, mutRatio, and CD.', misconception: 'Native SA nuHat and SST k-omega fields are the same quantity.' },
  ],
  derivations: [
    { id: 're', parameter: 'Height Reynolds number', basis: 'Use ρ = 1.225 kg/m³, U = 30 m/s, H = 1.2 m, and μ ≈ 1.789×10⁻⁵ Pa·s.', calculation: 'Re_H = ρUH/μ = 2.46 × 10⁶', transfer: 'Use the dimension governing separation on the new body.' },
    { id: 'q', parameter: 'Dynamic pressure', basis: 'Use the shared density and speed.', calculation: 'q = ½ρU² = 551.25 Pa', transfer: 'Keep q and reference area fixed when comparing CD.' },
    { id: 'k', parameter: 'SST turbulent kinetic energy scale', basis: 'Use I = 0.005 and U = 30 m/s.', calculation: 'k = 1.5(UI)² = 0.03375 m²/s²', transfer: 'Derive intensity from the facility rather than a convenient default.' },
    { id: 'omega', parameter: 'SST specific dissipation scale', basis: 'Use L = 0.01 m and explanatory Cμ = 0.09.', calculation: 'ω ≈ √k/(Cμ⁰·²⁵L) = 33.5 s⁻¹', transfer: 'Document the selected length scale and conversion convention.' },
  ],
  experiments: [{ id: 'closure', prediction: 'What does a difference between the SA and SST reattachment lengths mean?', options: ['It is model-form sensitivity that needs mesh and reference checks', 'The model with lower drag is more accurate'], controlledVariable: 'Geometry, state, speed, references, mesh, boundaries, wall, steady steps, and outputs remain fixed.', observation: 'Compare the diff, zero-Cf locations, reverse flow, base pressure, CD, mutRatio, y+, mesh sensitivity, and convergence.' }],
  failureModes: [
    { id: 'inlet', symptom: 'SST wake behaviour changes when the farfield moves.', cause: 'Turbulence inputs decay before reaching the body.', correction: 'Use facility data and inspect turbulence quantities at the body.' },
    { id: 'wall', symptom: 'Near-wall treatment dominates model differences.', cause: 'yPlus or wall-layer resolution is inconsistent.', correction: 'Report yPlus and repeat on a consistent refined mesh.' },
    { id: 'steady', symptom: 'Residuals and CD remain periodic.', cause: 'The separated wake is intrinsically unsteady.', correction: 'Move to a justified unsteady workflow and sampling window.' },
    { id: 'verdict', symptom: 'One closure is declared correct from preference.', cause: 'No experimental or higher-fidelity reference was used.', correction: 'Compare reference observables and report model and grid uncertainty.' },
  ],
  evidenceRubric: [
    { id: 'diff', observation: 'Semantic parameter comparison', pass: 'Only closure and compatible freestream quantities change.', fail: 'Another physical or numerical input changes.' },
    { id: 'separation', observation: 'Surface Cf and center-plane reverse flow', pass: 'Signed separation evidence passes mesh sensitivity.', fail: 'A colored wake image replaces signed evidence.' },
    { id: 'drag', observation: 'Base pressure and CD', pass: 'Common references and stable histories are used.', fail: 'References differ or loads drift.' },
    { id: 'wall', observation: 'yPlus and near-wall resolution', pass: 'Both closures use documented comparable wall treatment.', fail: 'One Case has unreviewed yPlus.' },
    { id: 'reference', observation: 'External reference comparison', pass: 'Relevant pressure, reattachment, or drag data support the choice.', fail: 'SA-SST agreement is treated as validation.' },
  ],
  transferQuestions: [
    { prompt: 'Why must the mesh remain fixed in a closure comparison?', expected: 'Otherwise grid error and model-form effects are confounded.' },
    { prompt: 'What if the wake remains periodic in both steady Drafts?', expected: 'Use a justified unsteady method and compare sampling-independent mean observables.' },
  ],
}

export function t14Params(useSst: boolean): Record<string, unknown> { return useSst ? mergeTutorialPatch(t14Baseline, t14SstPatch) as Record<string, unknown> : t14Baseline }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function quantity(value: unknown): number { return Number(record(value).value) }
function draftEntities(params: Record<string, unknown>) { return array(record(record(params.private_attribute_asset_cache).project_entity_info).draft_entities).map(record) }
function models(params: Record<string, unknown>) { return array(params.models).map(record) }
export function t14ConfiguredPatch(useSst: boolean): Record<string, unknown> { const params = t14Params(useSst); const cache = record(params.private_attribute_asset_cache); return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher, project_entity_info: { draft_entities: draftEntities(params) } } } }
export function validateT14Setup(params: Record<string, unknown>): SetupCheck[] {
  const items = models(params); const fluid = items.find((item) => item.type === 'Fluid') || {}; const solver = record(fluid.turbulence_model_solver); const freestream = items.find((item) => item.type === 'Freestream') || {}; const tq = record(freestream.turbulence_quantities); const sst = solver.type_name === 'kOmegaSST'
  const condition = record(params.operating_condition); const state = record(condition.thermal_state); const meshing = record(params.meshing); const refinements = array(meshing.refinements).map(record); const outputs = array(params.outputs).map(record)
  return [
    { id: 'state', label: 'The wind-tunnel state is shared', detail: 'Both Drafts use 30 m/s air at 288.15 K and 1.225 kg/m³.', passed: quantity(condition.velocity_magnitude) === 30 && quantity(state.temperature) === 288.15 && quantity(state.density) === 1.225 },
    { id: 'closure', label: sst ? 'k-omega SST is selected' : 'Spalart-Allmaras is selected', detail: sst ? 'The two-equation SST solver and its default constant set are explicit.' : 'The one-equation SA solver and its default constant set are explicit.', passed: sst ? record(solver.modeling_constants).type_name === 'kOmegaSSTConsts' : solver.type_name === 'SpalartAllmaras' && record(solver.modeling_constants).type_name === 'SpalartAllmarasConsts' },
    { id: 'freestream', label: 'Freestream quantities match the closure', detail: sst ? 'Intensity is 0.005 and turbulent length scale is 0.01 m.' : 'Modified turbulent viscosity ratio is 70.', passed: sst ? tq.type_name === 'TurbulentIntensityAndTurbulentLengthScale' && tq.turbulent_intensity === 0.005 && quantity(tq.turbulent_length_scale) === 0.01 : tq.type_name === 'ModifiedTurbulentViscosityRatio' && tq.modified_turbulent_viscosity_ratio === 70 },
    { id: 'mesh', label: 'Wall and separated wake controls are registered', detail: 'The shared mesh includes a BoundaryLayer and a 0.0625 m wake UniformRefinement.', passed: refinements.some((item) => item.refinement_type === 'BoundaryLayer') && refinements.some((item) => item.refinement_type === 'UniformRefinement' && quantity(item.spacing) === 0.0625) && draftEntities(params).length === 2 },
    { id: 'boundary', label: 'Farfield and body wall are complete', detail: 'AutomatedFarfield, Freestream, and the rear-step Wall are present.', passed: array(meshing.volume_zones).map(record).some((item) => item.type === 'AutomatedFarfield') && items.some((item) => item.type === 'Wall') },
    { id: 'evidence', label: 'Separation, turbulence, and drag evidence is configured', detail: 'Outputs include Cp, Cf, yPlus, velocity, pressure, mutRatio, and CD.', passed: outputs.length === 3 && ['Cp', 'Cf', 'yPlus', 'velocity_m_per_s', 'pressure_pa', 'mutRatio', 'CD'].every((field) => JSON.stringify(outputs).includes(field)) },
  ]
}
export function t14Progress(completed: string[]): number { const unique = new Set(completed.filter((id) => t14Steps.some((step) => step.id === id))); return Math.round((unique.size / t14Steps.length) * 100) }
function identifier(result: unknown, key: string): string { const value = record(result)[key]; return typeof value === 'string' ? value.trim() : '' }
export async function createT14Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging'); if (![false, true].every((enabled) => validateT14Setup(t14Params(enabled)).every((check) => check.passed))) throw new Error('The bundled T14 parameters contain an invalid turbulence closure, freestream specification, entity, or evidence contract.')
  const response = await fetchAsset(geometryUrl); if (!response.ok) throw new Error('The bundled T14 rear-step Geometry could not be loaded.')
  const form = new FormData(); form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T14'); form.append('files', await response.blob(), 'rear-step-body.csm')
  const staged = await client.stageImport(form); const approved = await client.approveImport(staged.id); onStage('creating-project'); const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id'); if (!projectId || !geometryId) throw new Error('Flow360 created the T14 Project without returning its Geometry identifiers.')
  onStage('creating-drafts'); const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T14 baseline · Spalart-Allmaras rear-step wake', patch: t14ConfiguredPatch(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T14 variant · k-omega SST rear-step wake', patch: t14ConfiguredPatch(true) }),
  ]); onStage('ready'); return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
