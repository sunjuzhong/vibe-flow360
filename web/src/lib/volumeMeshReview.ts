import type { ResourceDetail } from '../api/client'
import type { MeshGroupData } from '../components/viewer/LazyViewer3D'
import type { UVFFieldInfo } from './uvf-three'
import {
  compactParameterValue,
  unwrapSimulationParams,
  valueAtPath,
} from './planStages'

export type VolumeViewMode = 'overview' | 'zones' | 'quality' | 'slices'

export type VolumeCapabilityStatus = 'available' | 'proxy' | 'unavailable'

export type VolumeCapability = {
  key: 'asset' | 'zones' | 'quality' | 'slices' | 'parameters'
  label: string
  status: VolumeCapabilityStatus
  detail: string
}

export type VolumeZoneType = 'fluid' | 'solid' | 'rotation' | 'porous' | 'farfield' | 'unknown'

export type VolumeZoneRow = MeshGroupData & {
  zoneType: VolumeZoneType
  typeProvenance: 'provided' | 'name-inferred' | 'unknown'
}

export type VolumeParameterRow = {
  path: string
  label: string
  value: string
  section: 'Boundary layer' | 'Domain and zones' | 'Refinements' | 'Mesher controls' | 'Outputs'
}

export type VolumeReadinessCheck = {
  label: string
  status: 'ready' | 'warning' | 'blocked' | 'missing'
  hint: string
}

const qualityFieldPattern = /(?:^|[_\s-])(aspect(?:[_\s-]*ratio)?|edge(?:[_\s-]*length)?|cell(?:[_\s-]*volume)?|volume|jacobian|orthog(?:onality)?|skew(?:ness)?|quality|non[_\s-]*orthogonal)(?:$|[_\s-])/i

const parameterPaths: Array<Pick<VolumeParameterRow, 'path' | 'section'>> = [
  { path: 'meshing.defaults.boundary_layer_first_layer_thickness', section: 'Boundary layer' },
  { path: 'meshing.defaults.boundary_layer_growth_rate', section: 'Boundary layer' },
  { path: 'meshing.defaults.number_of_boundary_layers', section: 'Boundary layer' },
  { path: 'meshing.defaults.volume_edge_growth_rate', section: 'Mesher controls' },
  { path: 'meshing.defaults.sliding_interface_tolerance', section: 'Mesher controls' },
  { path: 'meshing.gap_treatment_strength', section: 'Mesher controls' },
  { path: 'meshing.volume_zones', section: 'Domain and zones' },
  { path: 'meshing.refinements', section: 'Refinements' },
  { path: 'meshing.volume_meshing', section: 'Mesher controls' },
  { path: 'meshing.outputs', section: 'Outputs' },
]

export function classifyVolumeMeshQualityFields(fields: UVFFieldInfo[]): UVFFieldInfo[] {
  return fields.filter((field) => field.kind === 'scalar' && qualityFieldPattern.test(normalizeFieldName(field.name)))
}

export function volumeQualityRiskDirection(fieldName: string): 'min' | 'max' {
  const normalized = normalizeFieldName(fieldName)
  if (/minimum|min edge|cell volume|jacobian|orthogonality|quality/.test(normalized)) return 'min'
  return 'max'
}

export function volumeMeshParameterSummary(simulationParams: unknown): VolumeParameterRow[] {
  const params = unwrapSimulationParams(simulationParams)
  return parameterPaths.flatMap(({ path, section }) => {
    const raw = valueAtPath(params, path)
    if (raw === undefined || raw === null) return []
    return [{
      path,
      section,
      label: humanize(path.split('.').at(-1) ?? path),
      value: compactParameterValue(raw),
    }]
  })
}

export function buildVolumeZoneInventory(
  groups: MeshGroupData[],
  detail: ResourceDetail | null,
): VolumeZoneRow[] {
  const zoneTypes = collectProvidedZoneTypes(detail)
  return groups.map((group) => {
    const provided = zoneTypes.get(normalizeKey(group.id)) ?? zoneTypes.get(normalizeKey(group.name))
    if (provided) return { ...group, zoneType: provided, typeProvenance: 'provided' }
    const inferred = inferZoneType(group.name)
    return {
      ...group,
      zoneType: inferred,
      typeProvenance: inferred === 'unknown' ? 'unknown' : 'name-inferred',
    }
  })
}

export function volumeMeshCapabilities({
  detail,
  previewSource,
  groups,
  fields,
}: {
  detail: ResourceDetail | null
  previewSource: 'primary' | 'fallback' | 'none'
  groups: MeshGroupData[]
  fields: UVFFieldInfo[]
}): VolumeCapability[] {
  const qualityFields = classifyVolumeMeshQualityFields(fields)
  const parameters = volumeMeshParameterSummary(detail?.simulation_params)
  const aggregateQuality = findMetric(
    [detail?.summary, detail?.state],
    ['minimum_orthogonality', 'min_orthogonality', 'max_skewness', 'maximum_skewness', 'min_cell_size', 'minimum_cell_size'],
  )
  const hasExplicitSlices = fields.some((field) => /(?:^|[_\s-])slice(?:$|[_\s-])/i.test(field.name))
  return [
    {
      key: 'asset',
      label: 'Volume asset',
      status: previewSource === 'primary' ? 'available' : previewSource === 'fallback' ? 'proxy' : 'unavailable',
      detail: previewSource === 'primary'
        ? 'The viewer is using the selected VolumeMesh asset.'
        : previewSource === 'fallback'
          ? 'Parent Geometry is shown only for spatial context.'
          : 'No renderable VolumeMesh asset is available.',
    },
    {
      key: 'zones',
      label: 'Zone inventory',
      status: previewSource === 'primary' && groups.length > 0 ? 'available' : groups.length > 0 ? 'proxy' : 'unavailable',
      detail: groups.length > 0
        ? `${groups.length} render group${groups.length === 1 ? '' : 's'} reported.`
        : 'No cell zones or render regions were reported.',
    },
    {
      key: 'quality',
      label: 'Cell-quality fields',
      status: qualityFields.length > 0 ? 'available' : isReported(aggregateQuality) ? 'proxy' : 'unavailable',
      detail: qualityFields.length > 0
        ? `${qualityFields.length} scalar quality field${qualityFields.length === 1 ? '' : 's'} available.`
        : isReported(aggregateQuality)
          ? 'Aggregate quality metrics are reported, but no spatial cell-quality field is available.'
          : 'No aspect ratio, edge length, cell volume, Jacobian, orthogonality, or skewness field is present.',
    },
    {
      key: 'slices',
      label: 'Volume slices',
      status: hasExplicitSlices ? 'available' : previewSource === 'primary' ? 'proxy' : 'unavailable',
      detail: hasExplicitSlices
        ? 'The asset reports slice data.'
        : previewSource === 'primary'
          ? 'Interactive clipping is available; it is not a generated flat or crinkled mesh slice.'
          : 'Slice diagnostics require a real VolumeMesh asset.',
    },
    {
      key: 'parameters',
      label: 'Volume parameters',
      status: parameters.length > 0 ? 'available' : 'unavailable',
      detail: parameters.length > 0
        ? `${parameters.length} volume-meshing parameter group entr${parameters.length === 1 ? 'y' : 'ies'} found.`
        : 'Volume-meshing parameters are not present in this resource snapshot.',
    },
  ]
}

export function computeVolumeReadiness({
  detail,
  previewSource = 'none',
  groups = [],
  fields = [],
}: {
  detail: ResourceDetail | null
  previewSource?: 'primary' | 'fallback' | 'none'
  groups?: MeshGroupData[]
  fields?: UVFFieldInfo[]
}): VolumeReadinessCheck[] {
  const status = resourceLifecycleStatus(detail)
  const cellCount = findMetric([detail?.summary, detail?.state], ['cell_count', 'num_cells', 'cells', 'element_count', 'volume_cell_count'])
  const capabilities = volumeMeshCapabilities({ detail, previewSource, groups, fields })
  const asset = capabilities.find((capability) => capability.key === 'asset')!
  const zones = capabilities.find((capability) => capability.key === 'zones')!
  const quality = capabilities.find((capability) => capability.key === 'quality')!
  const parameters = capabilities.find((capability) => capability.key === 'parameters')!
  const noErrors = !detail?.errors || Object.keys(detail.errors).length === 0
  return [
    {
      label: 'Meshing lifecycle completed',
      status: ['completed', 'processed', 'success'].includes(status)
        ? 'ready'
        : ['failed', 'error'].includes(status) ? 'blocked' : 'warning',
      hint: `Current status: ${status || 'unknown'}`,
    },
    {
      label: 'Real VolumeMesh evidence is loaded',
      status: asset.status === 'available' ? 'ready' : asset.status === 'proxy' ? 'warning' : 'missing',
      hint: asset.detail,
    },
    {
      label: 'Cell count is reported',
      status: isReported(cellCount) ? 'ready' : 'missing',
      hint: isReported(cellCount) ? `Cell count: ${metricText(cellCount)}` : 'No cell count was reported by Flow360.',
    },
    {
      label: 'Zone inventory is available',
      status: zones.status === 'available' ? 'ready' : zones.status === 'proxy' ? 'warning' : 'missing',
      hint: zones.detail,
    },
    {
      label: 'Cell-quality evidence is available',
      status: quality.status === 'available' ? 'ready' : quality.status === 'proxy' ? 'warning' : 'missing',
      hint: quality.detail,
    },
    {
      label: 'Volume meshing parameters are traceable',
      status: parameters.status === 'available' ? 'ready' : 'missing',
      hint: parameters.detail,
    },
    {
      label: 'No partial Flow360 reads were reported',
      status: noErrors ? 'ready' : 'warning',
      hint: noErrors ? 'All resource reads succeeded.' : `${Object.keys(detail?.errors ?? {}).length} partial read(s) require review.`,
    },
  ]
}

function collectProvidedZoneTypes(detail: ResourceDetail | null): Map<string, VolumeZoneType> {
  const result = new Map<string, VolumeZoneType>()
  const candidates = [
    findMetric(detail?.info, ['regions', 'zones', 'volume_zones']),
    valueAtPath(unwrapSimulationParams(detail?.simulation_params), 'meshing.volume_zones'),
  ]
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue
    for (const item of candidate) {
      if (!isRecord(item)) continue
      const type = inferZoneType(String(item.type ?? item.model_type ?? item.zone_type ?? ''))
      if (type === 'unknown') continue
      for (const key of [item.id, item.name, item.private_attribute_id]) {
        if (typeof key === 'string' && key.trim()) result.set(normalizeKey(key), type)
      }
    }
  }
  return result
}

function inferZoneType(value: string): VolumeZoneType {
  const normalized = normalizeFieldName(value)
  if (/farfield|freestream|external/.test(normalized)) return 'farfield'
  if (/rotation|rotating|sliding/.test(normalized)) return 'rotation'
  if (/porous/.test(normalized)) return 'porous'
  if (/solid|heat transfer/.test(normalized)) return 'solid'
  if (/fluid|volume|domain/.test(normalized)) return 'fluid'
  return 'unknown'
}

function resourceLifecycleStatus(detail: ResourceDetail | null): string {
  const value = findMetric([detail?.state, detail?.info], ['status', 'state'])
  return typeof value === 'string' ? value.toLowerCase() : 'unknown'
}

function findMetric(value: unknown, aliases: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMetric(item, aliases)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const [key, child] of Object.entries(value)) {
    if (aliases.includes(key.toLowerCase())) return child
    const found = findMetric(child, aliases)
    if (found !== undefined) return found
  }
  return undefined
}

function isReported(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

function metricText(value: unknown): string {
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (isRecord(value) && 'value' in value) {
    return `${value.value ?? '—'}${value.units ? ` ${value.units}` : ''}`
  }
  return JSON.stringify(value)
}

function normalizeFieldName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .toLowerCase()
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function humanize(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
