import baselineDocument from '../../../tutorials/T12-liquid-gravity/simulation.json'
import gravityPatch from '../../../tutorials/T12-liquid-gravity/variants/gravity.patch.json'
import geometryUrl from '../../../tutorials/T12-liquid-gravity/assets/vertical-riser.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t12Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the submerged-load problem', summary: 'Separate current-induced pressure from the depth-dependent hydrostatic contribution.' },
  { id: 'material', label: '02', title: 'Configure water as a liquid', summary: 'Connect density, viscosity, physical velocity, and reference velocity to Flow360 fields.' },
  { id: 'scales', label: '03', title: 'Calculate the governing pressure scales', summary: 'Derive Reynolds number, dynamic pressure, hydrostatic head, and their ratio.' },
  { id: 'experiment', label: '04', title: 'Add gravity as a controlled change', summary: 'Predict the vertical pressure gradient while holding the rest of the Case fixed.' },
  { id: 'evidence', label: '05', title: 'Separate head from current loading', summary: 'Define pressure-slope, depth-correction, force, mesh, and convergence evidence.' },
  { id: 'run', label: '06', title: 'Create both configured Case Drafts', summary: 'Create the supplied pile Project and synchronize gravity-off and gravity-on setups.' },
]

export const t12Baseline = baselineDocument as unknown as Record<string, unknown>
export const t12GravityPatch = gravityPatch as unknown as Record<string, unknown>
export const t12ParameterCards = [
  { label: 'Water density', value: '1000 kg/m³', provenance: 'Flow360 Water', why: 'Sets both inertia and the hydrostatic pressure gradient.' },
  { label: 'Dynamic viscosity', value: '0.001002 Pa·s', provenance: 'Flow360 Water', why: 'Combines with density, speed, and diameter to set Reynolds number.' },
  { label: 'Current speed', value: '2 m/s', provenance: 'provided', why: 'Defines the physical current and the reference velocity for nondimensionalization.' },
  { label: 'Pile diameter', value: '0.2 m', provenance: 'provided', why: 'Provides the crossflow Reynolds-number length scale.' },
  { label: 'Vertical span', value: '4 m', provenance: 'provided', why: 'Produces a 39.24 kPa hydrostatic pressure range under Earth gravity.' },
  { label: 'Gravity', value: '9.81 m/s² · −z', provenance: 'provided', why: 'Adds the global water body force only in the variant.' },
]
export const t12Evidence = [
  { title: 'The controlled diff contains only gravity', detail: 'Water, velocity, Geometry, mesh, boundaries, steady steps, and outputs remain identical.' },
  { title: 'The farfield pressure slope has the right sign', detail: 'With z positive upward, the gravity case approaches dp/dz = −9810 Pa/m away from the pile.' },
  { title: 'The four-metre head approaches 39.24 kPa', detail: 'Compare points at equal current position and outside the local pile disturbance.' },
  { title: 'Current pressure is depth-corrected', detail: 'Subtract one consistent hydrostatic reference before comparing circumferential pressure or drag.' },
  { title: 'Loads and numerics are independently credible', detail: 'Report force components, y+, mesh sensitivity, residuals, and stable loads rather than one resultant alone.' },
]

export const t12Pedagogy: TutorialPedagogy = {
  learningObjectives: ['Configure Water through LiquidOperatingCondition and identify both velocity scales.', 'Calculate Reynolds number, dynamic pressure, and hydrostatic head before solving.', 'Predict the sign and magnitude of the gravity-driven pressure gradient.', 'Separate hydrostatic pressure from current-induced loading in evidence and reporting.'],
  cfdConcepts: [
    { id: 'liquid', title: 'Water properties set inertia and diffusion', explanation: 'Density scales inertia and gravity loading while dynamic viscosity controls momentum diffusion.', misconception: 'A low-speed water Case is ordinary air CFD with a smaller Mach number.' },
    { id: 'scales', title: 'Hydrostatic head and dynamic pressure are distinct scales', explanation: 'ρgΔz measures depth-related pressure change; ½ρU² measures the current kinetic pressure scale.', misconception: 'Every raw pressure difference on the pile is caused by the current.' },
    { id: 'balance', title: 'A pressure gradient balances gravity', explanation: 'Away from the pile, steady water approaches dp/dz = −ρg when z points upward.', misconception: 'Gravity makes the entire farfield accelerate downward without a balancing pressure field.' },
  ],
  flow360Concepts: [
    { id: 'condition', title: 'LiquidOperatingCondition defines the global liquid reference', explanation: 'It carries Water, the physical 2 m/s velocity, and the velocity used for reference scaling.', misconception: 'Changing only Fluid.material fully converts an air setup into a liquid setup.' },
    { id: 'gravity', title: 'Gravity is a property of the Fluid model', explanation: 'The variant adds direction and magnitude under Fluid.gravity, applying the body force to all fluid zones.', misconception: 'Gravity belongs in the models array as an independent boundary model.' },
    { id: 'boundary', title: 'The supported liquid workflow uses a freestream boundary', explanation: 'The pinned Flow360 release accepts AutomatedFarfield and Freestream for this submerged body; liquid Inflow and Outflow are rejected.', misconception: 'A pipe inlet/outlet model can be substituted without checking liquid-schema support.' },
  ],
  derivations: [
    { id: 're', parameter: 'Diameter Reynolds number', basis: 'ρ = 1000 kg/m³, U = 2 m/s, D = 0.2 m, μ = 0.001002 Pa·s.', calculation: 'Re_D = ρUD/μ = 399,202', transfer: 'Use the length that controls separation or boundary-layer growth on the new geometry.' },
    { id: 'q', parameter: 'Dynamic pressure', basis: 'Use the cross-current speed and water density.', calculation: 'q = ½ρU² = 0.5 × 1000 × 2² = 2.00 kPa', transfer: 'Keep this reference fixed when comparing current-induced pressure coefficients.' },
    { id: 'head', parameter: 'Hydrostatic pressure span', basis: 'Earth gravity acts through a 4 m vertical separation.', calculation: 'Δp_h = ρgΔz = 1000 × 9.81 × 4 = 39.24 kPa', transfer: 'Use the signed elevation difference between the actual comparison points.' },
    { id: 'ratio', parameter: 'Head-to-dynamic ratio', basis: 'Compare both pressure scales before interpreting contours.', calculation: 'Δp_h/q = 39.24/2.00 = 19.62', transfer: 'When the ratio is material, subtract hydrostatic head before assigning a pressure difference to the current.' },
  ],
  experiments: [{ id: 'gravity', prediction: 'What changes when Earth gravity is enabled and every other parameter is fixed?', options: ['Pressure gains an approximately −9810 Pa/m vertical slope away from the pile', 'The current velocity and Water viscosity both increase'], controlledVariable: 'Geometry, Water, 2 m/s velocity, farfield, wall, mesh, solver steps, and outputs remain fixed.', observation: 'Compare the semantic diff, vertical pressure slope, depth-corrected surface pressure, force components, and convergence.' }],
  failureModes: [
    { id: 'direction', symptom: 'Pressure increases toward the top of the pile.', cause: 'Gravity or the vertical-axis convention is reversed.', correction: 'Confirm z is positive upward and Gravity direction is [0, 0, −1].' },
    { id: 'raw', symptom: 'A large depth trend is reported as current-induced Cp.', cause: 'The hydrostatic reference was not removed.', correction: 'Fit the farfield ρgz trend and subtract it before comparing pile pressure.' },
    { id: 'material', symptom: 'Expected pressure scales differ by orders of magnitude.', cause: 'Air properties, mixed units, or the wrong Water values were used.', correction: 'Inspect LiquidOperatingCondition material and units in the synchronized Draft.' },
    { id: 'scope', symptom: 'The Case is used to claim wave or cavitation predictions.', cause: 'The single-phase submerged model was extended beyond its physics.', correction: 'Use a workflow that explicitly represents a free surface or cavitation.' },
  ],
  evidenceRubric: [
    { id: 'diff', observation: 'Semantic parameter diff', pass: 'Fluid.gravity is the only intentional difference.', fail: 'Water, speed, mesh, boundaries, or numerics also change.' },
    { id: 'slope', observation: 'Farfield pressure versus elevation', pass: 'Gravity approaches −9810 Pa/m; baseline has no hydrostatic vertical slope.', fail: 'The sign or magnitude is inconsistent away from the pile.' },
    { id: 'corrected', observation: 'Depth-corrected pile pressure', pass: 'One hydrostatic reference is removed before comparing current disturbance.', fail: 'Raw pressures at different heights are compared as current-only loading.' },
    { id: 'loads', observation: 'Integrated force components', pass: 'Drag and vertical contributions are reported separately and stabilize.', fail: 'A single resultant hides direction, sign, or drift.' },
    { id: 'numerics', observation: 'Mesh and convergence', pass: 'Surface resolution, y+, residuals, and loads pass sensitivity checks.', fail: 'A correct hydrostatic slope is used to excuse unresolved wake physics.' },
  ],
  transferQuestions: [
    { prompt: 'What hydrostatic span would a 10 m pile produce?', expected: 'ρgΔz gives about 98.1 kPa for the same water and Earth gravity.' },
    { prompt: 'Why compare depth-corrected rather than raw pile pressure?', expected: 'Raw pressure combines hydrostatic depth variation and current disturbance; correction isolates current loading.' },
  ],
}

export function t12Params(gravityEnabled: boolean): Record<string, unknown> { return gravityEnabled ? mergeTutorialPatch(t12Baseline, t12GravityPatch) as Record<string, unknown> : t12Baseline }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function quantity(value: unknown): number { return Number(record(value).value) }
function draftEntities(params: Record<string, unknown>) { const values = record(record(params.private_attribute_asset_cache).project_entity_info).draft_entities; return Array.isArray(values) ? values.map(record) : [] }
export function t12ConfiguredPatch(gravityEnabled: boolean): Record<string, unknown> { const params = t12Params(gravityEnabled); const cache = record(params.private_attribute_asset_cache); return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher, project_entity_info: { draft_entities: draftEntities(params) } } } }

export function validateT12Setup(params: Record<string, unknown>): SetupCheck[] {
  const condition = record(params.operating_condition); const material = record(condition.material)
  const models = Array.isArray(params.models) ? params.models.map(record) : []; const fluid = models.find((model) => model.type === 'Fluid') || {}; const gravity = record(fluid.gravity)
  const meshing = record(params.meshing); const zones = Array.isArray(meshing.volume_zones) ? meshing.volume_zones.map(record) : []
  const outputs = Array.isArray(params.outputs) ? params.outputs.map(record) : []; const sliceCount = draftEntities(params).filter((item) => item.private_attribute_entity_type_name === 'Slice').length
  return [
    { id: 'water', label: 'The global material is Water', detail: 'LiquidOperatingCondition carries 1000 kg/m³ density and 0.001002 Pa·s viscosity.', passed: condition.type_name === 'LiquidOperatingCondition' && material.type === 'water' && quantity(material.density) === 1000 && Math.abs(quantity(material.dynamic_viscosity) - 0.001002) < 1e-12 },
    { id: 'velocity', label: 'Physical and reference velocities are explicit', detail: 'Both are 2 m/s so dimensional outputs and coefficient references share one declared scale.', passed: quantity(condition.velocity_magnitude) === 2 && quantity(condition.reference_velocity_magnitude) === 2 },
    { id: 'domain', label: 'The submerged-body boundary workflow is complete', detail: 'AutomatedFarfield, Freestream, no-slip pile Wall, and one center Slice are present.', passed: zones.some((zone) => zone.type === 'AutomatedFarfield') && models.some((model) => model.type === 'Freestream') && models.some((model) => model.type === 'Wall') && sliceCount === 1 },
    { id: 'gravity', label: gravity.direction ? 'Earth gravity is enabled' : 'Gravity-off baseline is isolated', detail: gravity.direction ? 'Magnitude is 9.81 m/s² and direction is negative z.' : 'Fluid.gravity is absent while the water setup remains complete.', passed: gravity.direction ? Array.isArray(gravity.direction) && gravity.direction.join(',') === '0,0,-1' && quantity(gravity.magnitude) === 9.81 : fluid.gravity === undefined },
    { id: 'evidence', label: 'Dimensional liquid evidence fields are configured', detail: 'Pile and center-plane outputs include pressure in Pa, velocity in m/s, and wall shear stress in Pa.', passed: outputs.length === 2 && JSON.stringify(outputs).includes('pressure_pa') && JSON.stringify(outputs).includes('velocity_m_per_s') && JSON.stringify(outputs).includes('wall_shear_stress_magnitude_pa') },
  ]
}

export function t12Progress(completed: string[]): number { const unique = new Set(completed.filter((id) => t12Steps.some((step) => step.id === id))); return Math.round((unique.size / t12Steps.length) * 100) }
function identifier(result: unknown, key: string): string { const value = record(result)[key]; return typeof value === 'string' ? value.trim() : '' }
export async function createT12Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging'); if (![false, true].every((enabled) => validateT12Setup(t12Params(enabled)).every((check) => check.passed))) throw new Error('The bundled T12 parameters contain an invalid liquid, gravity, boundary, or evidence contract.')
  const response = await fetchAsset(geometryUrl); if (!response.ok) throw new Error('The bundled T12 submerged-pile Geometry could not be loaded.')
  const form = new FormData(); form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T12'); form.append('files', await response.blob(), 'vertical-riser.csm')
  const staged = await client.stageImport(form); const approved = await client.approveImport(staged.id); onStage('creating-project'); const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id'); if (!projectId || !geometryId) throw new Error('Flow360 created the T12 Project without returning its Geometry identifiers.')
  onStage('creating-drafts'); const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T12 baseline · water current without gravity', patch: t12ConfiguredPatch(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T12 variant · water current with Earth gravity', patch: t12ConfiguredPatch(true) }),
  ]); onStage('ready'); return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
