export type SimulationStage = 'SurfaceMesh' | 'VolumeMesh' | 'Case'

export type StageParameterGroup = {
  label: string
  description: string
  paths: string[]
}

export type StageDefinition = {
  stage: SimulationStage
  label: string
  purpose: string
  groups: StageParameterGroup[]
  example: Record<string, unknown>
}

// These groups mirror the installed Flow360 SimulationParams schema:
// meshing children use relevant_for=SurfaceMesh/VolumeMesh, while the
// operating condition, models, solver controls and outputs are Case inputs.
export const stageDefinitions: Record<SimulationStage, StageDefinition> = {
  SurfaceMesh: {
    stage: 'SurfaceMesh',
    label: 'Surface Mesh',
    purpose: 'Discretize Geometry surfaces and capture geometric features.',
    groups: [
      {
        label: 'Surface sizing defaults',
        description: 'Maximum edge length, edge growth, curvature resolution, aspect ratio and adaptation limits.',
        paths: [
          'meshing.defaults.surface_max_edge_length',
          'meshing.defaults.surface_edge_growth_rate',
          'meshing.defaults.curvature_resolution_angle',
          'meshing.defaults.surface_max_aspect_ratio',
          'meshing.defaults.surface_max_adaptation_iterations',
          'meshing.defaults.target_surface_node_count',
        ],
      },
      {
        label: 'Surface refinements',
        description: 'Local surface, edge and geometry-driven refinement intent.',
        paths: ['meshing.refinements'],
      },
      {
        label: 'Surface meshing controls',
        description: 'Flow360 surface mesher controls and quality behavior.',
        paths: ['meshing.surface_meshing'],
      },
      {
        label: 'Meshing outputs',
        description: 'Requested diagnostics produced during meshing.',
        paths: ['meshing.outputs'],
      },
    ],
    example: {
      meshing: {
        defaults: {
          surface_max_edge_length: { value: 0.1, units: 'meter' },
        },
      },
    },
  },
  VolumeMesh: {
    stage: 'VolumeMesh',
    label: 'Volume Mesh',
    purpose: 'Create the computational domain, volume cells and near-wall layers.',
    groups: [
      {
        label: 'Volume and boundary-layer defaults',
        description: 'First-layer thickness, layer growth, volume growth, interfaces and gap treatment.',
        paths: [
          'meshing.defaults.boundary_layer_first_layer_thickness',
          'meshing.defaults.boundary_layer_growth_rate',
          'meshing.defaults.volume_edge_growth_rate',
          'meshing.defaults.sliding_interface_tolerance',
          'meshing.gap_treatment_strength',
        ],
      },
      {
        label: 'Volume zones and domain',
        description: 'Farfield, rotating/sliding zones and computational-domain definitions.',
        paths: ['meshing.volume_zones'],
      },
      {
        label: 'Volume refinements',
        description: 'Box, cylinder and region refinements that control cell density.',
        paths: ['meshing.refinements'],
      },
      {
        label: 'Volume meshing controls',
        description: 'Flow360 volume mesher and cell-quality controls.',
        paths: ['meshing.volume_meshing'],
      },
    ],
    example: {
      meshing: {
        defaults: {
          boundary_layer_first_layer_thickness: { value: 0.00001, units: 'meter' },
        },
      },
    },
  },
  Case: {
    stage: 'Case',
    label: 'Case',
    purpose: 'Define physics, operating conditions, solver behavior and result outputs.',
    groups: [
      {
        label: 'Operating condition',
        description: 'Velocity or Mach, angle of attack, sideslip and thermal state.',
        paths: ['operating_condition'],
      },
      {
        label: 'Models and boundary conditions',
        description: 'Fluid physics, wall/freestream boundaries, turbulence and transition models.',
        paths: ['models'],
      },
      {
        label: 'Solver and time stepping',
        description: 'Steady/unsteady stepping, CFL, maximum steps and run controls.',
        paths: ['time_stepping', 'run_control'],
      },
      {
        label: 'Reference geometry',
        description: 'Reference area, moment center and moment lengths used by force coefficients.',
        paths: ['reference_geometry'],
      },
      {
        label: 'Outputs and custom fields',
        description: 'Surface/volume outputs, monitors, user-defined fields and dynamics.',
        paths: ['outputs', 'user_defined_fields', 'user_defined_dynamics'],
      },
    ],
    example: {
      operating_condition: {
        alpha: { value: 0, units: 'degree' },
      },
    },
  },
}

const resourceOrder = ['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case']
const targetType: Record<string, SimulationStage> = {
  'surface-mesh': 'SurfaceMesh',
  'volume-mesh': 'VolumeMesh',
  case: 'Case',
}

export function downstreamStages(sourceType: string, target: string): SimulationStage[] {
  const sourceIndex = resourceOrder.indexOf(sourceType)
  const targetStage = targetType[target]
  const targetIndex = resourceOrder.indexOf(targetStage)
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex < sourceIndex) return []
  if (sourceType === 'Case' && targetStage === 'Case') return ['Case']
  return resourceOrder
    .slice(sourceIndex + 1, targetIndex + 1)
    .filter((stage): stage is SimulationStage => stage !== 'Geometry')
}

export function unwrapSimulationParams(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {}
  const nested = value.simulation_params
  return isRecord(nested) ? nested : value
}

export function hasPath(value: unknown, path: string): boolean {
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !(segment in current)) return false
    current = current[segment]
  }
  return current !== undefined && current !== null
}

export function valueAtPath(value: unknown, path: string): unknown {
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

export function mergeStagePatches(
  stages: SimulationStage[],
  stagePatches: Partial<Record<SimulationStage, Record<string, unknown>>>,
  advanced: Record<string, unknown>,
): Record<string, unknown> {
  const staged = stages.reduce(
    (result, stage) => deepMerge(result, stagePatches[stage] ?? {}),
    {},
  )
  return deepMerge(staged, advanced)
}

export function partitionPatchByStages(
  patch: Record<string, unknown>,
  activeStages: SimulationStage[],
): Record<SimulationStage, Record<string, unknown>> {
  const result: Record<SimulationStage, Record<string, unknown>> = {
    SurfaceMesh: {},
    VolumeMesh: {},
    Case: {},
  }
  const fallback = activeStages[activeStages.length - 1]
  const visit = (value: unknown, path: string[]) => {
    if (isRecord(value) && !isQuantity(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key])
      return
    }
    if (!path.length || !fallback) return
    const inferred = stageForPath(path.join('.'))
    const stage = activeStages.includes(inferred) ? inferred : fallback
    setPath(result[stage], path, value)
  }
  visit(patch, [])
  return result
}

export function stageForPath(path: string): SimulationStage {
  if (
    path.startsWith('operating_condition')
    || path.startsWith('models')
    || path.startsWith('time_stepping')
    || path.startsWith('run_control')
    || path.startsWith('reference_geometry')
    || path.startsWith('outputs')
    || path.startsWith('user_defined_')
  ) return 'Case'
  if (
    path.includes('boundary_layer')
    || path.includes('volume_')
    || path.includes('gap_treatment')
    || path.includes('sliding_interface')
  ) return 'VolumeMesh'
  return 'SurfaceMesh'
}

export function compactParameterValue(value: unknown): string {
  if (value === undefined) return 'Not set'
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (isRecord(value)) {
    if ('value' in value) {
      return `${String(value.value)}${value.units ? ` ${String(value.units)}` : ''}`
    }
    const count = Object.keys(value).length
    return `${count} field${count === 1 ? '' : 's'}`
  }
  return String(value)
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value)
    } else {
      result[key] = value
    }
  }
  return result
}

function setPath(target: Record<string, unknown>, path: string[], value: unknown) {
  let cursor = target
  path.forEach((segment, index) => {
    if (index === path.length - 1) {
      cursor[segment] = value
      return
    }
    if (!isRecord(cursor[segment])) cursor[segment] = {}
    cursor = cursor[segment] as Record<string, unknown>
  })
}

function isQuantity(value: Record<string, unknown>) {
  return 'value' in value && ('units' in value || Object.keys(value).length === 1)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
