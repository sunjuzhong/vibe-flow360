import baselineDocument from '../../../tutorials/T10-snappy-surface-meshing/simulation.json'
import featurePatch from '../../../tutorials/T10-snappy-surface-meshing/variants/feature-aware.patch.json'
import geometryUrl from '../../../tutorials/T10-snappy-surface-meshing/assets/finned-heat-sink.csm?url'
import { mergeTutorialPatch, type SetupCheck, type TutorialEnvironmentClient, type TutorialEnvironmentResult, type TutorialEnvironmentStage, type TutorialStep } from './t01'
import type { TutorialPedagogy } from './pedagogy'

export const t10Steps: TutorialStep[] = [
  { id: 'question', label: '01', title: 'Frame the cooling-passage risk', summary: 'Connect missing fins and blocked channels to pressure-drop and heat-transfer error.' },
  { id: 'workflow', label: '02', title: 'Read the modular meshing pipeline', summary: 'Separate castellating, snapping, smoothing, and quality acceptance.' },
  { id: 'spacing', label: '03', title: 'Derive feature resolution', summary: 'Relate octree spacing levels to fin thickness, channel width, and transition cost.' },
  { id: 'experiment', label: '04', title: 'Apply feature-aware controls', summary: 'Compare global defaults with body, fin-region, and sharp-edge refinements.' },
  { id: 'evidence', label: '05', title: 'Define surface-mesh evidence', summary: 'Review topology, dimensions, quality limits, and local cell cost.' },
  { id: 'run', label: '06', title: 'Create both SurfaceMesh Drafts', summary: 'Create the supplied Geometry Project and synchronize both complete setups.' },
]

export const t10Baseline = baselineDocument as unknown as Record<string, unknown>
export const t10FeaturePatch = featurePatch as unknown as Record<string, unknown>
export const t10ParameterCards = [
  { label: 'Fin thickness', value: '4 mm', provenance: 'provided', why: 'A lost or rounded fin changes wetted area and the cooling-channel boundary.' },
  { label: 'Channel width', value: '14 mm', provenance: 'derived', why: 'The narrowest repeated flow passage sets the first gap-resolution screen.' },
  { label: 'Global maximum spacing', value: '15.625 mm', provenance: 'adapted', why: 'Defines the coarse octree level away from local heat-sink features.' },
  { label: 'Fin maximum spacing', value: '1.953125 mm', provenance: 'adapted', why: 'Provides about 7.17 surface samples across each open channel.' },
  { label: 'Minimum feature spacing', value: '0.9765625 mm', provenance: 'adapted', why: 'Provides about 4.10 samples across the 4 mm fin thickness.' },
  { label: 'Non-orthogonality limit', value: '70°', provenance: 'adapted', why: 'Makes mesh acceptance explicit instead of relying on mesher completion.' },
]
export const t10Evidence = [
  { title: 'Geometry groups resolve exactly once', detail: 'heatSink, base, and fins map to canonical imported entities before refinements are saved.' },
  { title: 'The surface remains watertight', detail: 'One component remains without holes, self-intersections, unintended bridges, or non-manifold edges.' },
  { title: 'Every fin and channel survives', detail: 'Six 4 mm fins and five 14 mm passages remain measurable in identical sections.' },
  { title: 'Quality limits remain active', detail: 'Non-orthogonality, boundary skewness, and internal skewness stay within the configured contract.' },
  { title: 'Added cells buy local fidelity', detail: 'Surface-cell growth concentrates on fins, channels, roots, and tips rather than the entire domain.' },
]
export const t10Pedagogy: TutorialPedagogy = {
  learningObjectives: ['Separate surface-meshing controls from later volume-meshing controls.', 'Assign body, region, and edge refinements to distinct geometric risks.', 'Relate requested spacing to octree levels and transition cells.', 'Reject a mesh that loses features or violates explicit quality limits.'],
  cfdConcepts: [
    { id: 'fidelity', title: 'Boundary error changes the flow passage', explanation: 'Missing fin thickness or a closed channel changes wetted area, hydraulic diameter, pressure drop, and heat transfer.', misconception: 'A converged solver can repair missing surface geometry.' },
    { id: 'gap', title: 'Gap resolution follows the narrowest relevant passage', explanation: 'The 14 mm channels need several samples across their width to remain open and support later boundary layers.', misconception: 'Visible CAD guarantees an open meshed channel.' },
    { id: 'quality', title: 'Fidelity and quality are separate acceptance axes', explanation: 'A mesh may preserve each fin yet contain excessive non-orthogonality, skewness, or self-intersection.', misconception: 'More refinement automatically improves every quality metric.' },
  ],
  flow360Concepts: [
    { id: 'modular', title: 'ModularMeshingWorkflow separates meshing stages', explanation: 'T10 configures snappy SurfaceMeshingParams while keeping later volume-mesh choices explicit.', misconception: 'Snappy surface defaults are interchangeable with legacy MeshingParams defaults.' },
    { id: 'refinement', title: 'Body, Region, and Edge refinements solve different risks', explanation: 'Body controls the part, Region tightens fin faces and proximity, and SurfaceEdge retains sharp roots and tips.', misconception: 'The smallest global spacing is the most efficient local-feature strategy.' },
    { id: 'pipeline', title: 'Castellating, snapping, and smoothing are coupled', explanation: 'Octree cells approximate CAD, snapping moves them to it, and smoothing limits distortion without erasing retained features.', misconception: 'Strict snapping guarantees a valid mesh without quality review.' },
  ],
  derivations: [
    { id: 'channel', parameter: 'Samples across channel width', basis: 'Use 14 mm width and 1.953125 mm fin-region maximum spacing.', calculation: '14 / 1.953125 = 7.168 samples', transfer: 'Recompute from the narrowest manufactured passage and effective octree spacing.' },
    { id: 'fin', parameter: 'Samples across fin thickness', basis: 'Use 4 mm thickness and 0.9765625 mm minimum feature spacing.', calculation: '4 / 0.9765625 = 4.096 samples', transfer: 'Increase sampling when geometric tolerance or coupled heat transfer requires it.' },
    { id: 'levels', parameter: 'Octree refinement sequence', basis: 'Each successive octree level halves spacing.', calculation: '15.625 → 7.8125 → 3.90625 → 1.953125 mm', transfer: 'Use transition cells to limit abrupt size changes while monitoring cell growth.' },
  ],
  experiments: [{ id: 'feature', prediction: 'What changes when feature-aware refinements are enabled while CAD and quality limits stay fixed?', options: ['Fin thickness, channel openness, and sharp edges improve at higher local cell cost', 'Farfield size and heat-sink dimensions change'], controlledVariable: 'Geometry, farfield, default spacing, smoothing, quality limits, and evidence views remain fixed.', observation: 'Compare topology, channel sections, fin dimensions, edge retention, transitions, quality metrics, and surface-cell count.' }],
  failureModes: [
    { id: 'groups', symptom: 'A refinement resolves no entity or the wrong part.', cause: 'Body or face groups differ from the imported Geometry catalog.', correction: 'Resolve canonical heatSink and fins groups before synchronizing the Draft.' },
    { id: 'channel', symptom: 'A cooling passage is bridged or disappears.', cause: 'Gap or proximity spacing is too coarse.', correction: 'Tighten local controls and inspect orthogonal channel sections.' },
    { id: 'edge', symptom: 'Fin roots or tips become rounded or detached.', cause: 'Edge extraction, snapping, or smoothing fails to retain the feature.', correction: 'Review included angle and distance spacing, then rebalance snapping and smoothing.' },
    { id: 'quality', symptom: 'The detailed mesh violates quality limits.', cause: 'Aggressive local snapping creates distorted transitions.', correction: 'Increase transition cells, adjust snap or smooth controls, and rerun the comparison.' },
  ],
  evidenceRubric: [
    { id: 'ownership', observation: 'Geometry ownership', pass: 'heatSink, base, and fins resolve once and refinements use the intended groups.', fail: 'Any group is absent, duplicated, or stale.' },
    { id: 'topology', observation: 'Watertight topology', pass: 'One closed component remains without holes, intersections, or bridges.', fail: 'A fin detaches, a channel closes, or a non-manifold edge appears.' },
    { id: 'dimensions', observation: 'Feature dimensions', pass: 'All six fins and five channels remain measurable within tolerance.', fail: 'Any fin or channel is lost or materially displaced.' },
    { id: 'quality', observation: 'Configured quality metrics', pass: 'Non-orthogonality and skewness remain within limits.', fail: 'Cells outside the quality contract are silently accepted.' },
    { id: 'cost', observation: 'Local cost versus benefit', pass: 'Added cells concentrate near targeted features and improve fidelity.', fail: 'Cell count grows broadly without feature improvement.' },
  ],
  transferQuestions: [{ prompt: 'When should RegionRefinement replace a smaller global spacing?', expected: 'When only named surfaces or proximity regions need the finer scale and global refinement would waste cells.' }, { prompt: 'What changes if the channel shrinks from 14 mm to 8 mm?', expected: 'Recompute samples, tighten gap or proximity spacing, and repeat topology and quality evidence.' }],
}

export function t10Params(featureAware: boolean): Record<string, unknown> { return featureAware ? mergeTutorialPatch(t10Baseline, t10FeaturePatch) as Record<string, unknown> : t10Baseline }
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
function stored(value: unknown) { const values = record(value).stored_entities; return Array.isArray(values) ? values.map(record) : [] }
function quantity(value: unknown) { return Number(record(value).value) }
export function t10ConfiguredPatch(featureAware: boolean): Record<string, unknown> { const params = t10Params(featureAware); const cache = record(params.private_attribute_asset_cache); return { ...params, private_attribute_asset_cache: { use_inhouse_mesher: cache.use_inhouse_mesher } } }
export function validateT10Setup(params: Record<string, unknown>): SetupCheck[] {
  const workflow = record(params.meshing); const surface = record(workflow.surface_meshing); const defaults = record(surface.defaults)
  const refinements = Array.isArray(surface.refinements) ? surface.refinements.map(record) : []
  const body = refinements.find((item) => item.refinement_type === 'SnappyBodyRefinement'); const region = refinements.find((item) => item.refinement_type === 'SnappySurfaceRefinement'); const edge = refinements.find((item) => item.refinement_type === 'SnappySurfaceEdgeRefinement')
  const featureAware = refinements.length > 0; const snap = record(surface.snap_controls); const quality = record(surface.quality_metrics); const castellated = record(surface.castellated_mesh_controls)
  const bodyName = body ? stored(body.entities)[0]?.name : undefined; const regionName = region ? stored(region.entities)[0]?.name : undefined; const edgeName = edge ? stored(edge.entities)[0]?.name : undefined
  return [
    { id: 'workflow', label: 'Modular snappy workflow is explicit', detail: 'SurfaceMeshingParams is separated from later volume meshing and uses an automatic farfield.', passed: workflow.type_name === 'ModularMeshingWorkflow' && surface.type_name === 'SnappySurfaceMeshingParams' && Array.isArray(workflow.zones) },
    { id: 'spacing', label: 'Global octree spacing is bounded', detail: 'Minimum 1.953125 mm, maximum 15.625 mm, and 12 mm gap resolution are serialized.', passed: quantity(defaults.min_spacing) === 0.001953125 && quantity(defaults.max_spacing) === 0.015625 && quantity(defaults.gap_resolution) === 0.012 },
    { id: 'quality', label: 'Quality acceptance is explicit', detail: '70° non-orthogonality, 12° boundary skewness, and 35° internal skewness limits are active.', passed: quantity(quality.max_non_orthogonality) === 70 && quantity(quality.max_boundary_skewness) === 12 && quantity(quality.max_internal_skewness) === 35 },
    { id: 'pipeline', label: featureAware ? 'Feature-aware snapping is active' : 'Global-only baseline is isolated', detail: featureAware ? 'Two transition cells and strict region snapping support local refinements.' : 'One transition cell and no local refinements establish the control case.', passed: featureAware ? Number(castellated.n_cells_between_levels) === 2 && snap.strict_region_snap === true : refinements.length === 0 && Number(castellated.n_cells_between_levels) === 1 },
    { id: 'entities', label: featureAware ? 'Body, region, and edge targets resolve' : 'No hidden feature control is present', detail: featureAware ? 'Body and edge controls target heatSink while region control targets fins.' : 'The baseline contains no body, region, or edge refinement.', passed: featureAware ? refinements.length === 3 && bodyName === 'heatSink' && regionName === 'fins' && edgeName === 'heatSink' : refinements.length === 0 },
  ]
}
export function t10Progress(completed: string[]): number { const unique = new Set(completed.filter((id) => t10Steps.some((step) => step.id === id))); return Math.round((unique.size / t10Steps.length) * 100) }
function identifier(result: unknown, key: string): string { const value = record(result)[key]; return typeof value === 'string' ? value.trim() : '' }
export async function createT10Environment(input: { folderId: string; projectName: string }, client: TutorialEnvironmentClient, onStage: (stage: TutorialEnvironmentStage) => void = () => undefined, fetchAsset: typeof fetch = fetch): Promise<TutorialEnvironmentResult> {
  onStage('staging'); if (![false, true].every((feature) => validateT10Setup(t10Params(feature)).every((check) => check.passed))) throw new Error('The bundled T10 parameters contain an invalid snappy workflow, quality limit, or refinement target.')
  const response = await fetchAsset(geometryUrl); if (!response.ok) throw new Error('The bundled T10 heat-sink Geometry could not be loaded.')
  const form = new FormData(); form.set('name', input.projectName); form.set('source_type', 'geometry'); form.set('unit', 'm'); form.set('workflow', 'standard'); form.set('solver_version', 'release-25.10'); form.set('folder_id', input.folderId); form.set('tags', 'tutorial,T10'); form.append('files', await response.blob(), 'finned-heat-sink.csm')
  const staged = await client.stageImport(form); const approved = await client.approveImport(staged.id); onStage('creating-project'); const submitted = await client.runImport(approved.id, true)
  const projectId = identifier(submitted.result, 'project_id'); const geometryId = identifier(submitted.result, 'root_resource_id'); if (!projectId || !geometryId) throw new Error('Flow360 created the T10 Project without returning its Geometry identifiers.')
  onStage('creating-drafts'); const [baselineDraft, variantDraft] = await Promise.all([client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T10 baseline · global snappy defaults', patch: t10ConfiguredPatch(false) }), client.createConfiguredDraft(projectId, { source_id: geometryId, name: 'T10 variant · feature-aware snappy', patch: t10ConfiguredPatch(true) })]); onStage('ready')
  return { projectId, rootResourceId: geometryId, baselineDraft, variantDraft }
}
