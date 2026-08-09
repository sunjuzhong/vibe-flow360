import baselineDocument from '../../../tutorials/T04-airfoil-edge-refinement/simulation.json'
import geometryAwarePatch from '../../../tutorials/T04-airfoil-edge-refinement/variants/geometry-aware.patch.json'
import geometryUrl from '../../../tutorials/T04-airfoil-edge-refinement/assets/geometry.csm?url'
import {
  mergeTutorialPatch,
  type SetupCheck,
  type TutorialEnvironmentClient,
  type TutorialEnvironmentResult,
  type TutorialEnvironmentStage,
  type TutorialStep,
} from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t04Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the edge risk', summary: 'Connect each geometric feature to a possible mesh failure.' },
  { id: 'geometry', label: '02', title: 'Read the three elements', summary: 'Locate leading edges, trailing edges, and narrow passages.' },
  { id: 'setup', label: '03', title: 'Choose spacing methods', summary: 'Match angle, height, aspect ratio, and projection to intent.' },
  { id: 'variant', label: '04', title: 'Compare Geometry AI', summary: 'Replace explicit edge rules with thin-feature preservation.' },
  { id: 'evidence', label: '05', title: 'Define mesh evidence', summary: 'Specify what the generated mesh must prove.' },
  { id: 'run', label: '06', title: 'Create mesh Drafts', summary: 'Create both strategies without starting cloud meshing.' },
]

export const t04Baseline = baselineDocument as unknown as Record<string, unknown>
export const t04GeometryAwarePatch = geometryAwarePatch as unknown as Record<string, unknown>

export const t04ParameterCards = [
  { label: 'Leading edges', value: '8° angle', provenance: 'adapted', why: 'Ties edge spacing to local curvature instead of a global length.' },
  { label: 'Trailing edges', value: '0.7 mm height', provenance: 'provided', why: 'Directly limits the first anisotropic cell normal to sharp edges.' },
  { label: 'Slat/flap gaps', value: 'AR ≤ 10', provenance: 'inferred', why: 'Restricts stretching where narrow passages can lose usable cells.' },
  { label: 'Symmetry edges', value: 'Projected', provenance: 'provided', why: 'Carries neighboring anisotropic spacing onto the quasi-2D side.' },
  { label: 'Geometry accuracy', value: '0.35 mm', provenance: 'inferred', why: 'Geometry AI alternative preserves small multi-element features.' },
  { label: 'Minimum passage', value: '1.5 mm', provenance: 'inferred', why: 'Makes the smallest passage that must survive explicit and reviewable.' },
]

export const t04Evidence = [
  { title: 'Passages remain open', detail: 'Slat and flap gaps contain a continuous cell path without unintended sealing.' },
  { title: 'Leading edges are smooth', detail: 'Curvature is resolved without visibly flat sectors or abrupt size jumps.' },
  { title: 'Trailing edges stay sharp', detail: 'Edge-normal spacing captures the thin trailing geometry without collapse.' },
  { title: 'Anisotropy transitions cleanly', detail: 'Projected and passage spacing blend into the surrounding volume mesh.' },
]

export const t04Pedagogy: TutorialPedagogy = {
  learningObjectives: [
    'Explain why leading edges, trailing edges, and narrow passages create different mesh risks.',
    'Choose explicit edge controls or Geometry AI from CAD provenance and passage risk.',
    'Judge passage topology, critical-edge fidelity, and anisotropic transitions from generated evidence.',
  ],
  cfdConcepts: [
    { id: 'leading', title: 'Leading edges carry strong pressure gradients', explanation: 'Flow turns rapidly around each leading edge, so local curvature fidelity influences stagnation and suction-side pressure gradients.', misconception: 'One global edge length does not guarantee consistent angular resolution on every leading-edge radius.' },
    { id: 'passages', title: 'Gaps accelerate flow; trailing edges seed wakes', explanation: 'Slat and flap passages redirect accelerated flow, while sharp trailing edges start thin wakes that are sensitive to geometric loss.', misconception: 'A closed, valid mesh can still be physically unusable when a passage seals or a trailing edge becomes blunt.' },
  ],
  flow360Concepts: [
    { id: 'methods', title: 'Each edge method expresses one risk', explanation: 'Angle, height, aspect-ratio, and projected spacing constrain curvature, normal thickness, stretching, and inherited anisotropy.', misconception: 'These methods are not interchangeable ways to ask for a generically finer edge.' },
    { id: 'ai', title: 'Geometry AI replaces the explicit strategy', explanation: 'GeometryRefinement protects thin geometry and minimum passages through CAD-aware preparation instead of SurfaceEdgeRefinement rules.', misconception: 'In Flow360 25.10, Geometry AI should not be layered on top of incompatible explicit edge controls.' },
  ],
  derivations: [
    { id: 'angle', parameter: 'Leading-edge angular resolution', basis: 'The 8° turn limit describes curvature independently of absolute leading-edge radius.', calculation: '360°/8° = 45 sectors for a complete-circle estimate', transfer: 'Keep an angular criterion across radii, then verify actual edge length and facets.' },
    { id: 'height', parameter: 'Trailing-edge height normalized by chord', basis: 'The 0.7 mm teaching height is interpreted relative to the 1 m reference chord.', calculation: 'hTE/c = 0.0007/1 = 7×10⁻⁴', transfer: 'Recompute from new chord and actual trailing-edge thickness instead of copying 0.7 mm.' },
    { id: 'passage', parameter: 'Minimum protected passage normalized by chord', basis: 'The 1.5 mm threshold states the smallest geometric passage that must survive preparation.', calculation: 'gmin/c = 0.0015/1 = 1.5×10⁻³', transfer: 'Measure the new critical gap and geometry tolerance before setting the threshold.' },
  ],
  experiments: [{ id: 'strategy', prediction: 'Which strategy is more robust when edge groups are missing but CAD faces and passages are trustworthy?', options: ['Geometry AI passage preservation', 'Explicit edge controls with missing groups'], controlledVariable: 'GeometryRefinement replaces explicit edge rules and uses a different CAD preparation path.', observation: 'Compare passage survival, edge fidelity, traceability, and dependence on grouping—not only setup length.' }],
  failureModes: [
    { id: 'groups', symptom: 'Some leading, trailing, or gap controls are absent.', cause: 'edgeName groups changed or disappeared during CAD import.', correction: 'Repair grouping provenance or use Geometry AI when its CAD assumptions are satisfied.' },
    { id: 'sealed', symptom: 'A slat or flap passage closes or loses a continuous cell path.', cause: 'Tolerance, sealing, surface spacing, or passage protection is too coarse.', correction: 'Protect the measured minimum passage and inspect generated topology before volume meshing.' },
  ],
  evidenceRubric: [
    { id: 'topology', observation: 'Passage topology', pass: 'Slat and flap gaps remain open with continuous usable cell paths.', fail: 'A gap seals, bridges, changes connectivity, or is unusably coarse.' },
    { id: 'leading', observation: 'Leading-edge fidelity', pass: 'Each element turns smoothly without flat sectors or abrupt spacing.', fail: 'Polygonal edges or inconsistent resolution could distort the suction peak.' },
    { id: 'trailing', observation: 'Trailing-edge fidelity', pass: 'Thin trailing geometry stays sharp with controlled normal spacing.', fail: 'The edge becomes blunt, disappears, or creates a discontinuous transition.' },
    { id: 'consistent', observation: 'Strategy consistency', pass: 'Exactly one compatible strategy is active and its CAD provenance is verified.', fail: 'Incompatible controls are mixed or depend on missing geometry groups.' },
  ],
  transferQuestions: [
    { prompt: 'When should audited explicit edge controls be preferred?', expected: 'When grouping is reliable and each local geometric risk needs a directly traceable method.' },
    { prompt: 'What must be measured before reusing a passage threshold?', expected: 'The smallest important gap, geometry tolerance, chord scale, and any features intended to be sealed.' },
  ],
}

export function t04Params(geometryAware: boolean): Record<string, unknown> {
  return geometryAware
    ? mergeTutorialPatch(t04Baseline, t04GeometryAwarePatch) as Record<string, unknown>
    : t04Baseline
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function validateT04Setup(params: Record<string, unknown>): SetupCheck[] {
  const meshing = record(params.meshing)
  const refinements = Array.isArray(meshing.refinements) ? meshing.refinements.map(record) : []
  const methods = refinements.map((item) => record(item.method).type)
  const cache = record(params.private_attribute_asset_cache)
  const geometryAware = cache.use_geometry_AI === true
  return geometryAware ? [
    { id: 'geometry-ai', label: 'Geometry AI is explicit', detail: 'The alternative uses CAD importer v2 and disables the standalone beta mesher.', passed: cache.cad_importer_version === 'v2' && cache.use_inhouse_mesher === false },
    { id: 'geometry-refinement', label: 'Thin geometry is protected', detail: 'GeometryRefinement records accuracy, sealing, and minimum passage size.', passed: refinements.some((item) => item.refinement_type === 'GeometryRefinement' && item.preserve_thin_geometry === true) },
    { id: 'exclusive', label: 'Incompatible rules are removed', detail: 'SurfaceEdgeRefinement is not mixed with Geometry AI.', passed: !refinements.some((item) => item.refinement_type === 'SurfaceEdgeRefinement') },
    { id: 'farfield', label: 'Quasi-2D domain is preserved', detail: 'The same automated quasi-3D farfield remains.', passed: JSON.stringify(meshing.volume_zones).includes('quasi-3d') },
  ] : [
    { id: 'angle', label: 'Angle spacing is assigned', detail: 'Leading edges use an 8° curvature-driven rule.', passed: methods.includes('angle') },
    { id: 'height', label: 'Height spacing is assigned', detail: 'Trailing edges use a 0.7 mm normal height.', passed: methods.includes('height') },
    { id: 'aspect', label: 'Aspect ratio is bounded', detail: 'Gap edges cap anisotropic aspect ratio at 10.', passed: methods.includes('aspectRatio') },
    { id: 'projection', label: 'Projection is assigned', detail: 'Symmetry edges inherit neighboring anisotropic spacing.', passed: methods.includes('projectAnisoSpacing') },
  ]
}

export function t04Progress(completed: string[]): number {
  const unique = new Set(completed.filter((id) => t04Steps.some((step) => step.id === id)))
  return Math.round((unique.size / t04Steps.length) * 100)
}

function identifier(result: unknown, key: string): string {
  const value = record(result)[key]
  return typeof value === 'string' ? value.trim() : ''
}

export async function createT04Environment(
  input: { folderId: string; projectName: string },
  client: TutorialEnvironmentClient,
  onStage: (stage: TutorialEnvironmentStage) => void = () => undefined,
  fetchAsset: typeof fetch = fetch,
): Promise<TutorialEnvironmentResult> {
  onStage('staging')
  const response = await fetchAsset(geometryUrl)
  if (!response.ok) throw new Error('The bundled T04 airfoil geometry could not be loaded.')
  const form = new FormData()
  form.set('name', input.projectName)
  form.set('source_type', 'geometry')
  form.set('unit', 'm')
  form.set('workflow', 'standard')
  form.set('solver_version', 'release-25.10')
  form.set('folder_id', input.folderId)
  form.set('tags', 'tutorial,T04')
  form.append('files', await response.blob(), '30p30n.csm')
  const staged = await client.stageImport(form)
  const approved = await client.approveImport(staged.id)
  onStage('creating-project')
  const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id')
  const geometryId = identifier(submitted.result, 'root_resource_id')
  if (!projectId || !geometryId) throw new Error('Flow360 created the tutorial Project without returning its Geometry identifiers.')
  onStage('creating-drafts')
  const [baselineDraft, variantDraft] = await Promise.all([
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T04 baseline · explicit edge controls', patch: t04Params(false) }),
    client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T04 variant · Geometry AI passages', patch: t04Params(true) }),
  ])
  onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
