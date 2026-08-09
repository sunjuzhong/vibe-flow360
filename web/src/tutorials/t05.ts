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
  { title: 'Separation region is covered', detail: 'The near-body sphere encloses the cylinder and immediate separation zone.' },
  { title: 'Wake controls point downstream', detail: 'The box and cylindrical core align with positive x and do not waste equal resolution upstream.' },
  { title: 'Overlaps transition smoothly', detail: 'Sphere, box, and core spacing blend without abrupt cell-size jumps.' },
  { title: 'Corridor exit is acceptable', detail: 'The center-plane slice shows sufficient downstream reach before returning to background spacing.' },
]

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

export function validateT05Setup(params: Record<string, unknown>): SetupCheck[] {
  const { meshing, refinements, types } = refinementTypes(params)
  const box = refinements.find((item) => item.refinement_type === 'StructuredBoxRefinement')
  const core = refinements.find((item) => item.refinement_type === 'AxisymmetricRefinement')
  const outputs = Array.isArray(meshing.outputs) ? meshing.outputs.map(record) : []
  const boxAxial = Number(record(box?.spacing_axis1).value)
  const boxCrossflow = Number(record(box?.spacing_axis2).value)
  const coreAxial = Number(record(core?.spacing_axial).value)
  const coreRadial = Number(record(core?.spacing_radial).value)
  return [
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
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T05 baseline · compact wake regions', patch: t05Params(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T05 variant · focused wake corridor', patch: t05Params(true) }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
