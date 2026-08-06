import baselineDocument from '../../../tutorials/T03-cylinder-boundary-layer/simulation.json'
import refinedPatch from '../../../tutorials/T03-cylinder-boundary-layer/variants/refined-mesh.patch.json'
import geometryUrl from '../../../tutorials/T03-cylinder-boundary-layer/assets/cylinder.csm?url'
import type { SimulationPlan } from '../api/client'
import {
  mergeTutorialPatch,
  type SetupCheck,
  type TutorialEnvironmentClient,
  type TutorialEnvironmentResult,
  type TutorialEnvironmentStage,
  type TutorialStep,
} from './t01'

export const t03Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the mesh decision', summary: 'Decide what the mesh must resolve before choosing sizes.' },
  { id: 'geometry', label: '02', title: 'Read the curvature', summary: 'Connect cylinder scale and curvature to surface facets.' },
  { id: 'setup', label: '03', title: 'Build the mesh controls', summary: 'Combine global defaults with local surface and layer rules.' },
  { id: 'variant', label: '04', title: 'Compare a refinement', summary: 'Tighten three spatial controls without changing the geometry.' },
  { id: 'evidence', label: '05', title: 'Define mesh evidence', summary: 'Inspect curvature, layers, transitions, and cell quality.' },
  { id: 'run', label: '06', title: 'Create mesh Plans', summary: 'Create the environment while keeping cloud meshing behind approval.' },
]

export const t03Baseline = baselineDocument as unknown as Record<string, unknown>
export const t03RefinedPatch = refinedPatch as unknown as Record<string, unknown>

export const t03ParameterCards = [
  { label: 'Global max edge', value: '1.0 m', provenance: 'adapted', why: 'Caps the background surface spacing before local rules take over.' },
  { label: 'Global curvature', value: '15°', provenance: 'adapted', why: 'Adds facets when surface normals rotate, preserving the circular silhouette.' },
  { label: 'Cylinder max edge', value: '0.25 m', provenance: 'inferred', why: 'Targets the body without paying the same resolution everywhere.' },
  { label: 'Cylinder curvature', value: '10°', provenance: 'inferred', why: 'Makes the local circular profile stricter than the global default.' },
  { label: 'First layer', value: '0.01 m', provenance: 'adapted', why: 'Controls the first wall-normal cell; production work must derive it from target y+.' },
  { label: 'Growth rates', value: '1.2 / 1.2', provenance: 'adapted', why: 'Limits abrupt expansion on the surface and through the layer stack.' },
]

export const t03Evidence = [
  { title: 'Curvature resolved', detail: 'The cylinder cross-section remains circular without visibly flat sectors.' },
  { title: 'Layers continuous', detail: 'Near-wall layers wrap the cylinder without collapse, collision, or gaps.' },
  { title: 'Growth is smooth', detail: 'Surface and wall-normal spacing transition gradually into the core mesh.' },
  { title: 'Quality reviewed', detail: 'No open boundaries, inverted cells, or unacceptable local quality remain.' },
]

export function t03Params(refined: boolean): Record<string, unknown> {
  return refined
    ? mergeTutorialPatch(t03Baseline, t03RefinedPatch) as Record<string, unknown>
    : t03Baseline
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function quantityValue(value: unknown): number | undefined {
  const raw = record(value).value
  return typeof raw === 'number' ? raw : undefined
}

export function validateT03Setup(params: Record<string, unknown>): SetupCheck[] {
  const meshing = record(params.meshing)
  const defaults = record(meshing.defaults)
  const refinements = Array.isArray(meshing.refinements) ? meshing.refinements.map(record) : []
  const surface = refinements.find((item) => item.refinement_type === 'SurfaceRefinement') ?? {}
  const layer = refinements.find((item) => item.refinement_type === 'BoundaryLayer') ?? {}
  const zones = Array.isArray(meshing.volume_zones) ? meshing.volume_zones.map(record) : []
  return [
    { id: 'global-spacing', label: 'Global spacing is bounded', detail: 'Surface max edge length is 1 m.', passed: quantityValue(defaults.surface_max_edge_length) === 1 },
    { id: 'curvature', label: 'Curvature control is active', detail: 'Global and local curvature angles are defined.', passed: quantityValue(defaults.curvature_resolution_angle) === 15 && typeof quantityValue(surface.curvature_resolution_angle) === 'number' },
    { id: 'surface-refinement', label: 'Cylinder is locally refined', detail: 'A named SurfaceRefinement limits cylinder edge length.', passed: surface.name === 'Cylinder curvature refinement' && typeof quantityValue(surface.max_edge_length) === 'number' },
    { id: 'boundary-layer', label: 'Boundary layer is explicit', detail: 'First-layer thickness and per-face growth rate are present.', passed: typeof quantityValue(layer.first_layer_thickness) === 'number' && layer.growth_rate === 1.2 },
    { id: 'farfield', label: 'External domain is defined', detail: 'Automated farfield is forty geometry lengths away.', passed: zones.some((zone) => zone.type === 'AutomatedFarfield' && zone.relative_size === 40) },
    { id: 'beta-mesher', label: 'Required mesher is recorded', detail: 'Per-face curvature and growth controls use the beta mesher.', passed: record(params.private_attribute_asset_cache).use_inhouse_mesher === true },
  ]
}

export function t03Progress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t03Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t03Steps.length) * 100)
}

function identifier(result: unknown, key: string): string {
  const value = record(result)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT03Environment(
  input: { folderId: string; projectName: string },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void = () => undefined,
  fetchAsset: typeof fetch = fetch,
): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  const response = await fetchAsset(geometryUrl)
  if (!response.ok) throw new Error('The bundled T03 cylinder geometry could not be loaded.')
  const form = new FormData()
  form.set('name', input.projectName)
  form.set('source_type', 'geometry')
  form.set('unit', 'm')
  form.set('workflow', 'standard')
  form.set('solver_version', 'release-25.10')
  form.set('folder_id', input.folderId)
  form.set('tags', 'tutorial,T03')
  form.append('files', await response.blob(), 'cylinder.csm')

  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id')
  const geometryId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the tutorial Project without returning its Geometry identifiers.')

  onStage('creating-plans')
  const shared = {
    project_id: projectId,
    project_name: input.projectName,
    source_id: geometryId,
    source_type: 'Geometry',
    source_name: 'T03 Cylinder Geometry',
    target: 'volume-mesh',
  }
  const plans: SimulationPlan[] = await Promise.all([
    client.createPlan({
      ...shared,
      name: 'T03 baseline · curvature + layers',
      intent: 'Create the reviewed baseline VolumeMesh for the three-dimensional cylinder.',
      patch: t03Params(false),
    }),
    client.createPlan({
      ...shared,
      name: 'T03 refined · tighter curvature + first layer',
      intent: 'Create the controlled refined VolumeMesh while preserving the cylinder geometry and farfield.',
      patch: t03Params(true),
    }),
  ])
  onStage('ready')
  return { projectId, geometryId, baselinePlan: plans[0], variantPlan: plans[1] }
}
