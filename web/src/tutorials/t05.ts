import baselineDocument from '../../../tutorials/T05-wake-volume-refinement/simulation.json'
import focusedWakePatch from '../../../tutorials/T05-wake-volume-refinement/variants/focused-wake.patch.json'
import geometryUrl from '../../../tutorials/T05-wake-volume-refinement/assets/cylinder.csm?url'
import {
  mergeTutorialPatch,
  type SetupCheck,
  type TutorialEnvironmentClient,
  type TutorialEnvironmentResult,
  type TutorialEnvironmentStage,
  type TutorialStep,
} from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t05Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the cell-budget decision', summary: 'Connect transported wake gradients to where volume cells are useful.' },
  { id: 'regions', label: '02', title: 'Locate separation and wake', summary: 'Place near-body and downstream regions using the flow direction.' },
  { id: 'setup', label: '03', title: 'Assign each control a role', summary: 'Combine uniform, structured-box, and axisymmetric refinement.' },
  { id: 'variant', label: '04', title: 'Focus the wake corridor', summary: 'Extend downstream coverage and tighten crossflow spacing.' },
  { id: 'evidence', label: '05', title: 'Review the center-plane slice', summary: 'Define the transitions and coverage the mesh must prove.' },
  { id: 'run', label: '06', title: 'Create mesh Drafts', summary: 'Create both configured strategies without starting cloud meshing.' },
]

export const t05Baseline = baselineDocument as unknown as Record<string, unknown>
export const t05FocusedWakePatch = focusedWakePatch as unknown as Record<string, unknown>

export const t05ParameterCards = [
  { label: 'Near-body sphere', value: '1.5 m radius · 0.25 m', provenance: 'inferred', why: 'Covers separation around the body without extending fine cells across the domain.' },
  { label: 'Wake box', value: '8 m long · 0.16 m crossflow', provenance: 'inferred', why: 'Uses directional spacing to follow downstream transport.' },
  { label: 'Wake core', value: '8 m long · 0.14 m radial', provenance: 'inferred', why: 'Adds cylindrical control where shear layers roll into the core.' },
  { label: 'Center-plane slice', value: 'y = 0 m', provenance: 'required', why: 'Makes region overlap, cell-size transitions, and downstream reach reviewable.' },
  { label: 'Focused corridor', value: '12.5 m long', provenance: 'inferred', why: 'Tests whether additional downstream coverage is worth the cell cost.' },
  { label: 'Focused crossflow', value: '0.08 m', provenance: 'inferred', why: 'Doubles cross-wake resolution while leaving axial spacing coarser.' },
]

export const t05Evidence = [
  { title: 'Draft entities are registered', detail: 'Sphere, Box, Cylinder, and Slice IDs appear in project_entity_info.draft_entities and match every parameter reference.' },
  { title: 'Separation region is covered', detail: 'The near-body sphere encloses the cylinder and immediate separation zone.' },
  { title: 'Wake controls point downstream', detail: 'The box and cylindrical core align with positive x and do not waste equal resolution upstream.' },
  { title: 'Overlaps transition smoothly', detail: 'Sphere, box, and core spacing blend without abrupt cell-size jumps.' },
  { title: 'Corridor exit is acceptable', detail: 'The center-plane slice shows sufficient downstream reach before returning to background spacing.' },
]

export const t05Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Explain how separation and shear layers create a downstream velocity-deficit wake.',
    'Map three physical resolution roles to Flow360 entities and refinement objects.',
    'Apply explicit mesh-slice criteria to accept or reject a wake-refinement strategy.',
  ],
  cfdConcepts: [
    { id: 'separation', title: 'Separation creates the wake', explanation: 'An adverse pressure gradient makes the cylinder boundary layer detach. Two shear layers then bound a low-momentum, velocity-deficit region downstream.', misconception: 'The wake is not a uniform geometric shadow, so equal refinement everywhere behind the cylinder is wasteful.' },
    { id: 'anisotropy', title: 'Wake gradients are directional', explanation: 'Mean flow transports the deficit downstream, while velocity changes most strongly across the shear layers. Crossflow spacing can therefore be tighter than axial spacing.', misconception: 'A longer axial cell is not automatically low quality when it follows a weak-gradient direction and transitions smoothly.' },
  ],
  flow360Concepts: [
    { id: 'entity-refinement', title: 'Registered entities say where; refinements say how', explanation: 'Sphere, Box, and Cylinder locate regions after their IDs are registered in project_entity_info.draft_entities. UniformRefinement, StructuredBoxRefinement, and AxisymmetricRefinement define spacing inside them.', misconception: 'An entity embedded only in stored_entities is a dangling reference when its ID is absent from the Draft entity registry.' },
    { id: 'slice-request', title: 'MeshSliceOutput requests later evidence', explanation: 'The Draft asks Flow360 to expose a center-plane mesh slice after meshing so coverage, overlap, and transitions can be reviewed.', misconception: 'A valid output request is not proof that a volume mesh exists or already passes the evidence rubric.' },
  ],
  derivations: [
    { id: 'length', parameter: 'Corridor length normalized by diameter', basis: 'The cylinder diameter D = 1 m is the reference length, so downstream reach is expressed as Lwake/D.', calculation: 'baseline: 8/1 = 8D · focused: 12.5/1 = 12.5D', transfer: 'For a different body, multiply the chosen reach in diameters by its new characteristic length.' },
    { id: 'ratio', parameter: 'Crossflow-to-axial spacing ratio', basis: 'Stronger cross-wake gradients justify tighter crossflow spacing than axial spacing.', calculation: 'baseline: 0.16/0.35 = 0.46 · focused: 0.08/0.24 = 0.33', transfer: 'Rotate the local axes with the expected wake and preserve the gradient-based ratio, not the metre values.' },
    { id: 'octree', parameter: 'Octree-compatible near-body spacing', basis: 'Flow360 casts uniform volume spacing to a supported octree level, so exact subdivisions avoid a hidden size change.', calculation: 'baseline: D/4 = 0.25 m · focused: D/8 = 0.125 m', transfer: 'Choose a supported fraction of the new reference length and inspect the serialized Draft value.' },
  ],
  experiments: [{ id: 'focus', prediction: 'What should change when only wake reach and crossflow resolution are increased?', options: ['More downstream fine cells and higher cost', 'A thinner first boundary-layer cell'], controlledVariable: 'Volume-region reach and spacing change; cylinder geometry and first-layer thickness do not.', observation: 'Compare downstream exit, cross-wake cell count, transition smoothness, and total cell cost in the same center-plane view.' }],
  failureModes: [
    { id: 'unregistered', symptom: 'A refinement appears in SimulationParams but has no effective volume scope.', cause: 'Its Sphere, Box, Cylinder, or Slice ID is absent from project_entity_info.draft_entities.', correction: 'Create or register the Draft entity first, bind the refinement to the registered ID, save, and run preflight again.' },
    { id: 'misaligned', symptom: 'The fine corridor misses the velocity-deficit wake.', cause: 'The region follows global +x even though yaw or nearby geometry deflects the wake.', correction: 'Rotate or widen the Box and Cylinder using the expected feature path.' },
    { id: 'short', symptom: 'A strong wake exits abruptly into coarse background cells.', cause: 'Region length was copied without considering wake decay or downstream outputs.', correction: 'Extend only until requested evidence is resolved, then justify the added cell cost.' },
    { id: 'isotropic', symptom: 'Cell count rises without improving the cross-wake gradient.', cause: 'Equal spacing was used in all directions instead of flow-aligned anisotropy.', correction: 'Tighten spacing across strong gradients and keep axial spacing deliberately coarser.' },
  ],
  evidenceRubric: [
    { id: 'registry', observation: 'Draft entity registration', pass: 'Every volume and slice reference resolves to the same ID and type in project_entity_info.draft_entities.', fail: 'A stored_entities reference has no matching Draft entity, or its ID/type differs.' },
    { id: 'coverage', observation: 'Near-body separation coverage', pass: 'Fine cells enclose the cylinder and overlap the start of both shear layers.', fail: 'A shear layer leaves the fine region before entering the downstream corridor.' },
    { id: 'alignment', observation: 'Directional wake alignment', pass: 'The box and core follow the wake with tighter crossflow than axial spacing.', fail: 'Fine cells miss the wake or use unjustified isotropic spacing.' },
    { id: 'transition', observation: 'Region overlap and transition', pass: 'Sphere, box, core, and background levels blend progressively.', fail: 'Abrupt jumps, disconnected pockets, or avoidable quality risks appear.' },
    { id: 'exit', observation: 'Downstream corridor exit', pass: 'Requested observation locations end before a smooth return to background spacing.', fail: 'An important gradient crosses the exit or the extra reach has no evidence purpose.' },
  ],
  transferQuestions: [
    { prompt: 'How should the refinement change for a ten-degree yaw angle?', expected: 'Rotate toward the predicted wake or widen for uncertainty, preserving spacing directions relative to the wake.' },
    { prompt: 'When is the focused 12.5D corridor not worth its added cost?', expected: 'When outputs end upstream, baseline-exit gradients are already weak, or no engineering decision benefits from the extra reach.' },
  ],
}

export function t05Params(focused: boolean): Record<string, unknown> {
  return focused
    ? mergeTutorialPatch(t05Baseline, t05FocusedWakePatch) as Record<string, unknown>
    : t05Baseline
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function refinementTypes(params: Record<string, unknown>) {
  const meshing = record(params.meshing)
  const refinements = Array.isArray(meshing.refinements) ? meshing.refinements.map(record) : []
  return { meshing, refinements, types: refinements.map((item) => item.refinement_type) }
}

function draftEntities(params: Record<string, unknown>) {
  const cache = record(params.private_attribute_asset_cache)
  const entityInfo = record(cache.project_entity_info)
  return Array.isArray(entityInfo.draft_entities) ? entityInfo.draft_entities.map(record) : []
}

function referencedDraftEntities(params: Record<string, unknown>) {
  const { meshing, refinements } = refinementTypes(params)
  const outputs = Array.isArray(meshing.outputs) ? meshing.outputs.map(record) : []
  return [...refinements, ...outputs].flatMap((item) => {
    const entities = record(item.entities)
    return Array.isArray(entities.stored_entities) ? entities.stored_entities.map(record) : []
  })
}

export function t05ConfiguredPatch(focused: boolean): Record<string, unknown> {
  const params = t05Params(focused)
  const cache = record(params.private_attribute_asset_cache)
  return {
    ...params,
    private_attribute_asset_cache: {
      use_inhouse_mesher: cache.use_inhouse_mesher,
      project_entity_info: { draft_entities: draftEntities(params) },
    },
  }
}

export function validateT05Setup(params: Record<string, unknown>): SetupCheck[] {
  const { meshing, refinements, types } = refinementTypes(params)
  const box = refinements.find((item) => item.refinement_type === 'StructuredBoxRefinement')
  const core = refinements.find((item) => item.refinement_type === 'AxisymmetricRefinement')
  const outputs = Array.isArray(meshing.outputs) ? meshing.outputs.map(record) : []
  const boxAxial = Number(record(box?.spacing_axis1).value)
  const boxCrossflow = Number(record(box?.spacing_axis2).value)
  const coreAxial = Number(record(core?.spacing_axial).value)
  const coreRadial = Number(record(core?.spacing_radial).value)
  const registeredIds = new Set(draftEntities(params).map((entity) => String(entity.private_attribute_id || '')))
  const referenced = referencedDraftEntities(params)
  return [
    { id: 'entities', label: 'Draft volumes are registered', detail: 'Sphere, Box, Cylinder, and Slice references resolve through project_entity_info.draft_entities.', passed: referenced.length === 4 && referenced.every((entity) => registeredIds.has(String(entity.private_attribute_id || ''))) },
    { id: 'roles', label: 'Three region roles are explicit', detail: 'Uniform, structured-box, and axisymmetric refinements are all present.', passed: ['UniformRefinement', 'StructuredBoxRefinement', 'AxisymmetricRefinement'].every((type) => types.includes(type)) },
    { id: 'box-anisotropy', label: 'Wake box follows transport', detail: 'Crossflow spacing is tighter than axial spacing.', passed: boxCrossflow > 0 && boxCrossflow < boxAxial },
    { id: 'core-anisotropy', label: 'Wake core is direction-aware', detail: 'Radial spacing is tighter than axial spacing.', passed: coreRadial > 0 && coreRadial < coreAxial },
    { id: 'slice', label: 'Mesh evidence is requested', detail: 'A center-plane MeshSliceOutput is included before cloud meshing.', passed: outputs.some((item) => item.output_type === 'MeshSliceOutput') },
  ]
}

export function t05Progress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t05Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t05Steps.length) * 100)
}

function identifier(result: unknown, key: string): string {
  const value = record(result)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT05Environment(
  input: { folderId: string; projectName: string },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void = () => undefined,
  fetchAsset: typeof fetch = fetch,
): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  const baselineParams = t05Params(false)
  const focusedParams = t05Params(true)
  if (![baselineParams, focusedParams].every((params) => validateT05Setup(params).every((check) => check.passed))) {
    throw new Error('The bundled T05 parameters contain an unregistered Draft entity or invalid refinement relationship.')
  }
  const response = await fetchAsset(geometryUrl)
  if (!response.ok) throw new Error('The bundled T05 cylinder geometry could not be loaded.')
  const form = new FormData()
  form.set('name', input.projectName)
  form.set('source_type', 'geometry')
  form.set('unit', 'm')
  form.set('workflow', 'standard')
  form.set('solver_version', 'release-25.10')
  form.set('folder_id', input.folderId)
  form.set('tags', 'tutorial,T05')
  form.append('files', await response.blob(), 'cylinder.csm')
  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id')
  const geometryId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the tutorial Project without returning its Geometry identifiers.')
  onStage('creating-drafts')
  const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T05 baseline · compact wake regions', patch: t05ConfiguredPatch(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T05 variant · focused wake corridor', patch: t05ConfiguredPatch(true) }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
