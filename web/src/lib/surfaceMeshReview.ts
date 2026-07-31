import type { UVFFieldInfo } from './uvf-three'
import {
  compactParameterValue,
  unwrapSimulationParams,
  valueAtPath,
} from './planStages'

export type SurfaceGroup = {
  id: string
  name: string
  triangles?: number
}

export type SurfaceBoundaryAssignment = {
  modelName: string
  modelType: string
}

export type SurfaceBoundaryRow = SurfaceGroup & {
  assignments: SurfaceBoundaryAssignment[]
  status: 'assigned' | 'unassigned' | 'conflict'
}

export type SurfaceParameterRow = {
  path: string
  label: string
  value: string
}

const surfaceParameterPaths = [
  'meshing.defaults.surface_max_edge_length',
  'meshing.defaults.surface_edge_growth_rate',
  'meshing.defaults.curvature_resolution_angle',
  'meshing.defaults.surface_max_aspect_ratio',
  'meshing.defaults.surface_max_adaptation_iterations',
  'meshing.defaults.target_surface_node_count',
  'meshing.refinements',
  'meshing.surface_meshing',
  'meshing.outputs',
] as const

const qualityFieldPattern = /(?:^|[_\s-])(area|aspect(?:_ratio)?|angle|skew(?:ness)?|quality|curvature|edge[_\s-]*length|incircle|circumcircle|size)(?:$|[_\s-])/i

export function buildSurfaceBoundaryInventory(
  groups: SurfaceGroup[],
  simulationParams: unknown,
): SurfaceBoundaryRow[] {
  const params = unwrapSimulationParams(simulationParams)
  const models = Array.isArray(params.models) ? params.models : []
  const assignments = new Map<string, SurfaceBoundaryAssignment[]>()

  for (const candidate of models) {
    if (!isRecord(candidate) || !isRecord(candidate.surfaces)) continue
    const entities = candidate.surfaces.stored_entities
    if (!Array.isArray(entities)) continue
    const assignment = {
      modelName: stringValue(candidate.name) || stringValue(candidate.type) || 'Unnamed model',
      modelType: stringValue(candidate.type) || 'Unknown',
    }
    for (const entity of entities) {
      if (!isRecord(entity)) continue
      const keys = entityKeys(entity)
      const matched = keys.includes('*')
        ? groups
        : groups.filter((group) => keys.includes(group.id) || keys.includes(group.name))
      for (const group of matched) {
        const current = assignments.get(group.id) ?? []
        if (!current.some((item) => item.modelName === assignment.modelName && item.modelType === assignment.modelType)) {
          current.push(assignment)
          assignments.set(group.id, current)
        }
      }
    }
  }

  return groups.map((group) => {
    const groupAssignments = assignments.get(group.id) ?? []
    return {
      ...group,
      assignments: groupAssignments,
      status: groupAssignments.length === 0
        ? 'unassigned'
        : groupAssignments.length === 1 ? 'assigned' : 'conflict',
    }
  })
}

export function surfaceMeshParameterSummary(simulationParams: unknown): SurfaceParameterRow[] {
  const params = unwrapSimulationParams(simulationParams)
  return surfaceParameterPaths.flatMap((path) => {
    const raw = valueAtPath(params, path)
    if (raw === undefined || raw === null) return []
    return [{
      path,
      label: humanize(path.split('.').at(-1) ?? path),
      value: compactParameterValue(raw),
    }]
  })
}

export function classifySurfaceMeshQualityFields(fields: UVFFieldInfo[]): UVFFieldInfo[] {
  return fields.filter((field) => qualityFieldPattern.test(normalizeFieldName(field.name)))
}

export function surfaceQualityRiskDirection(fieldName: string): 'min' | 'max' {
  const normalized = normalizeFieldName(fieldName)
  return /\b(min(?:imum)?|orthogonality|quality)\b/i.test(normalized) ? 'min' : 'max'
}

function entityKeys(entity: Record<string, unknown>): string[] {
  const values = [
    entity.private_attribute_id,
    entity.name,
    ...(Array.isArray(entity.private_attribute_sub_components)
      ? entity.private_attribute_sub_components
      : []),
  ]
  return values
    .map(stringValue)
    .filter((value): value is string => Boolean(value))
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function humanize(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normalizeFieldName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
