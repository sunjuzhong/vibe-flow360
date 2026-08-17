import baselineDocument from '../../../tutorials/T08-automotive-wind-tunnel/simulation.json'
import movingGroundPatch from '../../../tutorials/T08-automotive-wind-tunnel/variants/moving-ground.patch.json'
import geometryUrl from '../../../tutorials/T08-automotive-wind-tunnel/assets/automotive.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t08Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the road-relative problem', summary: 'Connect the vehicle-fixed reference frame to road and wheel surface motion.' },
  { id: 'tunnel', label: '02', title: 'Build the analytic wind tunnel', summary: 'Review blockage, boundary distances, floor elevation, and wake recovery.' },
  { id: 'kinematics', label: '03', title: 'Derive rolling-wheel motion', summary: 'Calculate belt speed, wheel angular speed, centers, axes, and signs.' },
  { id: 'experiment', label: '04', title: 'Compare floor models', summary: 'Hold geometry and flow fixed while switching StaticFloor to WheelBelts.' },
  { id: 'evidence', label: '05', title: 'Define acceptance evidence', summary: 'Review boundary ownership, mesh, velocity vectors, convergence, and forces.' },
  { id: 'run', label: '06', title: 'Create both Case Drafts', summary: 'Create the supplied Geometry Project and synchronize both complete setups.' },
]

export const t08Baseline = baselineDocument as unknown as Record<string, unknown>
export const t08MovingPatch = movingGroundPatch as unknown as Record<string, unknown>

export const t08ParameterCards = [
  { label: 'Tunnel section', value: '12 m × 5 m', provenance: 'adapted', why: 'Gives a 60 m² test section for the first blockage screen.' },
  { label: 'Blockage screen', value: '2.17 / 60 = 3.6%', provenance: 'derived', why: 'Flags when tunnel walls may accelerate flow and bias force correlation.' },
  { label: 'Vehicle speed', value: '40 m/s', provenance: 'adapted', why: 'Sets air speed and the road speed in the stationary-vehicle reference frame.' },
  { label: 'Rolling radius', value: '0.32 m', provenance: 'provided', why: 'Converts road speed into the required tyre angular velocity.' },
  { label: 'Wheel speed', value: '±125 rad/s', provenance: 'derived', why: 'Opposite signs are required because every wheel axis is expressed as +y.' },
  { label: 'Wake recovery', value: '13.05 m', provenance: 'derived', why: 'Separates the vehicle rear from the outlet for downstream recovery review.' },
]

export const t08Evidence = [
  { title: 'Every boundary has one owner', detail: 'Tunnel, floor patches, car body, and each wheel surface have exactly one compatible boundary model.' },
  { title: 'Contact-patch velocity is correct', detail: 'Belts move at 40 m/s and the bottom of every tyre moves with the road rather than against it.' },
  { title: 'Wheel and floor-gap cells survive', detail: 'Tyre curvature, near-ground clearance, wall layers, and belt edges remain continuous and acceptable.' },
  { title: 'The wake recovers before the outlet', detail: 'Velocity deficit and pressure gradients no longer encounter an abruptly coarse or nearby outlet.' },
  { title: 'Force differences have field evidence', detail: 'Both cases converge and drag or lift deltas agree with underbody, tyre, pressure, and shear changes.' },
]

export const t08Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Explain road and wheel motion in the stationary-vehicle reference frame.',
    'Choose a Flow360 floor model that represents the intended wind-tunnel facility.',
    'Derive and verify the signed angular velocity of all four wheels.',
    'Accept a force comparison only after mesh, kinematic, convergence, and field evidence passes.',
  ],
  cfdConcepts: [
    { id: 'relative', title: 'The road moves in the vehicle-fixed frame', explanation: 'Incoming air and the road travel at vehicle speed while the vehicle geometry remains stationary.', misconception: 'A stationary numerical floor does not reproduce on-road underbody shear.' },
    { id: 'rolling', title: 'Rolling couples translation and rotation', explanation: 'No-slip rolling requires |ω| = U/R and a sign that makes tread velocity at the contact patch match the road.', misconception: 'The same signed angular velocity on a common +y axis makes one side rotate backward.' },
    { id: 'blockage', title: 'The tunnel is part of the experiment', explanation: 'Side walls, ceiling, inlet distance, and outlet recovery can change pressure and force levels.', misconception: 'An automatically generated tunnel is not automatically suitable for correlation.' },
  ],
  flow360Concepts: [
    { id: 'farfield', title: 'WindTunnelFarfield generates facility boundaries', explanation: 'Dimensions and floor type create named inlet, outlet, side, ceiling, floor, and belt ghost surfaces.', misconception: 'It cannot infer which physical wind-tunnel installation the study intends to represent.' },
    { id: 'floor', title: 'Floor models represent different facilities', explanation: 'StaticFloor, FullyMovingFloor, CentralBelt, and WheelBelts create different road-surface partitions.', misconception: 'A central belt, wheel belts, and a fully moving road are not interchangeable.' },
    { id: 'rotation', title: 'WallRotation moves the tyre surface', explanation: 'Each tyre uses its own center and signed angular velocity; WheelBelts only define moving floor patches.', misconception: 'Adding wheel belts does not rotate the tyres.' },
  ],
  derivations: [
    { id: 'omega', parameter: 'Wheel angular speed', basis: 'Use U = 40 m/s and rolling radius R = 0.32 m.', calculation: '|ω| = U/R = 40/0.32 = 125 rad/s ≈ 1194 rpm', transfer: 'Use loaded rolling radius and verify the actual contact-patch velocity vector.' },
    { id: 'blockage', parameter: 'Blockage screen', basis: 'Compare reference frontal area 2.17 m² with the 12 m × 5 m test section.', calculation: '2.17/60 = 0.036 = 3.6%', transfer: 'Use actual projected area and the correction method required by the facility.' },
    { id: 'recovery', parameter: 'Outlet recovery length', basis: 'The vehicle rear is at x = 1.95 m and the outlet is at x = 15 m.', calculation: '15 − 1.95 = 13.05 m', transfer: 'Extend the outlet if unresolved velocity deficit or pressure gradients reach it.' },
  ],
  experiments: [{ id: 'ground', prediction: 'What changes when the road and wheels move while geometry, tunnel, mesh, and air speed remain fixed?', options: ['Underbody shear and wheel wakes change while blockage stays fixed', 'The tunnel section and reference area change'], controlledVariable: 'Geometry, tunnel dimensions, 40 m/s operating condition, reference values, mesh controls, wake box, solver, and outputs remain fixed.', observation: 'Compare contact-patch vectors, underbody velocity, wheel wakes, Cp, Cf, yPlus, convergence, drag, and lift balance.' }],
  failureModes: [
    { id: 'sign', symptom: 'One side has tyre tread moving against the road.', cause: 'All wheels received the same sign on a common +y axis.', correction: 'Reverse the opposite-side signs and inspect contact-patch velocity vectors.' },
    { id: 'overlap', symptom: 'A ground patch has conflicting wall conditions.', cause: 'Ghost surfaces not valid for the selected floor type were assigned.', correction: 'Use only the floor, belt, and friction-patch surfaces emitted by that floor model.' },
    { id: 'tunnel', symptom: 'Wall acceleration or an outlet-truncated wake biases forces.', cause: 'The tunnel section or recovery length is insufficient.', correction: 'Increase the relevant dimension and repeat the controlled comparison.' },
    { id: 'mesh', symptom: 'Wheel-flow changes are erratic across mesh levels.', cause: 'Tyre curvature, floor clearance, layers, or wake spacing are unresolved.', correction: 'Refine those regions and demonstrate field and force convergence.' },
  ],
  evidenceRubric: [
    { id: 'ownership', observation: 'Boundary ownership', pass: 'Every tunnel, floor, body, and wheel surface has one compatible physical model.', fail: 'Any surface is unassigned, duplicated, or incompatible with the selected floor type.' },
    { id: 'velocity', observation: 'Road and wheel velocity', pass: 'Belts move at 40 m/s and every tyre contact patch matches the road direction.', fail: 'A belt is stationary or a tyre tread moves against the road.' },
    { id: 'extent', observation: 'Blockage and recovery', pass: 'Blockage is reported and the wake recovers before the outlet without wall contamination.', fail: 'Side or ceiling acceleration dominates or an unresolved wake reaches the outlet.' },
    { id: 'mesh', observation: 'Wheel and wake mesh', pass: 'Tyres, clearances, layers, belts, and wake cells remain continuous with acceptable quality.', fail: 'Contact cells collapse, tyres facet, or abrupt growth erases the wake.' },
    { id: 'force', observation: 'Comparable forces', pass: 'Both cases converge and force deltas agree with underbody and wheel-flow evidence.', fail: 'An unconverged scalar delta is reported without field or mesh support.' },
  ],
  transferQuestions: [
    { prompt: 'When should FullyMovingFloor replace WheelBelts?', expected: 'Use it when the physical facility or on-road idealization moves the entire floor instead of discrete belts.' },
    { prompt: 'What changes after selecting a different tyre radius?', expected: 'Recompute ω = U/R, update centers or belt extents as needed, and recheck contact-patch velocity and clearance.' },
  ],
}

export function t08Params(movingGround: boolean): Record<string, unknown> {
  return movingGround ? mergeTutorialPatch(t08Baseline, t08MovingPatch) as Record<string, unknown> : t08Baseline
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function entities(value: unknown) {
  const stored = record(value).stored_entities
  return Array.isArray(stored) ? stored.map(record) : []
}

function draftEntities(params: Record<string, unknown>) {
  const value = record(record(params.private_attribute_asset_cache).project_entity_info).draft_entities
  return Array.isArray(value) ? value.map(record) : []
}

export function t08ConfiguredPatch(movingGround: boolean): Record<string, unknown> {
  const params = t08Params(movingGround)
  const cache = record(params.private_attribute_asset_cache)
  return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher, use_geometry_AI: cache.use_geometry_AI, project_entity_info: { draft_entities: draftEntities(params) } } }
}

export function validateT08Setup(params: Record<string, unknown>): SetupCheck[] {
  const meshing = record(params.meshing)
  const zones = Array.isArray(meshing.volume_zones) ? meshing.volume_zones.map(record) : []
  const tunnel = zones.find((zone) => zone.type === 'WindTunnelFarfield') || {}
  const floor = record(tunnel.floor_type)
  const models = Array.isArray(params.models) ? params.models.map(record) : []
  const road = models.find((model) => model.name === 'Road system') || {}
  const roadVelocity = record(road.velocity).value
  const rotations = models.map((model) => record(model.velocity)).filter((velocity) => velocity.type_name === 'WallRotation')
  const speeds = rotations.map((velocity) => Number(record(velocity.angular_velocity).value))
  const refinements = Array.isArray(meshing.refinements) ? meshing.refinements.map(record) : []
  const wake = refinements.find((item) => item.refinement_type === 'UniformRefinement')
  const wakeIds = new Set(entities(record(wake).entities).map((item) => String(item.private_attribute_id)))
  const registered = new Set(draftEntities(params).map((item) => String(item.private_attribute_id)))
  const moving = floor.type_name === 'WheelBelts'
  return [
    { id: 'tunnel', label: 'Analytic tunnel dimensions are explicit', detail: 'Width 12 m, height 5 m, inlet −8 m, outlet 15 m, and floor z = 0 m are serialized.', passed: Number(record(tunnel.width).value) === 12 && Number(record(tunnel.height).value) === 5 && Number(record(tunnel.inlet_x_position).value) === -8 && Number(record(tunnel.outlet_x_position).value) === 15 },
    { id: 'geometry-ai', label: 'Wind-tunnel generation is enabled', detail: 'Geometry AI and geometry accuracy are present for WindTunnelFarfield.', passed: record(params.private_attribute_asset_cache).use_geometry_AI === true && Number(record(record(meshing.defaults).geometry_accuracy).value) > 0 },
    { id: 'wake', label: 'Wake refinement is registered', detail: 'The wake Box appears in both UniformRefinement and the Draft entity catalog.', passed: wakeIds.size === 1 && [...wakeIds].every((id) => registered.has(id)) },
    { id: 'floor', label: moving ? 'Wheel-belt floor is selected' : 'Static-floor baseline is selected', detail: moving ? 'Central, front-wheel, and rear-wheel belt extents are defined.' : 'A finite friction patch represents the stationary-floor facility.', passed: moving ? floor.type_name === 'WheelBelts' : floor.type_name === 'StaticFloor' },
    { id: 'motion', label: moving ? 'Road and wheel kinematics are complete' : 'Stationary-motion baseline is isolated', detail: moving ? 'Road velocity is 40 m/s and four wheel rotations use ±125 rad/s.' : 'Road and all wheel walls omit prescribed velocity.', passed: moving ? Array.isArray(roadVelocity) && Number(roadVelocity[0]) === 40 && rotations.length === 4 && speeds.filter((value) => value === 125).length === 2 && speeds.filter((value) => value === -125).length === 2 : road.velocity === undefined && rotations.length === 0 },
  ]
}

export function t08Progress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t08Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t08Steps.length) * 100)
}

function identifier(result: unknown, key: string): string {
  const value = record(result)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT08Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  if (![false, true].every((moving) => validateT08Setup(t08Params(moving)).every((check) => check.passed))) throw new Error('The bundled T08 parameters contain an invalid tunnel, wake, floor, or wheel-motion contract.')
  const response = await fetchAsset(geometryUrl)
  if (!response.ok) throw new Error('The bundled T08 automotive Geometry could not be loaded.')
  const form = new FormData()
  form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T08')
  form.append('files', await response.blob(), 'automotive.csm')
  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the T08 Project without returning its Geometry identifiers.')
  onStage('creating-drafts')
  const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T08 baseline · stationary floor', patch: t08ConfiguredPatch(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T08 variant · moving ground and wheels', patch: t08ConfiguredPatch(true) }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
