import baselineDocument from '../../../tutorials/T03-cylinder-boundary-layer/simulation.json'
import refinedPatch from '../../../tutorials/T03-cylinder-boundary-layer/variants/refined-mesh.patch.json'
import geometryUrl from '../../../tutorials/T03-cylinder-boundary-layer/assets/cylinder.csm?url'
import {
  mergeTutorialPatch,
  type SetupCheck,
  type TutorialEnvironmentClient,
  type TutorialEnvironmentResult,
  type TutorialEnvironmentStage,
  type TutorialStep,
} from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t03Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the mesh decision', summary: 'Decide what the mesh must resolve before choosing sizes.' },
  { id: 'geometry', label: '02', title: 'Read the curvature', summary: 'Connect cylinder scale and curvature to surface facets.' },
  { id: 'setup', label: '03', title: 'Build the mesh controls', summary: 'Combine global defaults with local surface and layer rules.' },
  { id: 'variant', label: '04', title: 'Compare a refinement', summary: 'Tighten three spatial controls without changing the geometry.' },
  { id: 'evidence', label: '05', title: 'Define mesh evidence', summary: 'Inspect curvature, layers, transitions, and cell quality.' },
  { id: 'run', label: '06', title: 'Create mesh Drafts', summary: 'Create configured Drafts while keeping cloud meshing behind approval.' },
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

export const t03Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Explain how curvature angle and maximum edge length jointly discretize a cylinder.',
    'Separate first-layer teaching values from a production y-plus derivation.',
    'Judge surface fidelity, layer continuity, transitions, and quality from generated evidence.',
  ],
  cfdConcepts: [
    { id: 'facets', title: 'Curvature becomes planar facets', explanation: 'A smooth cylinder is approximated by planar surface elements. Their normal changes must remain small enough to preserve shape and pressure gradients.', misconception: 'Smooth CAD does not guarantee a smooth computational surface when curvature controls are loose.' },
    { id: 'wall-gradient', title: 'The strongest gradient is wall-normal', explanation: 'No-slip velocity changes rapidly away from the wall, so anisotropic layers resolve a direction that surface triangles cannot.', misconception: 'A smaller first layer is not automatically correct without operating conditions, turbulence treatment, and a target y-plus.' },
  ],
  flow360Concepts: [
    { id: 'surface', title: 'SurfaceRefinement controls tangential resolution', explanation: 'It applies local maximum edge length and curvature angle to the named cylinder faces while defaults govern the background.', misconception: 'A strict curvature angle does not replace an independent maximum edge length.' },
    { id: 'layer', title: 'BoundaryLayer controls wall-normal resolution', explanation: 'It applies first-layer thickness and growth rate to wall faces, separately from surface tangential refinement.', misconception: 'Valid BoundaryLayer parameters do not prove that generated layers remain continuous.' },
  ],
  derivations: [
    { id: 'sectors', parameter: 'Curvature angle as a facet estimate', basis: 'A full circle contains 360°, so the normal-angle limit estimates circumferential sectors.', calculation: '360°/10° ≈ 36 · 360°/6° ≈ 60', transfer: 'Use this only as an estimate; inspect the mesh because maximum edge length may become active.' },
    { id: 'layer-ratio', parameter: 'First-layer thickness normalized by diameter', basis: 'Normalizing exposes the teaching scale while keeping it separate from a production y-plus calculation.', calculation: 'baseline t₁/D = 0.01 · refined t₁/D = 0.005', transfer: 'For production, derive t₁ from target y-plus, wall shear, density, and viscosity.' },
  ],
  experiments: [{ id: 'refine', prediction: 'What should visibly change when curvature, local edge length, and first-layer thickness are tightened?', options: ['More surface facets and a thinner first layer', 'A smaller farfield and different physics'], controlledVariable: 'Three spatial controls change; geometry, farfield, mesher, and growth rates stay fixed.', observation: 'Compare silhouette fidelity, layer thickness, continuity, transition, and expected cell cost in the same cross-section.' }],
  failureModes: [
    { id: 'faceted', symptom: 'The cylinder contains visibly flat sectors.', cause: 'Curvature angle or maximum edge length is too loose for the radius and pressure-resolution need.', correction: 'Tighten the active surface constraint and inspect the generated facet distribution.' },
    { id: 'collapsed', symptom: 'Wall-normal layers terminate, collide, or jump abruptly.', cause: 'Thickness, growth, available space, or local surface resolution is incompatible with the geometry.', correction: 'Adjust the failing layer or surface control locally instead of refining the whole domain.' },
  ],
  evidenceRubric: [
    { id: 'silhouette', observation: 'Circular silhouette', pass: 'The cross-section follows the circle without pressure-distorting flat sectors.', fail: 'Polygonal sectors remain obvious at the review scale.' },
    { id: 'continuity', observation: 'Boundary-layer continuity', pass: 'Layers wrap continuously with gradual growth and no collision.', fail: 'Layers collapse, intersect, disappear, or jump around the circumference.' },
    { id: 'transition', observation: 'Layer-to-core transition', pass: 'Anisotropic layers blend progressively into valid volume cells.', fail: 'Abrupt expansion, inverted cells, or isolated poor-quality regions remain.' },
  ],
  transferQuestions: [
    { prompt: 'What additional information is needed for a production first-layer thickness?', expected: 'Density, viscosity, velocity or Reynolds number, wall-shear estimate, turbulence treatment, and target y-plus.' },
    { prompt: 'When can maximum edge length dominate despite a strict curvature angle?', expected: 'On low-curvature regions where normals barely turn but long elements are still unacceptable.' },
  ],
}

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

  onStage('creating-drafts')
  const shared = {
    source_id: geometryId,
  }
  const drafts = await Promise.all([
    client.createConfiguredDraft(projectId, {
      ...shared,
      name: 'T03 baseline · curvature + layers',
      patch: t03Params(false),
    }),
    client.createConfiguredDraft(projectId, {
      ...shared,
      name: 'T03 refined · tighter curvature + first layer',
      patch: t03Params(true),
    }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft: drafts[0], variantDraft: drafts[1] }
}
