import baselineDocument from '../../../tutorials/T09-nested-rotation/simulation.json'
import nestedPatch from '../../../tutorials/T09-nested-rotation/variants/nested.patch.json'
import geometryUrl from '../../../tutorials/T09-nested-rotation/assets/coaxial-rotor.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t09Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the two-stage rotor problem', summary: 'Decide when one shared rotating frame is insufficient for coaxial stages.' },
  { id: 'roles', label: '02', title: 'Separate surfaces, zones, and motion', summary: 'Give rotor walls, sliding interfaces, and Rotation models distinct responsibilities.' },
  { id: 'topology', label: '03', title: 'Verify nested-zone topology', summary: 'Check registration, containment, clearance, and non-intersection before meshing.' },
  { id: 'experiment', label: '04', title: 'Compose parent and child motion', summary: 'Compare one shared zone with a spherical child rotating relative to its parent.' },
  { id: 'evidence', label: '05', title: 'Define rotating-interface evidence', summary: 'Require mesh, conservation, temporal, wake, and load evidence.' },
  { id: 'run', label: '06', title: 'Create both Case Drafts', summary: 'Create the supplied Geometry Project and synchronize both complete setups.' },
]

export const t09Baseline = baselineDocument as unknown as Record<string, unknown>
export const t09NestedPatch = nestedPatch as unknown as Record<string, unknown>

export const t09ParameterCards = [
  { label: 'Outer zone radius', value: '2.2 m', provenance: 'adapted', why: 'Encloses both rotor stages in the shared-frame baseline and the child sphere in the nested variant.' },
  { label: 'Inner sphere radius', value: '1.1 m', provenance: 'adapted', why: 'Separates the inner-stage mesh while remaining inside the outer cylinder.' },
  { label: 'Outer speed', value: '+200 rpm', provenance: 'adapted', why: 'Defines the parent frame and the shared speed in the baseline.' },
  { label: 'Inner relative speed', value: '−500 rpm', provenance: 'adapted', why: 'Defines counter-rotation relative to the outer parent, not relative to the laboratory.' },
  { label: 'Inner absolute speed', value: '−300 rpm', provenance: 'derived', why: 'For coaxial signed speeds, +200 + (−500) = −300 rpm.' },
  { label: 'Time step', value: '0.001 s', provenance: 'adapted', why: 'Advances the outer zone 1.2° and the child 3.0° relative to its parent each step.' },
]

export const t09Evidence = [
  { title: 'Every rotating entity resolves', detail: 'The outer Cylinder, inner Sphere, wake Cylinder, and center Slice each appear exactly once in the Draft entity catalog.' },
  { title: 'Interfaces contain without cutting', detail: 'The inner sphere remains inside the outer cylinder, and neither interface intersects a rotor surface.' },
  { title: 'The motion tree matches the mechanism', detail: 'The child Rotation references the outer Cylinder and produces −300 rpm absolute inner-stage speed.' },
  { title: 'Angular advance is resolved', detail: 'Interface motion and blade-passing loads remain stable after a smaller-time-step comparison.' },
  { title: 'Flux, wake, and loads cross the interface cleanly', detail: 'Conservation and field continuity accompany stable rotor force and moment histories.' },
]

export const t09Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Separate a rotor surface, a rotating mesh volume, and a solver motion model.',
    'Verify registered entities, geometric containment, and interface clearance.',
    'Compose signed parent and child angular velocities in a common frame.',
    'Accept rotating-zone results only after topology, temporal, conservation, wake, and load evidence passes.',
  ],
  cfdConcepts: [
    { id: 'interface', title: 'Sliding interfaces separate motion descriptions', explanation: 'Adjacent meshes can follow different rigid motions while exchanging fluxes across their common interface.', misconception: 'Rotating a wall surface does not create a rotating fluid volume.' },
    { id: 'hierarchy', title: 'Nested motion is relative motion', explanation: 'For coaxial axes, the child laboratory-frame speed is the signed sum of parent and relative speeds.', misconception: 'The child value is always its absolute angular speed.' },
    { id: 'timestep', title: 'Angular advance sets temporal resolution', explanation: 'The fastest relative rotation and blade-passing physics determine how small the physical step must be.', misconception: 'Schema-valid time stepping is automatically accurate.' },
  ],
  flow360Concepts: [
    { id: 'volume', title: 'RotationVolume builds a cylindrical sliding zone', explanation: 'A registered Cylinder defines its interface while enclosed surfaces identify the solids moving with that zone.', misconception: 'The deprecated RotationCylinder is the preferred current API.' },
    { id: 'sphere', title: 'RotationSphere builds the spherical child zone', explanation: 'A registered Sphere and explicit circumferential spacing define the nested interface.', misconception: 'A Sphere embedded only in parameters is valid without a Draft entity registration.' },
    { id: 'parent', title: 'Rotation.parent_volume declares frame hierarchy', explanation: 'The inner Rotation points to the outer Cylinder so Flow360 interprets −500 rpm relative to the +200 rpm parent.', misconception: 'Geometric nesting alone establishes solver motion hierarchy.' },
  ],
  derivations: [
    { id: 'absolute', parameter: 'Inner absolute angular speed', basis: 'Both axes are coaxial and use one signed convention.', calculation: 'ωabs = +200 + (−500) = −300 rpm', transfer: 'For non-coaxial axes, transform angular-velocity vectors into a common frame before adding.' },
    { id: 'outer-step', parameter: 'Outer advance per step', basis: 'Use 200 rpm and Δt = 0.001 s.', calculation: '200 × 360/60 × 0.001 = 1.2° per step', transfer: 'Repeat with a smaller step and compare phase and integrated loads.' },
    { id: 'child-step', parameter: 'Child relative advance per step', basis: 'Use |−500| rpm and Δt = 0.001 s.', calculation: '500 × 360/60 × 0.001 = 3.0° per step', transfer: 'Screen the fastest relative motion and relevant blade-passing frequency.' },
  ],
  experiments: [{ id: 'nested', prediction: 'What changes when the inner stage receives a spherical child zone with parent-linked motion?', options: ['The outer stage stays at +200 rpm and the inner absolute speed becomes −300 rpm', 'Both stages stop because opposite signs cancel'], controlledVariable: 'Geometry, farfield, outer zone, wake refinement, flow condition, time step, solver, and outputs remain fixed.', observation: 'Compare entity registration, interface topology, motion hierarchy, angular advance, mesh quality, flux conservation, wake continuity, and rotor loads.' }],
  failureModes: [
    { id: 'dangling', symptom: 'A rotation or refinement refers to an entity absent from the Draft catalog.', cause: 'The entity was copied from a stale parameter snapshot.', correction: 'Register the exact Cylinder or Sphere ID before synchronizing the Case Draft.' },
    { id: 'overlap', symptom: 'An interface crosses a blade or its parent boundary.', cause: 'Zone size, center, or height does not provide clearance.', correction: 'Inspect orthogonal sections and resize or reposition the interface.' },
    { id: 'parent', symptom: 'The inner stage rotates in the wrong frame.', cause: 'parent_volume is missing or points to the wrong zone.', correction: 'Reference the registered outer Cylinder and verify the displayed motion tree.' },
    { id: 'timestep', symptom: 'Loads show phase error or aliasing.', cause: 'Angular advance is too large for interface and blade-passing physics.', correction: 'Reduce the time step and demonstrate temporal convergence.' },
  ],
  evidenceRubric: [
    { id: 'catalog', observation: 'Draft entity catalog', pass: 'All four tutorial volume and slice IDs resolve exactly once.', fail: 'Any referenced entity is absent, duplicated, or stale.' },
    { id: 'topology', observation: 'Interface topology', pass: 'The inner sphere is inside the outer cylinder and neither interface cuts a rotor.', fail: 'Interfaces cross each other or a solid surface.' },
    { id: 'hierarchy', observation: 'Motion hierarchy', pass: 'The child names the outer Cylinder as parent and signed speeds yield −300 rpm absolute.', fail: 'The child lacks the correct parent or is read as −500 rpm absolute.' },
    { id: 'temporal', observation: 'Angular advance', pass: '1.2° outer and 3.0° child-relative steps pass a smaller-step comparison.', fail: 'The fastest motion is undersampled or untested.' },
    { id: 'result', observation: 'Interface and rotor results', pass: 'Flux, wake, force, and moment histories remain continuous and stable.', fail: 'Interface discontinuities or unresolved load drift remain.' },
  ],
  transferQuestions: [
    { prompt: 'When is one RotationVolume enough?', expected: 'When all enclosed surfaces share one rigid motion and no child reference frame is required.' },
    { prompt: 'How are non-coaxial parent and child speeds combined?', expected: 'Transform both angular-velocity vectors into a common frame, then add vectors rather than scalar rpm.' },
  ],
}

export function t09Params(nested: boolean): Record<string, unknown> {
  return nested ? mergeTutorialPatch(t09Baseline, t09NestedPatch) as Record<string, unknown> : t09Baseline
}

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function stored(value: unknown) { const values = record(value).stored_entities; return Array.isArray(values) ? values.map(record) : [] }
function draftEntities(params: Record<string, unknown>) { const values = record(record(params.private_attribute_asset_cache).project_entity_info).draft_entities; return Array.isArray(values) ? values.map(record) : [] }
function quantity(value: unknown) { return Number(record(value).value) }
const outerId = '90000000-0000-4000-8000-000000000901'
const innerId = '90000000-0000-4000-8000-000000000902'
const wakeId = '90000000-0000-4000-8000-000000000903'
const sliceId = '90000000-0000-4000-8000-000000000904'

export function t09ConfiguredPatch(nested: boolean): Record<string, unknown> {
  const params = t09Params(nested); const cache = record(params.private_attribute_asset_cache)
  return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher, project_entity_info: { draft_entities: draftEntities(params) } } }
}

export function validateT09Setup(params: Record<string, unknown>): SetupCheck[] {
  const meshing = record(params.meshing)
  const zones = Array.isArray(meshing.volume_zones) ? meshing.volume_zones.map(record) : []
  const outerZone = zones.find((zone) => zone.type === 'RotationVolume') || {}
  const innerZone = zones.find((zone) => zone.type === 'RotationSphere')
  const rotations = (Array.isArray(params.models) ? params.models.map(record) : []).filter((model) => model.type === 'Rotation')
  const outerMotion = rotations.find((model) => model.name === 'Outer stage rotation') || {}
  const innerMotion = rotations.find((model) => model.name === 'Inner relative rotation')
  const registered = draftEntities(params)
  const counts = new Map<string, number>(); registered.forEach((item) => { const id = String(item.private_attribute_id); counts.set(id, (counts.get(id) || 0) + 1) })
  const registeredAll = [outerId, innerId, wakeId, sliceId].every((id) => counts.get(id) === 1)
  const outer = registered.find((item) => item.private_attribute_id === outerId) || {}
  const inner = registered.find((item) => item.private_attribute_id === innerId) || {}
  const outerRadius = quantity(outer.outer_radius); const innerRadius = quantity(inner.radius)
  const innerCenter = record(inner.center).value; const offset = Array.isArray(innerCenter) ? Math.abs(Number(innerCenter[0])) : Number.POSITIVE_INFINITY
  const outerSpeed = quantity(record(outerMotion.spec).value)
  const innerSpeed = innerMotion ? quantity(record(innerMotion.spec).value) : undefined
  const parentId = innerMotion ? record(innerMotion.parent_volume).private_attribute_id : undefined
  const outerEntityId = stored(outerZone.entities)[0]?.private_attribute_id
  const innerEntityId = innerZone ? stored(innerZone.entities)[0]?.private_attribute_id : undefined
  return [
    { id: 'catalog', label: 'All analytic entities are registered', detail: 'Outer Cylinder, inner Sphere, wake Cylinder, and center Slice each resolve exactly once.', passed: registeredAll },
    { id: 'outer-zone', label: 'The outer cylindrical interface is explicit', detail: 'RotationVolume uses the registered 2.2 m Cylinder and defines axial, radial, and circumferential spacing.', passed: outerEntityId === outerId && quantity(outerZone.spacing_axial) > 0 && quantity(outerZone.spacing_radial) > 0 && quantity(outerZone.spacing_circumferential) > 0 },
    { id: 'containment', label: 'The child sphere fits inside its parent', detail: 'The 1.1 m sphere at x = −0.3 m remains within the 2.2 m outer radius with clearance.', passed: innerRadius > 0 && outerRadius > innerRadius + offset },
    { id: 'strategy', label: innerZone ? 'Nested spherical interface is connected' : 'Single-zone baseline is isolated', detail: innerZone ? 'RotationSphere uses the registered child Sphere and adds one child motion.' : 'Both stages share one RotationVolume and one Rotation model.', passed: innerZone ? innerEntityId === innerId && rotations.length === 2 : zones.filter((zone) => zone.type === 'RotationSphere').length === 0 && rotations.length === 1 },
    { id: 'motion', label: innerMotion ? 'Parent-relative motion is explicit' : 'Shared parent motion is explicit', detail: innerMotion ? '+200 rpm parent and −500 rpm relative child yield −300 rpm absolute.' : 'Both rotor surface groups are enclosed by the +200 rpm outer zone.', passed: outerSpeed === 200 && (innerMotion ? innerSpeed === -500 && parentId === outerId : stored(outerZone.enclosed_entities).length === 2) },
  ]
}

export function t09Progress(completed: string[]): number { const unique = new Set(completed.filter((id) => t09Steps.some((step) => step.id === id))); return Math.round((unique.size / t09Steps.length) * 100) }
function identifier(result: unknown, key: string): string { const value = record(result)[key]; return typeof value === 'string' ? value.trim() : '' }

export async function createT09Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  if (![false, true].every((nested) => validateT09Setup(t09Params(nested)).every((check) => check.passed))) throw new Error('The bundled T09 parameters contain an invalid entity, interface, or motion-hierarchy contract.')
  const response = await fetchAsset(geometryUrl); if (!response.ok) throw new Error('The bundled T09 coaxial-rotor Geometry could not be loaded.')
  const form = new FormData(); form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T09'); form.append('files', await response.blob(), 'coaxial-rotor.csm')
  const staged = await client.stageImport(form); const approved = await client.approveImport(staged.id); onStage('creating-project')
  const submitted = await client.runImport(approved.id, true); const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the T09 Project without returning its Geometry identifiers.')
  onStage('creating-drafts')
  const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T09 baseline · shared rotating zone', patch: t09ConfiguredPatch(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T09 variant · nested rotating zones', patch: t09ConfiguredPatch(true) }),
  ])
  onStage('ready'); return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
