import baselineDocument from '../../../tutorials/T02-wind-tunnel-similarity/simulation.json'
import matchReynoldsPatch from '../../../tutorials/T02-wind-tunnel-similarity/variants/match-reynolds.patch.json'
import geometryUrl from '../../../tutorials/T01-first-lift-drag/assets/geometry.csm?url'
import {
  mergeTutorialPatch,
  type SetupCheck,
  type TutorialEnvironmentClient,
  type TutorialEnvironmentResult,
  type TutorialEnvironmentStage,
  type TutorialStep,
} from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t02Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the similarity problem', summary: 'Identify which nondimensional groups must match the target experiment.' },
  { id: 'derive', label: '02', title: 'Derive the ambient condition', summary: 'Calculate speed, Reynolds number, and dynamic pressure from Mach and temperature.' },
  { id: 'map', label: '03', title: 'Map inputs to Flow360', summary: 'Inspect AerospaceCondition constructors, ThermalState, and project length units.' },
  { id: 'variant', label: '04', title: 'Match Reynolds number', summary: 'Reduce density while holding Mach, temperature, alpha, and geometry fixed.' },
  { id: 'evidence', label: '05', title: 'Define comparison evidence', summary: 'Require consistent references, convergence, forces, pressure, and yPlus.' },
  { id: 'run', label: '06', title: 'Create both condition Drafts', summary: 'Create the bundled Geometry Project and synchronize two Case Drafts.' },
]

export const t02Baseline = baselineDocument as unknown as Record<string, unknown>
export const t02MatchPatch = matchReynoldsPatch as unknown as Record<string, unknown>

export const t02ParameterCards = [
  { label: 'Reference chord', value: 'L = 2.4 m', provenance: 'provided', why: 'Converts Reynolds number per project metre into the chord-based experimental value.' },
  { label: 'Mach and temperature', value: 'M = 0.18 · T = 288.15 K', provenance: 'provided', why: 'Determine the speed of sound and the shared 61.25 m/s velocity.' },
  { label: 'Ambient chord Reynolds', value: 'Re = 10.1 million', provenance: 'derived', why: 'Shows that matching Mach at standard density misses the six-million tunnel target.' },
  { label: 'Target per mesh unit', value: '2.5 million per m', provenance: 'derived', why: 'Flow360 expects Reynolds number per project length unit, not automatically per chord.' },
  { label: 'Matched density', value: 'ρ = 0.730 kg/m³', provenance: 'derived', why: 'Matches six-million chord Reynolds while Mach, temperature, and velocity remain fixed.' },
  { label: 'Dynamic pressure change', value: '2298 Pa → 1370 Pa', provenance: 'derived', why: 'Explains why dimensional loads change even before coefficient differences are considered.' },
]

export const t02Evidence = [
  { title: 'Geometry scale is confirmed', detail: 'Project units, 2.4 m chord, 24 m² reference area, and experimental conventions agree.' },
  { title: 'Mach and Reynolds both match', detail: 'The matched Draft serializes Mach 0.18 and reproduces six-million chord Reynolds.' },
  { title: 'Thermal state is consistent', detail: 'Temperature, density, viscosity model, velocity, and dynamic pressure form a feasible condition.' },
  { title: 'The comparison is controlled', detail: 'Geometry, alpha, models, mesh, references, outputs, and review windows remain fixed.' },
  { title: 'Result evidence is complete', detail: 'Residuals, force histories, Cp, yPlus, CL, CD, and dimensional forces are reviewed together.' },
]

export const t02Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Explain why matching Mach number does not automatically match viscous Reynolds-number effects.',
    'Choose and interpret Flow360 AerospaceCondition constructors and their ThermalState output.',
    'Judge whether scale, nondimensional groups, references, and result evidence support a wind-tunnel comparison.',
  ],
  cfdConcepts: [
    { id: 'mach', title: 'Mach number controls compressibility similarity', explanation: 'Mach is velocity divided by local speed of sound, so temperature and gas properties participate in the velocity conversion.', misconception: 'Equal velocity is not equal Mach when the speed of sound changes.' },
    { id: 'reynolds', title: 'Reynolds number controls viscous similarity', explanation: 'Reynolds number rho V L divided by mu affects boundary layers, transition, separation, skin friction, and aerodynamic coefficients.', misconception: 'Matching Mach and alpha does not match Reynolds number when density, viscosity, or reference length differs.' },
  ],
  flow360Concepts: [
    { id: 'constructors', title: 'AerospaceCondition keeps the engineering inputs traceable', explanation: 'from_mach derives velocity from Mach and ThermalState; from_mach_reynolds also derives density from reynolds_mesh_unit.', misconception: 'reynolds_mesh_unit is per project mesh unit, not automatically based on the aircraft chord.' },
    { id: 'thermal', title: 'ThermalState carries density and air properties', explanation: 'The serialized condition contains temperature, derived density, Sutherland viscosity data, and the Mach-derived velocity used by the solver.', misconception: 'Equal temperature does not require equal density in a pressure-controlled wind tunnel.' },
  ],
  derivations: [
    { id: 'speed', parameter: 'Mach-derived velocity', basis: 'At 288.15 K, the air speed of sound is approximately 340.29 m/s.', calculation: 'V = M a = 0.18 × 340.29 = 61.25 m/s', transfer: 'Recalculate speed of sound and velocity whenever temperature or gas composition changes.' },
    { id: 'mesh-re', parameter: 'Reynolds number per mesh unit', basis: 'The target uses a 2.4 m chord while the Project length unit is one metre.', calculation: 'Re_mesh = 6.0e6 / 2.4 = 2.5e6 per m', transfer: 'Divide target Reynolds number by reference length expressed in project length units.' },
    { id: 'density', parameter: 'Matched density', basis: 'With velocity, viscosity, and chord fixed, density is adjusted to reproduce the tunnel Reynolds number.', calculation: 'ρ = Re μ/(V L) = 0.730 kg/m³', transfer: 'Solve for a facility-controllable quantity and verify the resulting pressure and dynamic pressure.' },
    { id: 'pressure', parameter: 'Dynamic pressure', basis: 'Dimensional force scales with one-half density times velocity squared.', calculation: 'qambient = 2298 Pa · qmatched = 1370 Pa · ratio = 0.596', transfer: 'Recalculate dimensional loads whenever density or velocity changes.' },
  ],
  experiments: [{ id: 'density', prediction: 'What changes when density is reduced to match Reynolds number while Mach and temperature stay fixed?', options: ['Velocity stays fixed while Reynolds number and dynamic pressure decrease', 'Velocity doubles and Mach changes'], controlledVariable: 'Only the constructor inputs and derived density change; geometry, Mach, temperature, alpha, models, mesh, references, and outputs remain fixed.', observation: 'Compare serialized velocity, density, chord Reynolds number, dynamic pressure, yPlus, coefficients, and dimensional forces.' }],
  failureModes: [
    { id: 'mesh-unit', symptom: 'The requested Reynolds number is 2.4 times larger than the chord target.', cause: 'Six million was entered directly as reynolds_mesh_unit for a 2.4-unit chord.', correction: 'Divide the chord target by chord length in project units and enter 2.5 million per metre.' },
    { id: 'mach-only', symptom: 'Mach matches the experiment but separation or drag differs systematically.', cause: 'Ambient density produces chord Reynolds number near ten million instead of six million.', correction: 'Use from_mach_reynolds or another feasible thermal state that matches both groups.' },
    { id: 'reference', symptom: 'Coefficients differ by a constant scale while dimensional forces look coherent.', cause: 'Reference area, length, or force convention differs from the experiment.', correction: 'Align reference geometry and coefficient conventions before changing physics or mesh.' },
    { id: 'wall', symptom: 'The matched-density Case has a different yPlus range on the same mesh.', cause: 'Wall-unit spacing depends on density, viscosity, velocity, and wall shear.', correction: 'Recalculate first-layer requirements and review actual yPlus before accepting the comparison.' },
  ],
  evidenceRubric: [
    { id: 'scale', observation: 'Scale and references', pass: 'Project units, chord, area, and target conventions agree.', fail: 'A scale or convention is missing or inferred from appearance.' },
    { id: 'groups', observation: 'Nondimensional groups', pass: 'Mach is 0.18 and the matched condition reproduces chord Reynolds number six million.', fail: 'Only velocity or Mach is checked, or mesh-unit Reynolds is mistaken for chord Reynolds.' },
    { id: 'thermal', observation: 'Thermal consistency', pass: 'Temperature, density, viscosity, velocity, and dynamic pressure form a feasible state.', fail: 'The values were edited independently into an inconsistent condition.' },
    { id: 'controlled', observation: 'Controlled comparison', pass: 'Density construction is the only condition difference and all other setup remains fixed.', fail: 'Geometry, alpha, model, mesh, reference, or review-window differences confound the comparison.' },
    { id: 'results', observation: 'Aerodynamic evidence', pass: 'Stable forces, residuals, Cp, yPlus, CL, CD, and dimensional loads agree with the conclusion.', fail: 'A final coefficient is used without convergence, field, and wall-resolution checks.' },
  ],
  transferQuestions: [
    { prompt: 'What reynolds_mesh_unit matches six million when the chord is 1.5 m?', expected: 'Six million divided by 1.5 gives four million per project metre.' },
    { prompt: 'Why can equal Mach and Reynolds still produce different coefficients?', expected: 'Geometry, roughness, transition, turbulence modeling, boundaries, references, or unsteadiness may differ.' },
  ],
}

export function t02Params(matched: boolean): Record<string, unknown> {
  return matched ? mergeTutorialPatch(t02Baseline, t02MatchPatch) as Record<string, unknown> : t02Baseline
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function t02ConfiguredPatch(matched: boolean): Record<string, unknown> {
  const params = t02Params(matched)
  const cache = record(params.private_attribute_asset_cache)
  return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher } }
}

export function validateT02Setup(params: Record<string, unknown>): SetupCheck[] {
  const condition = record(params.operating_condition)
  const inputs = record(condition.private_attribute_input_cache)
  const thermal = record(condition.thermal_state)
  const velocity = Number(record(condition.velocity_magnitude).value)
  const density = Number(record(thermal.density).value)
  const reference = record(params.reference_geometry)
  const length = record(reference.moment_length)
  const values = Array.isArray(length.value) ? length.value.map(Number) : [Number(length.value)]
  const matched = condition.private_attribute_constructor === 'from_mach_reynolds'
  const chordRe = density * velocity * 2.4 / 1.7894e-5
  return [
    { id: 'constructor', label: 'Condition constructor is traceable', detail: matched ? 'from_mach_reynolds records Mach, Reynolds per mesh unit, project length, and temperature.' : 'from_mach records Mach and the ambient ThermalState.', passed: ['from_mach', 'from_mach_reynolds'].includes(String(condition.private_attribute_constructor)) },
    { id: 'mach', label: 'Mach-derived velocity is consistent', detail: `Mach ${Number(inputs.mach).toFixed(2)} · ${velocity.toFixed(2)} m/s · 288.15 K`, passed: Math.abs(Number(inputs.mach) - 0.18) < 1e-9 && Math.abs(velocity - 61.2529) < 0.01 },
    { id: 'reference', label: 'Reference length is explicit', detail: 'The aircraft moment-length convention contains the 2.4 m characteristic length.', passed: values.includes(2.4) },
    { id: 'reynolds', label: matched ? 'Target Reynolds number is matched' : 'Ambient Reynolds mismatch is visible', detail: `Chord Reynolds ≈ ${(chordRe / 1e6).toFixed(2)} million`, passed: matched ? Math.abs(chordRe - 6e6) < 2e4 : chordRe > 9.9e6 },
    { id: 'outputs', label: 'Comparison evidence is requested', detail: 'Force and surface outputs remain available for CL, CD, Cp, Cf, and yPlus review.', passed: Array.isArray(params.outputs) && params.outputs.length >= 2 },
  ]
}

export function t02Progress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t02Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t02Steps.length) * 100)
}

function identifier(result: unknown, key: string): string {
  const value = record(result)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT02Environment(
  input: { folderId: string; projectName: string },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void = () => undefined,
  fetchAsset: typeof fetch = fetch,
): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  if (![false, true].every((matched) => validateT02Setup(t02Params(matched)).every((check) => check.passed))) throw new Error('The bundled T02 operating conditions failed local similarity checks.')
  const response = await fetchAsset(geometryUrl)
  if (!response.ok) throw new Error('The bundled T02 aircraft Geometry could not be loaded.')
  const form = new FormData()
  form.set('name', input.projectName)
  form.set('source_type', 'geometry')
  form.set('unit', 'm')
  form.set('workflow', 'standard')
  form.set('solver_version', 'release-25.10')
  form.set('folder_id', input.folderId)
  form.set('tags', 'tutorial,T02')
  form.append('files', await response.blob(), 'aircraft.csm')
  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id')
  const geometryId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the T02 Project without returning its Geometry identifiers.')
  onStage('creating-drafts')
  const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T02 baseline · Mach-only ambient condition', patch: t02ConfiguredPatch(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T02 variant · Mach and Reynolds matched', patch: t02ConfiguredPatch(true) }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
