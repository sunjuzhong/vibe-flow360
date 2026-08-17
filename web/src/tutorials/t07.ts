import baselineDocument from '../../../tutorials/T07-internal-flow-meshing/simulation.json'
import featureAwarePatch from '../../../tutorials/T07-internal-flow-meshing/variants/feature-aware.patch.json'
import geometryUrl from '../../../tutorials/T07-internal-flow-meshing/assets/internal-flow.csm?url'
import {
  mergeTutorialPatch,
  type SetupCheck,
  type TutorialEnvironmentClient,
  type TutorialEnvironmentResult,
  type TutorialEnvironmentStage,
  type TutorialStep,
} from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t07Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the pressure-loss problem', summary: 'Connect blockage, wall shear, separation, and outlet recovery to mesh decisions.' },
  { id: 'topology', label: '02', title: 'Identify the fluid volume', summary: 'Distinguish a closed internal passage from solid duct material or external-body CAD.' },
  { id: 'seed', label: '03', title: 'Define the connected fluid zone', summary: 'Place, register, and validate the internal SeedpointVolume.' },
  { id: 'resolution', label: '04', title: 'Preserve loss-generating features', summary: 'Add local obstacle, support, floor-layer, and spacing controls.' },
  { id: 'evidence', label: '05', title: 'Review internal-mesh evidence', summary: 'Check topology, feature survival, layers, quality, wake growth, and outlet recovery.' },
  { id: 'run', label: '06', title: 'Create both mesh Drafts', summary: 'Create the bundled Geometry Project and synchronize two VolumeMesh Drafts.' },
]

export const t07Baseline = baselineDocument as unknown as Record<string, unknown>
export const t07FeaturePatch = featureAwarePatch as unknown as Record<string, unknown>

export const t07ParameterCards = [
  { label: 'Duct envelope', value: '8 m × 4 m × 4 m', provenance: 'provided', why: 'Defines inlet-to-outlet length, cross-sectional area, and the available wake-recovery distance.' },
  { label: 'Sphere blockage', value: '19.6% before supports', provenance: 'derived', why: 'Signals meaningful acceleration and separation that cannot be judged from inlet and outlet meshes alone.' },
  { label: 'Connected-fluid seed', value: '[1, 0, 2] m', provenance: 'provided', why: 'Selects the upstream connected passage while staying away from the sphere and every wall.' },
  { label: 'Global surface edge', value: '1.2 m', provenance: 'adapted', why: 'Provides the deliberately global-only baseline against which feature survival is tested.' },
  { label: 'Obstacle controls', value: 'sphere 0.1 m · supports 0.01 m', provenance: 'adapted', why: 'Keeps a smooth bluff body and multi-element coverage across each 0.2 m support.' },
  { label: 'Outlet recovery', value: '4 m · 2 sphere diameters', provenance: 'derived', why: 'Defines the region in which wake cells must grow smoothly before reaching the outlet.' },
]

export const t07Evidence = [
  { title: 'Only the intended fluid region is meshed', detail: 'The volume is bounded by inlet, outlet, walls, sphere, and supports; no exterior space or solid material appears.' },
  { title: 'The seed owns the connected passage', detail: 'The registered [1, 0, 2] m point creates Primary duct fluid and does not touch a boundary or disconnected pocket.' },
  { title: 'The obstacle and supports survive', detail: 'The sphere remains smooth and all four supports retain continuous multi-element surface coverage.' },
  { title: 'The floor layer remains continuous', detail: 'Layers stay attached and transition gradually onto adjacent faces and the volume core.' },
  { title: 'The wake reaches a reviewable outlet', detail: 'Cell growth is gradual through the four-metre recovery region and quality hotspots are documented.' },
]

export const t07Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Distinguish a closed internal fluid volume from solid duct material and external-body CAD.',
    'Place and validate a SeedpointVolume inside the intended connected passage.',
    'Allocate mesh resolution according to blockage, thin supports, wall shear, and wake recovery.',
    'Accept an internal mesh only after topology, feature, layer, quality, and outlet evidence passes.',
  ],
  cfdConcepts: [
    { id: 'domain', title: 'The computational domain is the fluid volume', explanation: 'Internal-flow meshing fills the connected space through which fluid moves; inlet, outlet, walls, sphere, and supports bound that space.', misconception: 'A closed duct CAD is not automatically valid when it represents solid material instead of the fluid void.' },
    { id: 'blockage', title: 'Blockage creates acceleration and loss', explanation: 'The sphere occupies 19.6 percent of the duct section before supports are counted, creating acceleration, separation, wake mixing, and pressure loss.', misconception: 'A well-resolved inlet and outlet cannot compensate for an unresolved obstruction.' },
    { id: 'directions', title: 'Wall and wake gradients need different controls', explanation: 'BoundaryLayer resolves the wall-normal direction while local surface spacing preserves curvature and thin supports that generate the wake.', misconception: 'Uniform global refinement is not the only defensible way to retain small features and wall layers.' },
  ],
  flow360Concepts: [
    { id: 'domain-path', title: 'UserDefinedFarfield selects the supplied closed domain', explanation: 'For this Geometry it instructs the mesher to use the CAD-defined fluid volume rather than generate an exterior box.', misconception: 'The object name does not turn inlet or outlet into a physical freestream boundary.' },
    { id: 'seed', title: 'SeedpointVolume identifies connected fluid', explanation: 'The point at [1, 0, 2] m is registered in the Draft entity catalog and referenced by the Connected internal fluid CustomZones entry.', misconception: 'A seed placed in the sphere, on a wall, or in another pocket cannot identify the intended passage.' },
    { id: 'controls', title: 'Each refinement has one spatial job', explanation: 'SurfaceRefinement preserves the sphere and supports, BoundaryLayer resolves the floor, and PassiveSpacing controls adjacent transitions.', misconception: 'Valid serialized parameters do not prove that generated supports and layers survived.' },
  ],
  derivations: [
    { id: 'blockage', parameter: 'Sphere blockage ratio', basis: 'Compare the projected sphere area with the 4 m by 4 m duct section.', calculation: 'β = π(1 m)² / 16 m² = 0.196 = 19.6%', transfer: 'Include all obstructions and boundary-layer displacement when applying the calculation to another duct.' },
    { id: 'support', parameter: 'Support edge target', basis: 'Each support is 0.2 m in diameter and must retain multiple surface elements.', calculation: '0.2 m / 0.01 m = 20 nominal edge lengths across one diameter', transfer: 'Scale from the thinnest feature that must influence loss, then verify actual generated facets.' },
    { id: 'recovery', parameter: 'Outlet recovery length', basis: 'The sphere rear is at x=4 m and the outlet is at x=8 m.', calculation: 'Lrecovery = 8 m − 4 m = 4 m = 2 sphere diameters', transfer: 'Extend the domain when the wake or adverse gradients have not recovered before the outlet.' },
  ],
  experiments: [{ id: 'features', prediction: 'What changes when local feature and floor-layer controls are added?', options: ['The sphere and supports gain local facets and the floor gains a controlled layer', 'The outlet moves and the blockage ratio changes'], controlledVariable: 'Only local meshing controls change; CAD, project unit, closed-domain path, seed point, and global defaults remain fixed.', observation: 'Compare identical sections for silhouette, support continuity, floor layers, core transition, wake spacing, quality, and cell count.' }],
  failureModes: [
    { id: 'side', symptom: 'The mesh fills exterior space or solid duct material.', cause: 'The CAD body was interpreted from the wrong side or AutomatedFarfield was applied to an already supplied fluid volume.', correction: 'Confirm the fluid body and use the closed-domain path without an automatic exterior domain.' },
    { id: 'seed', symptom: 'The named internal zone is absent or appears in another pocket.', cause: 'The seed lies on a boundary, inside the sphere, or in disconnected fluid.', correction: 'Move it safely inside the intended passage and verify the coordinate against CAD bounds.' },
    { id: 'supports', symptom: 'Supports disappear, pinch, or merge into the sphere.', cause: 'The global mesh does not resolve the 0.2 m diameter features.', correction: 'Apply support-specific surface spacing and inspect the surface mesh before volume meshing.' },
    { id: 'outlet', symptom: 'Strong gradients or recirculation reach the outlet plane.', cause: 'The recovery length or wake resolution is insufficient.', correction: 'Extend or refine downstream, then verify that the outlet no longer truncates unresolved flow.' },
  ],
  evidenceRubric: [
    { id: 'topology', observation: 'Fluid-domain topology', pass: 'One connected passage is bounded by the intended inlet, outlet, walls, sphere, and supports.', fail: 'Open edges, exterior space, solid material, or unintended pockets are included.' },
    { id: 'seed', observation: 'Seed-point ownership', pass: 'The registered seed lies inside the upstream fluid and selects Primary duct fluid.', fail: 'The seed touches a boundary, lies in solid material, or selects another region.' },
    { id: 'features', observation: 'Obstacle and support survival', pass: 'The sphere remains smooth and every support has continuous multi-element coverage.', fail: 'The sphere is faceted or a support disappears, pinches, or merges.' },
    { id: 'layers', observation: 'Floor-layer continuity', pass: 'Layers remain attached and transition gradually into adjacent faces and core cells.', fail: 'Layers collapse, intersect, or expand abruptly near corners and supports.' },
    { id: 'recovery', observation: 'Wake and outlet separation', pass: 'Wake spacing grows smoothly and the outlet is separated from unresolved abrupt gradients.', fail: 'Large cells erase the wake or poor transitions reach the outlet.' },
  ],
  transferQuestions: [
    { prompt: 'Where should seeds be placed in a manifold with two disconnected passages?', expected: 'Place one verified interior seed in each passage that must become a separate zone, away from walls and solid material.' },
    { prompt: 'Why is an inlet face different from UserDefinedFarfield in this meshing step?', expected: 'The inlet is a later physical boundary group; UserDefinedFarfield selects the supplied outer fluid-domain topology for meshing.' },
  ],
}

export function t07Params(featureAware: boolean): Record<string, unknown> {
  return featureAware ? mergeTutorialPatch(t07Baseline, t07FeaturePatch) as Record<string, unknown> : t07Baseline
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function draftEntities(params: Record<string, unknown>) {
  const cache = record(params.private_attribute_asset_cache)
  const info = record(cache.project_entity_info)
  return Array.isArray(info.draft_entities) ? info.draft_entities.map(record) : []
}

export function t07ConfiguredPatch(featureAware: boolean): Record<string, unknown> {
  const params = t07Params(featureAware)
  const cache = record(params.private_attribute_asset_cache)
  return {
    ...params,
    private_attribute_asset_cache: {
      use_inhouse_mesher: cache.use_inhouse_mesher,
      project_entity_info: { draft_entities: draftEntities(params) },
    },
  }
}

export function validateT07Setup(params: Record<string, unknown>): SetupCheck[] {
  const meshing = record(params.meshing)
  const zones = Array.isArray(meshing.volume_zones) ? meshing.volume_zones.map(record) : []
  const refinements = Array.isArray(meshing.refinements) ? meshing.refinements.map(record) : []
  const custom = zones.find((zone) => zone.type === 'CustomZones')
  const zoneEntities = record(custom?.entities)
  const stored = Array.isArray(zoneEntities.stored_entities) ? zoneEntities.stored_entities.map(record) : []
  const seed = stored.find((entity) => entity.type === 'SeedpointVolume')
  const point = Array.isArray(seed?.point_in_mesh) ? record(seed.point_in_mesh[0]) : {}
  const coordinates = Array.isArray(point.value) ? point.value.map(Number) : []
  const registered = draftEntities(params)
  const registeredIds = new Set(registered.map((entity) => String(entity.private_attribute_id || '')))
  const featureAware = refinements.length > 0
  const types = new Set(refinements.map((item) => String(item.refinement_type)))
  return [
    { id: 'domain', label: 'Closed internal domain is explicit', detail: 'One UserDefinedFarfield uses the supplied fluid volume; no AutomatedFarfield is present.', passed: zones.filter((zone) => zone.type === 'UserDefinedFarfield').length === 1 && !zones.some((zone) => zone.type === 'AutomatedFarfield') },
    { id: 'zone', label: 'Connected fluid zone is defined', detail: 'CustomZones contains exactly one Primary duct fluid SeedpointVolume.', passed: stored.length === 1 && seed?.name === 'Primary duct fluid' },
    { id: 'seed', label: 'Seed point is inside the upstream passage', detail: '[1, 0, 2] m lies within the 8 m × 4 m × 4 m duct and upstream of the sphere.', passed: JSON.stringify(coordinates) === JSON.stringify([1, 0, 2]) },
    { id: 'registration', label: 'SeedpointVolume is registered', detail: 'The zone entity ID resolves through project_entity_info.draft_entities.', passed: Boolean(seed?.private_attribute_id) && registeredIds.has(String(seed?.private_attribute_id)) },
    { id: 'resolution', label: featureAware ? 'Feature-aware controls are complete' : 'Global-only baseline is isolated', detail: featureAware ? 'Sphere, support, floor-layer, and passive-spacing controls are present.' : 'No local refinement is applied, preserving a controlled baseline.', passed: featureAware ? ['SurfaceRefinement', 'BoundaryLayer', 'PassiveSpacing'].every((type) => types.has(type)) && refinements.length === 5 : refinements.length === 0 },
  ]
}

export function t07Progress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t07Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t07Steps.length) * 100)
}

function identifier(result: unknown, key: string): string {
  const value = record(result)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT07Environment(
  input: { folderId: string; projectName: string },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void = () => undefined,
  fetchAsset: typeof fetch = fetch,
): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  if (![false, true].every((featureAware) => validateT07Setup(t07Params(featureAware)).every((check) => check.passed))) {
    throw new Error('The bundled T07 parameters contain an invalid internal-domain or seed-point contract.')
  }
  const response = await fetchAsset(geometryUrl)
  if (!response.ok) throw new Error('The bundled T07 internal-flow Geometry could not be loaded.')
  const form = new FormData()
  form.set('name', input.projectName)
  form.set('source_type', 'geometry')
  form.set('unit', 'm')
  form.set('workflow', 'standard')
  form.set('solver_version', 'release-25.10')
  form.set('folder_id', input.folderId)
  form.set('tags', 'tutorial,T07')
  form.append('files', await response.blob(), 'internal-flow.csm')
  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id')
  const geometryId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the T07 Project without returning its Geometry identifiers.')
  onStage('creating-drafts')
  const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T07 baseline · global internal mesh', patch: t07ConfiguredPatch(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T07 variant · feature-aware internal mesh', patch: t07ConfiguredPatch(true) }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
