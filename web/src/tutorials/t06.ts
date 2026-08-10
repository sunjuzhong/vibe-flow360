import baselineDocument from '../../../tutorials/T06-farfield-selection/simulation.json'
import compactAutoPatch from '../../../tutorials/T06-farfield-selection/variants/compact-auto.patch.json'
import manualDomainPatch from '../../../tutorials/T06-farfield-selection/variants/manual-domain.patch.json'
import automaticGeometryUrl from '../../../tutorials/T06-farfield-selection/assets/sphere-body.csm?url'
import manualGeometryUrl from '../../../tutorials/T06-farfield-selection/assets/manual-domain.csm?url'
import {
  mergeTutorialPatch,
  type SetupCheck,
  type TutorialEnvironmentClient,
  type TutorialEnvironmentResult,
  type TutorialEnvironmentStage,
  type TutorialStep,
} from './t01'
import type { TutorialPedagogy } from './pedagogy'

export type T06Strategy = 'automatic' | 'compact' | 'manual'

export const t06Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the boundary decision', summary: 'Connect outer-domain placement to drag, pressure recovery, and wake development.' },
  { id: 'topology', label: '02', title: 'Classify the CAD topology', summary: 'Distinguish body-only geometry from a closed external fluid volume.' },
  { id: 'setup', label: '03', title: 'Map each topology to Flow360', summary: 'Configure automatic generation, enclosed zones, or a supplied domain.' },
  { id: 'variant', label: '04', title: 'Test boundary distance', summary: 'Compare a 20D automatic baseline with an 8D compact candidate.' },
  { id: 'evidence', label: '05', title: 'Review domain evidence', summary: 'Check topology, registration, blockage, distance, and mesh growth.' },
  { id: 'run', label: '06', title: 'Create the selected environment', summary: 'Upload the matching CAD contract and synchronize its VolumeMesh Drafts.' },
]

export const t06Baseline = baselineDocument as unknown as Record<string, unknown>
export const t06CompactPatch = compactAutoPatch as unknown as Record<string, unknown>
export const t06ManualPatch = manualDomainPatch as unknown as Record<string, unknown>

export const t06ParameterCards = [
  { label: 'Body diameter', value: 'D = 1 m', provenance: 'provided', why: 'Normalizes every boundary distance and the projected blockage calculation.' },
  { label: 'Automatic baseline', value: 'relative size 20D', provenance: 'inferred', why: 'Places a generated outer sphere well beyond the body disturbance for the baseline review.' },
  { label: 'Compact candidate', value: 'relative size 8D', provenance: 'inferred', why: 'Reduces domain cells and exposes whether the engineering outputs are boundary-sensitive.' },
  { label: 'Manual streamwise reach', value: '10D upstream · 25D downstream', provenance: 'derived', why: 'Reserves more distance for wake recovery than for the undisturbed inflow.' },
  { label: 'Manual lateral reach', value: '12D per side', provenance: 'derived', why: 'Gives a 24D by 24D cross-section and approximately 0.136% projected blockage.' },
  { label: 'Rotor service volume', value: '6D long · 1.5D radius', provenance: 'provided', why: 'Exercises the requirement that a registered CustomVolume remains inside the automatic farfield.' },
]

export const t06Evidence = [
  { title: 'CAD topology matches the strategy', detail: 'Automatic uses body-only CAD; manual uses one watertight external fluid volume.' },
  { title: 'Nested entities are registered', detail: 'The rotor CustomVolume and bounding Cylinder IDs resolve through project_entity_info.draft_entities.' },
  { title: 'Distances and blockage are documented', detail: 'Upstream, downstream, lateral, and projected-area ratios use the same one-metre reference diameter.' },
  { title: 'Outer mesh growth is smooth', detail: 'Cells expand toward the farfield without abrupt jumps or avoidable low-quality regions.' },
  { title: 'Domain sensitivity is bounded', detail: 'Drag, pressure, and wake differences between accepted domains stay within the declared tolerance.' },
]

export const t06Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Explain how outer-boundary proximity can alter blockage, pressure recovery, and wake development.',
    'Choose AutomatedFarfield or UserDefinedFarfield from the actual Geometry topology.',
    'Accept a domain only after topology, registration, distance, blockage, mesh, and output checks.',
  ],
  cfdConcepts: [
    { id: 'interference', title: 'The outer boundary is part of the numerical model', explanation: 'A nearby boundary constrains streamlines, changes pressure recovery, and may force the wake into coarse cells while strong gradients remain.', misconception: 'A freestream label does not make boundary position irrelevant.' },
    { id: 'shape', title: 'Domain shape follows the disturbance', explanation: 'External domains often need less upstream reach than downstream wake reach, while lateral area controls projected blockage.', misconception: 'Equal distance in every direction is not required when an asymmetric domain passes sensitivity checks.' },
  ],
  flow360Concepts: [
    { id: 'contracts', title: 'The two farfield objects require different CAD contracts', explanation: 'AutomatedFarfield generates a domain around body-only CAD. UserDefinedFarfield meshes inside a watertight fluid volume already present in the uploaded geometry.', misconception: 'Changing only the parameter type cannot turn solid-body CAD into a fluid domain.' },
    { id: 'enclosed', title: 'Enclosed CustomVolume objects must be registered', explanation: 'The automatic domain includes the rotor service CustomVolume, whose own ID and bounding Cylinder ID both appear in project_entity_info.draft_entities.', misconception: 'Flow360 25.10 does not allow an arbitrary Cylinder directly in enclosed_entities; it must define an associated CustomVolume.' },
    { id: 'domain-type', title: 'Standard meshing infers full versus half domain', explanation: 'Because this Geometry crosses y = 0, the standard workflow infers a full domain from its bounding box.', misconception: 'Explicit domain_type is allowed only when both GAI surface meshing and beta volume meshing are active in Flow360 25.10.' },
  ],
  derivations: [
    { id: 'distance', parameter: 'Manual-domain distances', basis: 'All extents use the one-metre body diameter D as the characteristic length.', calculation: 'upstream = 10D · downstream = 25D · lateral = 12D', transfer: 'Multiply the ratios by a new characteristic length and extend the wake side to cover the requested outputs.' },
    { id: 'blockage', parameter: 'Projected blockage', basis: 'Compare the sphere projected area with the 24D by 24D domain cross-section.', calculation: 'β = (πD²/4)/(24D × 24D) = 0.00136 = 0.136%', transfer: 'Use the largest relevant projected area for a different body or incidence.' },
    { id: 'sensitivity', parameter: 'Automatic farfield size', basis: 'Only the generated domain radius changes between the two automatic Drafts.', calculation: '(20D − 8D)/20D = 60% radius reduction', transfer: 'Accept a smaller domain only after matched mesh and result evidence remains within tolerance.' },
  ],
  experiments: [{ id: 'distance', prediction: 'What is the likely effect of moving the generated boundary from 20D to 8D?', options: ['Lower cell cost with possible drag and wake sensitivity', 'A mandatory reduction in first-layer thickness'], controlledVariable: 'Only AutomatedFarfield.relative_size changes; the Geometry, rotor zone, and meshing defaults stay fixed.', observation: 'Compare boundary distance, mesh growth, drag coefficient, surface pressure, and wake velocity deficit.' }],
  failureModes: [
    { id: 'topology', symptom: 'UserDefinedFarfield is selected but no closed fluid region exists.', cause: 'A body-only CAD was uploaded for a workflow that meshes inside a supplied volume.', correction: 'Upload the watertight fluid-domain asset or return to AutomatedFarfield and rerun preflight.' },
    { id: 'close', symptom: 'Drag changes when the boundary is enlarged or wake gradients reach the domain edge.', cause: 'The domain is too compact for the disturbance and requested downstream evidence.', correction: 'Increase the affected distance and repeat a controlled domain-sensitivity comparison.' },
    { id: 'entity', symptom: 'Preflight reports a dangling enclosed entity.', cause: 'The CustomVolume or its bounding Cylinder is missing from the Draft entity catalog.', correction: 'Register both matching IDs and types, save, and rerun preflight before meshing.' },
    { id: 'layers', symptom: 'Boundary layers grow unintentionally from manual outer-domain faces.', cause: 'Spacing behavior on the supplied farfield surfaces was not reviewed.', correction: 'Assign the intended outer-surface treatment and inspect the generated volume mesh.' },
  ],
  evidenceRubric: [
    { id: 'topology', observation: 'Geometry topology', pass: 'The selected farfield object matches body-only or fluid-volume CAD.', fail: 'The parameter object and imported topology describe different domains.' },
    { id: 'registration', observation: 'Draft entity registration', pass: 'CustomVolume and Cylinder IDs and types match the Draft entity catalog.', fail: 'Either entity is absent, duplicated, or mismatched.' },
    { id: 'distance', observation: 'Distance and blockage', pass: 'Normalized distances cover the disturbance and projected blockage is documented.', fail: 'A strong gradient reaches a boundary or the governing projection was not checked.' },
    { id: 'sensitivity', observation: 'Domain-size sensitivity', pass: 'Matched drag, pressure, and wake evidence stays within tolerance.', fail: 'The conclusion changes with boundary position or more than one variable changed.' },
    { id: 'mesh', observation: 'Outer volume mesh', pass: 'Cell growth is smooth and the wake remains resolved before the boundary.', fail: 'Abrupt growth, poor cells, or unresolved gradients occur near the boundary.' },
  ],
  transferQuestions: [
    { prompt: 'What changes when a required wake probe moves from 10D to 30D downstream?', expected: 'Extend the downstream domain beyond the probe and remaining gradients, then repeat mesh and sensitivity checks.' },
    { prompt: 'Why is 0.136% blockage not sufficient evidence by itself?', expected: 'It does not prove adequate wake reach, topology, boundary assignment, mesh transition, or result independence.' },
  ],
}

export function t06Params(strategy: T06Strategy): Record<string, unknown> {
  if (strategy === 'compact') return mergeTutorialPatch(t06Baseline, t06CompactPatch) as Record<string, unknown>
  if (strategy === 'manual') return mergeTutorialPatch(t06Baseline, t06ManualPatch) as Record<string, unknown>
  return t06Baseline
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function draftEntities(params: Record<string, unknown>) {
  const cache = record(params.private_attribute_asset_cache)
  const info = record(cache.project_entity_info)
  return Array.isArray(info.draft_entities) ? info.draft_entities.map(record) : []
}

export function t06ConfiguredPatch(strategy: T06Strategy): Record<string, unknown> {
  const params = t06Params(strategy)
  const cache = record(params.private_attribute_asset_cache)
  return {
    ...params,
    private_attribute_asset_cache: {
      use_inhouse_mesher: cache.use_inhouse_mesher,
      project_entity_info: { draft_entities: draftEntities(params) },
    },
  }
}

export function validateT06Setup(params: Record<string, unknown>): SetupCheck[] {
  const meshing = record(params.meshing)
  const zones = Array.isArray(meshing.volume_zones) ? meshing.volume_zones.map(record) : []
  const farfield = zones.find((zone) => ['AutomatedFarfield', 'UserDefinedFarfield'].includes(String(zone.type)))
  const automatic = farfield?.type === 'AutomatedFarfield'
  const registered = draftEntities(params)
  const registeredIds = new Set(registered.map((entity) => String(entity.private_attribute_id || '')))
  const enclosed = record(farfield?.enclosed_entities)
  const enclosedItems = Array.isArray(enclosed.stored_entities) ? enclosed.stored_entities.map(record) : []
  const custom = zones.find((zone) => zone.type === 'CustomZones')
  const rotation = zones.find((zone) => zone.type === 'RotationVolume')
  const relativeSize = Number(farfield?.relative_size)
  return [
    { id: 'farfield', label: 'One farfield strategy is explicit', detail: 'The Draft contains exactly one automatic or user-defined outer-domain object.', passed: zones.filter((zone) => ['AutomatedFarfield', 'UserDefinedFarfield'].includes(String(zone.type))).length === 1 },
    { id: 'topology', label: 'CAD contract is identifiable', detail: automatic ? 'Use the bundled body-only Geometry.' : 'Use the bundled watertight fluid-domain Geometry.', passed: Boolean(farfield) },
    { id: 'entities', label: 'Nested rotor zone is registered', detail: 'CustomVolume and bounding Cylinder IDs resolve through project_entity_info.draft_entities.', passed: registered.length === 2 && registered.every((entity) => registeredIds.has(String(entity.private_attribute_id || ''))) && Boolean(custom && rotation) },
    { id: 'enclosure', label: 'Automatic enclosure is valid', detail: automatic ? 'enclosed_entities contains the registered CustomVolume.' : 'The supplied fluid domain owns the outer boundary.', passed: !automatic || (enclosedItems.length === 1 && registeredIds.has(String(enclosedItems[0].private_attribute_id || ''))) },
    { id: 'size', label: 'Domain extent is reviewable', detail: automatic ? `Generated farfield relative size ${relativeSize}D.` : 'Manual extents are 10D upstream, 25D downstream, and 12D laterally.', passed: automatic ? [8, 20].includes(relativeSize) : true },
  ]
}

export function t06Progress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t06Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t06Steps.length) * 100)
}

function identifier(result: unknown, key: string): string {
  const value = record(result)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT06Environment(
  strategy: 'automatic' | 'manual',
  input: { folderId: string; projectName: string },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void = () => undefined,
  fetchAsset: typeof fetch = fetch,
): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  const selected = strategy === 'manual' ? ['manual'] as const : ['automatic', 'compact'] as const
  const params = selected.map((item) => t06Params(item))
  if (!params.every((item) => validateT06Setup(item).every((check) => check.passed))) {
    throw new Error('The bundled T06 parameters contain an invalid farfield contract or unregistered nested entity.')
  }
  const response = await fetchAsset(strategy === 'manual' ? manualGeometryUrl : automaticGeometryUrl)
  if (!response.ok) throw new Error('The bundled T06 Geometry asset could not be loaded.')
  const form = new FormData()
  form.set('name', input.projectName)
  form.set('source_type', 'geometry')
  form.set('unit', 'm')
  form.set('workflow', 'standard')
  form.set('solver_version', 'release-25.10')
  form.set('folder_id', input.folderId)
  form.set('tags', 'tutorial,T06')
  form.append('files', await response.blob(), strategy === 'manual' ? 'manual-domain.csm' : 'sphere-body.csm')
  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id')
  const geometryId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the tutorial Project without returning its Geometry identifiers.')
  onStage('creating-drafts')
  if (strategy === 'manual') {
    const baselineDraft = await client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T06 manual · CAD-defined external domain', patch: t06ConfiguredPatch('manual') })
    onStage('ready')
    return { projectId, rootResourceId: geometryId, baselineDraft }
  }
  const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T06 baseline · automatic farfield 20D', patch: t06ConfiguredPatch('automatic') }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T06 variant · automatic farfield 8D', patch: t06ConfiguredPatch('compact') }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
