import type {
  AgentAction,
  AgentProposal,
  ProjectInfo,
  ResourceDetail,
} from '../api/client'
import type { UVFFieldInfo, UVFFieldProbe } from './uvf-three'
import {
  surfaceMeshParameterSummary,
  surfaceQualityRiskDirection,
  type SurfaceParameterRow,
} from './surfaceMeshReview'
import { unwrapSimulationParams, valueAtPath } from './planStages'

export type SurfaceParameterDifference = {
  path: string
  label: string
  baseline?: string
  comparison?: string
  kind: 'added' | 'removed' | 'changed'
}

export type SurfaceRemediationRecommendation = {
  name: string
  intent: string
  patch: Record<string, unknown>
  evidence: Array<{ key: string; value: unknown; description: string }>
}

export function compareSurfaceParameters(
  baseline: SurfaceParameterRow[],
  comparison: SurfaceParameterRow[],
): SurfaceParameterDifference[] {
  const left = new Map(baseline.map((row) => [row.path, row]))
  const right = new Map(comparison.map((row) => [row.path, row]))
  return Array.from(new Set([...left.keys(), ...right.keys()]))
    .flatMap((path) => {
      const before = left.get(path)
      const after = right.get(path)
      if (before?.value === after?.value) return []
      return [{
        path,
        label: before?.label ?? after?.label ?? path,
        baseline: before?.value,
        comparison: after?.value,
        kind: !before ? 'added' as const : !after ? 'removed' as const : 'changed' as const,
      }]
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function measurementDistance(points: Array<[number, number, number]>): number | null {
  if (points.length !== 2) return null
  return Math.hypot(
    points[1][0] - points[0][0],
    points[1][1] - points[0][1],
    points[1][2] - points[0][2],
  )
}

export function buildSurfaceRemediationRecommendation({
  field,
  probe,
  simulationParams,
}: {
  field: UVFFieldInfo
  probe: UVFFieldProbe
  simulationParams: ResourceDetail['simulation_params']
}): SurfaceRemediationRecommendation {
  const params = unwrapSimulationParams(simulationParams)
  const defaults: Record<string, unknown> = {}
  const maxEdge = valueAtPath(params, 'meshing.defaults.surface_max_edge_length')
  const growthRate = valueAtPath(params, 'meshing.defaults.surface_edge_growth_rate')
  const aspectRatio = valueAtPath(params, 'meshing.defaults.surface_max_aspect_ratio')
  const normalized = field.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()

  if (maxEdge !== undefined) defaults.surface_max_edge_length = scaleParameter(maxEdge, 0.75)
  defaults.surface_edge_growth_rate = typeof growthRate === 'number'
    ? Math.min(growthRate, 1.15)
    : 1.15
  if (/aspect|skew|quality/.test(normalized)) {
    defaults.surface_max_aspect_ratio = typeof aspectRatio === 'number'
      ? Math.min(aspectRatio, 20)
      : 20
  }
  if (/angle|curvature/.test(normalized)) {
    const current = valueAtPath(params, 'meshing.defaults.curvature_resolution_angle')
    defaults.curvature_resolution_angle = current === undefined
      ? { value: 12, units: 'degree' }
      : scaleParameter(current, 0.8)
  }
  const direction = surfaceQualityRiskDirection(field.name)
  const evidence = [
    {
      key: 'quality_field',
      value: field.name,
      description: `${direction === 'max' ? 'High' : 'Low'} ${field.name} identified by SurfaceMesh review`,
    },
    {
      key: 'observed_value',
      value: probe.value,
      description: `Observed at Face ${probe.entityId}`,
    },
    {
      key: 'location',
      value: probe.position,
      description: 'Manifest-coordinate probe position',
    },
  ]
  return {
    name: `Remediate ${field.name} near ${probe.entityId}`,
    intent: `Reduce the ${direction === 'max' ? 'highest' : 'lowest'} ${field.name} issue (${probe.value.toPrecision(6)}) observed on Face ${probe.entityId}. Review the proposed SurfaceMesh defaults and preflight before approval.`,
    patch: { meshing: { defaults } },
    evidence,
  }
}

export function remediationAgentAction({
  recommendation,
  project,
  geometryId,
  geometryName,
}: {
  recommendation: SurfaceRemediationRecommendation
  project: ProjectInfo
  geometryId: string
  geometryName: string
}): AgentAction {
  const proposal: AgentProposal = {
    id: `surface-remediation-${Date.now()}`,
    project_id: project.id,
    project_name: project.name,
    source_id: geometryId,
    source_type: 'Geometry',
    source_name: geometryName,
    action: 'Geometry',
    target: 'surface-mesh',
    name: recommendation.name,
    intent: recommendation.intent,
    patch: recommendation.patch,
    branch_preview: `${geometryName} → remediated Surface Mesh`,
    fields: recommendation.evidence.map((item) => ({
      key: item.key,
      value: item.value,
      provenance: 'derived',
      description: item.description,
    })),
    validation_hints: [
      'Run SurfaceMesh schema preflight',
      'Compare the resulting quality distribution with the current mesh',
    ],
  }
  return {
    version: 'v1',
    kind: 'create-plan',
    message: 'Create an evidence-backed SurfaceMesh remediation plan for review.',
    proposals: [proposal],
    warnings: ['This creates a draft plan only; Flow360 execution still requires review and approval.'],
  }
}

export function surfaceComparisonParameters(detail: ResourceDetail | null): SurfaceParameterRow[] {
  return surfaceMeshParameterSummary(detail?.simulation_params)
}

function scaleParameter(value: unknown, factor: number): unknown {
  if (typeof value === 'number') return value * factor
  if (value && typeof value === 'object' && 'value' in value) {
    const quantity = value as Record<string, unknown>
    return typeof quantity.value === 'number'
      ? { ...quantity, value: quantity.value * factor }
      : value
  }
  return value
}
