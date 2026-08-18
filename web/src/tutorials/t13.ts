import baselineDocument from '../../../tutorials/T13-thermally-perfect-gas/simulation.json'
import mixturePatch from '../../../tutorials/T13-thermally-perfect-gas/variants/nasa9-mixture.patch.json'
import geometryUrl from '../../../tutorials/T13-thermally-perfect-gas/assets/exhaust-probe.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t13Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the hot-probe problem', summary: 'Decide whether constant-gamma air is adequate for a probe in 1800 K exhaust.' },
  { id: 'physics', label: '02', title: 'Separate caloric and species models', summary: 'Distinguish temperature-dependent heat capacity, frozen composition, and transported species.' },
  { id: 'scales', label: '03', title: 'Calculate the acoustic and flow scales', summary: 'Derive mixture gamma, sound speed, Mach number, Reynolds number, and dynamic pressure.' },
  { id: 'experiment', label: '04', title: 'Change only the gas thermodynamics', summary: 'Compare constant-gamma Air with a fixed-composition N2-O2 NASA-9 mixture.' },
  { id: 'evidence', label: '05', title: 'Build an aerothermal evidence chain', summary: 'Connect the material change to shocks, pressure, heat flux, mesh, and convergence.' },
  { id: 'run', label: '06', title: 'Create both configured Case Drafts', summary: 'Create the supplied probe Project and synchronize both material-model setups.' },
]

export const t13Baseline = baselineDocument as unknown as Record<string, unknown>
export const t13MixturePatch = mixturePatch as unknown as Record<string, unknown>
export const t13ParameterCards = [
  { label: 'Exhaust temperature', value: '1800 K', provenance: 'provided', why: 'Activates the high-temperature NASA-9 range and makes caloric modelling consequential.' },
  { label: 'Stream velocity', value: '900 m/s', provenance: 'provided', why: 'Places both setups just above Mach one, where acoustic-property changes affect the shock.' },
  { label: 'Gas density', value: '0.19610 kg/m³', provenance: 'derived', why: 'Corresponds to approximately 101.3 kPa for the frozen-mixture gas constant at 1800 K.' },
  { label: 'Probe diameter', value: '0.05 m', provenance: 'provided', why: 'Sets the crossflow Reynolds-number length and bow-shock scale.' },
  { label: 'Probe wall temperature', value: '600 K', provenance: 'provided', why: 'Creates an aerothermal temperature difference for surface heat-flux evidence.' },
  { label: 'Frozen composition', value: '0.767 N2 · 0.233 O2', provenance: 'adapted', why: 'Defines mixture properties without transporting or reacting the species.' },
]
export const t13Evidence = [
  { title: 'The controlled diff is the gas thermodynamic definition', detail: 'Temperature, density, velocity, Sutherland viscosity, Geometry, mesh, wall, solver, and outputs remain identical.' },
  { title: 'The active NASA-9 ranges cover 1800 K', detail: 'Both N2 and O2 use continuous 200–1000 K and 1000–6000 K intervals and their mass fractions sum to one.' },
  { title: 'The acoustic prediction precedes contour interpretation', detail: 'At 1800 K the documented change is γ: 1.400 → 1.300, a: 850.5 → 819.7 m/s, and M: 1.058 → 1.098.' },
  { title: 'Shock and wall evidence use matching scales', detail: 'Compare center-plane Mach and pressure plus probe Cp, pressure, temperature, heat flux, and y+ on common ranges.' },
  { title: 'The claim stays inside the frozen-gas model', detail: 'Mesh sensitivity and convergence support the comparison; no combustion, dissociation, emissions, or species-field claim is made.' },
]

export const t13Pedagogy: TutorialPedagogy = {
  learningObjectives: ['Distinguish constant-gamma and thermally perfect gas models.', 'Configure and audit a frozen N2-O2 NASA-9 mixture.', 'Calculate the acoustic and flow scales at 1800 K.', 'Assess shocks and wall heating without claiming transported or reacting species.'],
  cfdConcepts: [
    { id: 'caloric', title: 'High-temperature heat capacity changes the acoustic scale', explanation: 'A thermally perfect gas retains the ideal-gas relation while heat capacity and gamma vary with temperature.', misconception: 'Ideal gas always means constant gamma.' },
    { id: 'mach', title: 'Mach number depends on material properties', explanation: 'At fixed temperature and velocity, lower gamma reduces sound speed and raises Mach number.', misconception: 'Velocity alone fixes Mach number.' },
    { id: 'frozen', title: 'Frozen composition is not reacting flow', explanation: 'N2 and O2 fractions determine mixture properties but do not evolve through transport or chemistry.', misconception: 'Multiple listed species imply mixing or combustion.' },
  ],
  flow360Concepts: [
    { id: 'material', title: 'ThermallyPerfectGas owns species thermodynamics', explanation: 'FrozenSpecies and NASA-9 coefficient data live under the gas material.', misconception: 'NASA-9 data are solver controls.' },
    { id: 'ranges', title: 'Coefficient ranges must cover the operating state', explanation: 'Adjacent ranges cover 200–6000 K, including the 1800 K reference state.', misconception: 'Coefficients remain valid outside their stated interval.' },
    { id: 'viscosity', title: 'Sutherland viscosity is a controlled constant', explanation: 'Both Drafts retain the same viscosity law so only caloric thermodynamics changes.', misconception: 'A thermodynamic comparison must also change transport properties.' },
  ],
  derivations: [
    { id: 'r', parameter: 'Frozen-mixture gas constant', basis: 'Mass-average species gas constants for Y_N2 = 0.767 and Y_O2 = 0.233.', calculation: 'R_mix = ΣY_iR_i = 288.19 J/(kg·K)', transfer: 'Recompute for the actual fixed composition.' },
    { id: 'gamma', parameter: 'Mixture gamma at 1800 K', basis: 'Evaluate active NASA-9 cp values and use γ = cp/(cp − R_mix).', calculation: 'γ_mix = 1.3004; constant-gamma baseline = 1.4', transfer: 'Evaluate properties in the temperature range controlling the flow.' },
    { id: 'mach', parameter: 'Sound speed and Mach number', basis: 'Use a = √(γRT) and M = U/a at 1800 K and 900 m/s.', calculation: 'Baseline: a = 850.5 m/s, M = 1.058; mixture: a = 819.7 m/s, M = 1.098', transfer: 'Recalculate after changing temperature, composition, or caloric model.' },
    { id: 'flow', parameter: 'Reynolds number and dynamic pressure', basis: 'Use ρ = 0.19610 kg/m³, U = 900 m/s, D = 0.05 m, μ = 5.828e−5 Pa·s.', calculation: 'Re_D = 1.51 × 10⁵ and q = 79.4 kPa', transfer: 'Hold these inputs fixed when isolating thermodynamics.' },
  ],
  experiments: [{ id: 'gas', prediction: 'What changes when the constant-gamma material is replaced by the frozen NASA-9 mixture?', options: ['Sound speed decreases and Mach number increases at the same temperature and velocity', 'Velocity automatically decreases until Mach matches'], controlledVariable: 'Geometry, state, velocity, viscosity, wall temperature, mesh, boundaries, numerics, and outputs remain fixed.', observation: 'Compare the material diff, acoustic scales, bow shock, pressure, heat flux, mesh sensitivity, and convergence.' }],
  failureModes: [
    { id: 'range', symptom: 'Properties are invalid near 1800 K.', cause: 'Coefficient intervals have a gap or do not cover the state.', correction: 'Verify continuous 200–1000 K and 1000–6000 K ranges.' },
    { id: 'composition', symptom: 'Mixture acoustic estimates disagree.', cause: 'Mass fractions or molecular weights are wrong.', correction: 'Verify 0.767 N2 plus 0.233 O2 and recompute R_mix.' },
    { id: 'control', symptom: 'A difference cannot be attributed to thermodynamics.', cause: 'Another input changed between Drafts.', correction: 'Restore all non-material fields to the shared baseline.' },
    { id: 'scope', symptom: 'The result is reported as mixing or combustion.', cause: 'FrozenSpecies was mistaken for transported or reacting species.', correction: 'State that composition is fixed and use supported transport and chemistry models for those claims.' },
  ],
  evidenceRubric: [
    { id: 'diff', observation: 'Semantic parameter comparison', pass: 'Only gas thermodynamics changes.', fail: 'Any other physical or numerical input changes.' },
    { id: 'properties', observation: 'Pre-solve property calculation', pass: 'Ranges, composition, gamma, sound speed, and Mach agree.', fail: 'Only material names are compared.' },
    { id: 'shock', observation: 'Center-plane Mach and pressure', pass: 'Common scales and mesh-refined shock evidence are used.', fail: 'Different scales or unresolved shocks support the claim.' },
    { id: 'wall', observation: 'Probe pressure and heat flux', pass: 'Cp, pressure, temperature, heat flux, and y+ are interpreted together.', fail: 'One peak cell or unknown sign defines the load.' },
    { id: 'numerics', observation: 'Mesh and convergence', pass: 'Shock, near-wall spacing, residuals, and loads pass sensitivity checks.', fail: 'Unconverged Cases are compared.' },
  ],
  transferQuestions: [
    { prompt: 'What must be recalculated if exhaust temperature changes?', expected: 'NASA-9 heat capacities, gamma, sound speed, Mach, viscosity, and Reynolds number.' },
    { prompt: 'What is needed to predict changing N2 and O2 concentrations?', expected: 'A supported transported-species model and composition conditions, plus chemistry if reactions change composition.' },
  ],
}

export function t13Params(nasa9Enabled: boolean): Record<string, unknown> { return nasa9Enabled ? mergeTutorialPatch(t13Baseline, t13MixturePatch) as Record<string, unknown> : t13Baseline }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function quantity(value: unknown): number { return Number(record(value).value) }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : [] }
function draftEntities(params: Record<string, unknown>) { return array(record(record(params.private_attribute_asset_cache).project_entity_info).draft_entities).map(record) }
function material(params: Record<string, unknown>) { return record(record(record(params.operating_condition).thermal_state).material) }
function species(params: Record<string, unknown>) { return array(record(material(params).thermally_perfect_gas).species).map(record) }
function ranges(item: Record<string, unknown>) { return array(record(item.nasa_9_coefficients).temperature_ranges).map(record) }
export function t13ConfiguredPatch(nasa9Enabled: boolean): Record<string, unknown> { const params = t13Params(nasa9Enabled); const cache = record(params.private_attribute_asset_cache); return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher, project_entity_info: { draft_entities: draftEntities(params) } } } }

export function validateT13Setup(params: Record<string, unknown>): SetupCheck[] {
  const condition = record(params.operating_condition); const state = record(condition.thermal_state); const gas = material(params); const mixture = species(params)
  const models = array(params.models).map(record); const zones = array(record(params.meshing).volume_zones).map(record); const outputs = array(params.outputs).map(record)
  const fractions = mixture.reduce((sum, item) => sum + Number(item.mass_fraction), 0); const isVariant = mixture.length === 2
  const validRanges = mixture.every((item) => { const sets = ranges(item); return sets.length >= 1 && quantity(sets[0].temperature_range_min) <= 1800 && quantity(sets[sets.length - 1].temperature_range_max) >= 1800 && sets.every((set, index) => index === 0 || quantity(sets[index - 1].temperature_range_max) === quantity(set.temperature_range_min)) })
  const viscosity = record(gas.dynamic_viscosity)
  return [
    { id: 'state', label: 'The hot-gas reference state is dimensional', detail: 'Temperature is 1800 K, density is 0.19610 kg/m³, and velocity is 900 m/s.', passed: quantity(state.temperature) === 1800 && Math.abs(quantity(state.density) - 0.19610206574) < 1e-12 && quantity(condition.velocity_magnitude) === 900 },
    { id: 'gas', label: isVariant ? 'The frozen N2-O2 mixture is normalized' : 'The constant-gamma baseline is isolated', detail: isVariant ? 'N2 and O2 fractions sum to one.' : 'One Air species uses cp/R = 3.5, equivalent to gamma = 1.4.', passed: gas.type === 'air' && record(gas.thermally_perfect_gas).type_name === 'ThermallyPerfectGas' && Math.abs(fractions - 1) < 1e-12 && (isVariant ? mixture.map((item) => item.name).join(',') === 'N2,O2' : mixture.length === 1 && array(ranges(mixture[0])[0]?.coefficients)[2] === 3.5) },
    { id: 'ranges', label: 'NASA-9 data cover the 1800 K state', detail: isVariant ? 'Both species have continuous 200–1000 K and 1000–6000 K ranges.' : 'The constant-cp polynomial covers 200–6000 K.', passed: validRanges },
    { id: 'viscosity', label: 'The Sutherland law is shared', detail: 'Reference viscosity, reference temperature, and effective temperature remain the supplied air values.', passed: quantity(viscosity.reference_viscosity) === 0.00001716 && quantity(viscosity.reference_temperature) === 273.15 && quantity(viscosity.effective_temperature) === 110.4 },
    { id: 'domain', label: 'The compressible probe workflow is complete', detail: 'AutomatedFarfield, Freestream, a 600 K Wall, and one center Slice are present.', passed: zones.some((zone) => zone.type === 'AutomatedFarfield') && models.some((model) => model.type === 'Freestream') && models.some((model) => model.type === 'Wall' && quantity(record(model.heat_spec).value) === 600) && draftEntities(params).filter((item) => item.private_attribute_entity_type_name === 'Slice').length === 1 },
    { id: 'evidence', label: 'Aerothermal evidence fields are configured', detail: 'Outputs include Mach, dimensional pressure, temperature, wall heat flux, and y+.', passed: outputs.length === 2 && ['Mach', 'pressure_pa', 'T', 'heatFlux', 'yPlus'].every((field) => JSON.stringify(outputs).includes(field)) },
  ]
}

export function t13Progress(completed: string[]): number { const unique = new Set(completed.filter((id) => t13Steps.some((step) => step.id === id))); return Math.round((unique.size / t13Steps.length) * 100) }
function identifier(result: unknown, key: string): string { const value = record(result)[key]; return typeof value === 'string' ? value.trim() : '' }
export async function createT13Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging'); if (![false, true].every((enabled) => validateT13Setup(t13Params(enabled)).every((check) => check.passed))) throw new Error('The bundled T13 parameters contain an invalid gas, coefficient-range, composition, or evidence contract.')
  const response = await fetchAsset(geometryUrl); if (!response.ok) throw new Error('The bundled T13 exhaust-probe Geometry could not be loaded.')
  const form = new FormData(); form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T13'); form.append('files', await response.blob(), 'exhaust-probe.csm')
  const staged = await client.stageImport(form); const approved = await client.approveImport(staged.id); onStage('creating-project'); const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id'); if (!projectId || !geometryId) throw new Error('Flow360 created the T13 Project without returning its Geometry identifiers.')
  onStage('creating-drafts'); const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T13 baseline · constant-gamma hot air', patch: t13ConfiguredPatch(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T13 variant · frozen N2-O2 NASA-9', patch: t13ConfiguredPatch(true) }),
  ]); onStage('ready'); return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
