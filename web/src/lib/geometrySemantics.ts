import type {
  AgentAction,
  ProjectInfo,
} from '../api/client'
import type { MeshGroupData } from '../components/viewer/LazyViewer3D'

export type GeometrySurfaceRole =
  | 'wall'
  | 'farfield'
  | 'symmetry'
  | 'periodic'
  | 'inlet'
  | 'outlet'
  | 'ground'
  | 'rotating'
  | 'interface'
  | 'exclude'

export type GeometryBodyIntent =
  | 'external-aerodynamics'
  | 'internal-flow'
  | 'rotating-machinery'
  | 'conjugate-heat-transfer'
  | 'undecided'

export type GeometrySemanticAssignment = {
  groupId: string
  groupName: string
  role: GeometrySurfaceRole
  provenance: 'provided' | 'inferred'
  reason: string
}

export type GeometrySemanticDraft = {
  bodyIntent: GeometryBodyIntent
  assignments: GeometrySemanticAssignment[]
}

export const geometrySurfaceRoles: Array<{
  value: GeometrySurfaceRole
  label: string
  description: string
}> = [
  { value: 'wall', label: 'Wall', description: 'No-slip or physical solid surface' },
  { value: 'farfield', label: 'Farfield', description: 'External aerodynamic domain boundary' },
  { value: 'symmetry', label: 'Symmetry', description: 'Symmetry or slip plane' },
  { value: 'periodic', label: 'Periodic', description: 'Paired periodic boundary surface' },
  { value: 'inlet', label: 'Inlet', description: 'Prescribed inflow boundary' },
  { value: 'outlet', label: 'Outlet', description: 'Outflow or pressure boundary' },
  { value: 'ground', label: 'Ground', description: 'Stationary or moving ground plane' },
  { value: 'rotating', label: 'Rotating', description: 'Blade, rotor, wheel, or rotating wall' },
  { value: 'interface', label: 'Interface', description: 'Fluid or rotating-zone interface' },
  { value: 'exclude', label: 'Exclude', description: 'Do not include in the meshing intent' },
]

export function geometrySurfaceRoleForBoundary(boundaryType: string): GeometrySurfaceRole | null {
  const normalized = boundaryType.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (!normalized) return null
  if (normalized.includes('periodic')) return 'periodic'
  if (normalized.includes('symmetry') || normalized.includes('slip')) return 'symmetry'
  if (normalized.includes('freestream') || normalized.includes('farfield')) return 'farfield'
  if (normalized.includes('inflow') || normalized.includes('inlet')) return 'inlet'
  if (normalized.includes('outflow') || normalized.includes('outlet')) return 'outlet'
  if (normalized.includes('rotating') || normalized.includes('rotation')) return 'rotating'
  if (normalized.includes('interface') || normalized.includes('porous') || normalized.includes('jump')) return 'interface'
  if (normalized.includes('wall') || normalized === 'ground') return normalized === 'ground' ? 'ground' : 'wall'
  return null
}

export function inferGeometrySurfaceRole(
  group: Pick<MeshGroupData, 'id' | 'name'>,
): GeometrySemanticAssignment | null {
  const normalized = `${group.name} ${group.id}`
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .toLowerCase()
  const match = (
    role: GeometrySurfaceRole,
    pattern: RegExp,
    reason: string,
  ): GeometrySemanticAssignment | null => pattern.test(normalized)
    ? {
        groupId: group.id,
        groupName: group.name,
        role,
        provenance: 'inferred',
        reason,
      }
    : null

  return match('farfield', /\b(far\s*field|freestream|enclosure|domain outer)\b/, 'Name indicates an external domain boundary.')
    ?? match('symmetry', /\b(symmetry|symm|slip plane)\b/, 'Name indicates a symmetry or slip plane.')
    ?? match('inlet', /\b(inlet|inflow|intake)\b/, 'Name indicates an inflow boundary.')
    ?? match('outlet', /\b(outlet|outflow|exhaust)\b/, 'Name indicates an outflow boundary.')
    ?? match('ground', /\b(ground|road|floor)\b/, 'Name indicates a ground or floor surface.')
    ?? match('rotating', /\b(rotor|blade|propeller|fan|wheel)\b/, 'Name indicates a rotating component surface.')
    ?? match('interface', /\b(interface|sliding|ami)\b/, 'Name indicates a zone interface.')
    ?? match('wall', /\b(wall|wing|fuselage|body|vehicle|solid|heat sink)\b/, 'Name indicates a physical solid surface.')
}

export function suggestGeometrySemantics(
  groups: Array<Pick<MeshGroupData, 'id' | 'name'>>,
): GeometrySemanticAssignment[] {
  return groups.flatMap((group) => {
    const assignment = inferGeometrySurfaceRole(group)
    return assignment ? [assignment] : []
  })
}

export function geometryMeasurementDistance(
  points: Array<[number, number, number]>,
): number | null {
  if (points.length !== 2) return null
  return Math.hypot(
    points[1][0] - points[0][0],
    points[1][1] - points[0][1],
    points[1][2] - points[0][2],
  )
}

export function geometrySemanticAgentAction({
  project,
  geometryId,
  geometryName,
  draft,
}: {
  project: ProjectInfo
  geometryId: string
  geometryName: string
  draft: GeometrySemanticDraft
}): AgentAction {
  const provided = draft.assignments.filter((item) => item.provenance === 'provided')
  const inferred = draft.assignments.filter((item) => item.provenance === 'inferred')
  return {
    version: 'v1',
    kind: 'create-plan',
    message: 'Create a Geometry semantic review plan before SurfaceMesh execution.',
    proposals: [{
      id: `geometry-semantics-${Date.now()}`,
      project_id: project.id,
      project_name: project.name,
      source_id: geometryId,
      source_type: 'Geometry',
      source_name: geometryName,
      action: 'Geometry',
      target: 'surface-mesh',
      name: `Review CFD semantics for ${geometryName}`,
      intent: `Review ${draft.assignments.length} surface semantic assignment(s) for a ${draft.bodyIntent.replaceAll('-', ' ')} workflow, map them to Flow360-supported parameters, then run SurfaceMesh preflight before approval.`,
      patch: {},
      branch_preview: `${geometryName} → semantics review → Surface Mesh`,
      fields: [
        {
          key: 'geometry_body_intent',
          value: draft.bodyIntent,
          provenance: 'provided',
          description: 'User-reviewed CFD workflow intent for this Geometry.',
        },
        ...(provided.length > 0 ? [{
          key: 'provided_surface_semantics',
          value: provided,
          provenance: 'provided' as const,
          description: 'Surface roles explicitly assigned by the user in the Geometry review workspace.',
        }] : []),
        ...(inferred.length > 0 ? [{
          key: 'inferred_surface_semantics',
          value: inferred,
          provenance: 'inferred' as const,
          description: 'Name-based suggestions that require review before compilation.',
        }] : []),
      ],
      validation_hints: [
        'Map semantic intent only to models supported by the active Flow360 schema',
        'Report unassigned and conflicting surfaces before execution',
        'Run SurfaceMesh schema preflight and show the semantic parameter diff',
      ],
    }],
    assumptions: inferred.length > 0
      ? ['Name-based surface classifications are suggestions, not confirmed Flow360 boundary conditions.']
      : [],
    warnings: [
      'This creates a local review plan only; no Geometry or Flow360 resource is modified.',
      `${Math.max(0, draft.assignments.length - provided.length)} inferred assignment(s) require review.`,
    ],
  }
}
