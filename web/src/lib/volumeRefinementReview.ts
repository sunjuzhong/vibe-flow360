import type { BoundingBoxData, MeshGroupData } from '../components/viewer/LazyViewer3D'
import type { OverlayAnnotation } from './viewer-tools/overlays'
import type { ResourceRef, Vector3Tuple } from './viewer-tools/types'
import { compactParameterValue, unwrapSimulationParams, valueAtPath } from './planStages'

export type VolumeRefinementKind = 'uniform' | 'axisymmetric' | 'structured-box' | 'surface' | 'geometry' | 'other'
export type VolumeRefinementRegionKind = 'box' | 'cylinder' | 'sphere'

export type VolumeRefinementSpacing = {
  key: string
  label: string
  value: string
}

export type VolumeRefinementRegion = {
  id: string
  name: string
  kind: VolumeRefinementRegionKind
  center: Vector3Tuple
  bounds: BoundingBoxData
  unit?: string
  size?: Vector3Tuple
  axis?: Vector3Tuple
  height?: number
  radius?: number
  rotationAxis?: Vector3Tuple
  rotationAngleRadians?: number
}

export type VolumeRefinementRule = {
  id: string
  name: string
  kind: VolumeRefinementKind
  spacings: VolumeRefinementSpacing[]
  regions: VolumeRefinementRegion[]
  matchedTargets: Array<{ id: string; name: string }>
  unresolvedTargets: string[]
  targetCount: number
}

export type VolumeRefinementDiagnostic = {
  id: string
  severity: 'warning' | 'info'
  kind: 'empty-target' | 'unresolved-target' | 'outside-domain' | 'partial-domain' | 'overlap'
  title: string
  detail: string
  regionIds: string[]
}

export type VolumeRefinementReview = {
  rules: VolumeRefinementRule[]
  regions: VolumeRefinementRegion[]
  diagnostics: VolumeRefinementDiagnostic[]
  configured: boolean
  visualizableCount: number
  unresolvedTargetCount: number
}

const spacingKeys = [
  'spacing',
  'spacing_axial',
  'spacing_radial',
  'spacing_circumferential',
  'spacing_axis1',
  'spacing_axis2',
  'spacing_normal',
  'spacingAxial',
  'spacingRadial',
  'spacingCircumferential',
  'spacingAxis1',
  'spacingAxis2',
  'spacingNormal',
  'max_edge_length',
  'maxEdgeLength',
  'surface_edge_length',
]

export function buildVolumeRefinementReview({
  simulationParams,
  groups,
  boundingBox,
}: {
  simulationParams: unknown
  groups: MeshGroupData[]
  boundingBox?: BoundingBoxData | null
}): VolumeRefinementReview {
  const params = unwrapSimulationParams(simulationParams)
  const candidates = [
    valueAtPath(params, 'meshing.refinements'),
    valueAtPath(params, 'meshing.volume_meshing.refinements'),
  ].find(Array.isArray) as unknown[] | undefined
  const rules = (candidates ?? []).flatMap((candidate, index) => parseRefinementRule(candidate, index, groups))
  const regions = rules.flatMap((rule) => rule.regions)
  const diagnostics = buildDiagnostics(rules, regions, boundingBox)
  return {
    rules,
    regions,
    diagnostics,
    configured: rules.length > 0,
    visualizableCount: regions.length,
    unresolvedTargetCount: rules.reduce((sum, rule) => sum + rule.unresolvedTargets.length, 0),
  }
}

export function volumeRefinementOverlays(
  review: VolumeRefinementReview,
  resourceRef: ResourceRef,
  selectedRegionId: string | null,
): OverlayAnnotation[] {
  return review.regions.map((region) => {
    const selected = region.id === selectedRegionId
    const color = selected ? '#ffb02e' : region.kind === 'box' ? '#42c7d9' : region.kind === 'cylinder' ? '#9ed64b' : '#a985e8'
    const shape = region.kind === 'box'
      ? {
          kind: 'box' as const,
          key: 'shape',
          center: region.center,
          size: region.size!,
          rotationAxis: region.rotationAxis,
          rotationAngleRadians: region.rotationAngleRadians,
          color,
          opacity: selected ? 0.9 : 0.55,
        }
      : region.kind === 'cylinder'
        ? {
            kind: 'cylinder' as const,
            key: 'shape',
            center: region.center,
            axis: region.axis!,
            height: region.height!,
            radius: region.radius!,
            color,
            opacity: selected ? 0.9 : 0.55,
          }
        : {
            kind: 'sphere' as const,
            key: 'shape',
            center: region.center,
            radius: region.radius!,
            color,
            opacity: selected ? 0.18 : 0.09,
          }
    return {
      annotationId: `volume-refinement:${region.id}`,
      coordinateFrame: { kind: 'asset-local', resourceRef },
      state: selected ? 'hover' : 'saved',
      primitives: [
        shape,
        { kind: 'label' as const, key: 'label', position: region.center, text: region.name, color },
      ],
    }
  })
}

function parseRefinementRule(candidate: unknown, index: number, groups: MeshGroupData[]): VolumeRefinementRule[] {
  if (!isRecord(candidate)) return []
  const discriminator = refinementDiscriminator(candidate)
  if (/boundary\s*layer|passive\s*spacing/.test(discriminator)) return []
  const kind = refinementKind(discriminator)
  if (!kind && !spacingKeys.some((key) => key in candidate)) return []
  const entities = refinementEntities(candidate)
  const directRegion = parseRegion(candidate, `refinement-${index + 1}-region-1`)
  const targets = entities.length > 0 ? entities : directRegion ? [candidate] : []
  const regions: VolumeRefinementRegion[] = []
  const matchedTargets: Array<{ id: string; name: string }> = []
  const unresolvedTargets: string[] = []
  for (const [targetIndex, target] of targets.entries()) {
    const region = parseRegion(target, `refinement-${index + 1}-region-${targetIndex + 1}`)
    if (region) {
      regions.push(region)
      continue
    }
    const key = entityKey(target)
    if (!key) {
      unresolvedTargets.push(`target ${targetIndex + 1}`)
      continue
    }
    const matched = groups.find((group) => normalize(group.id) === normalize(key) || normalize(group.name) === normalize(key))
    if (matched) matchedTargets.push({ id: matched.id, name: matched.name })
    else unresolvedTargets.push(key)
  }
  return [{
    id: stringValue(candidate.id) ?? stringValue(candidate.private_attribute_id) ?? `refinement-${index + 1}`,
    name: stringValue(candidate.name) ?? `${humanize(kind ?? 'other')} refinement`,
    kind: kind ?? 'other',
    spacings: spacingKeys.flatMap((key) => candidate[key] === undefined ? [] : [{
      key,
      label: humanize(key),
      value: compactParameterValue(candidate[key]),
    }]),
    regions,
    matchedTargets,
    unresolvedTargets,
    targetCount: targets.length,
  }]
}

function parseRegion(value: unknown, fallbackId: string): VolumeRefinementRegion | null {
  if (!isRecord(value)) return null
  const cache = isRecord(value.private_attribute_input_cache) ? value.private_attribute_input_cache : {}
  const centerValue = value.center ?? cache.center
  const center = vectorValue(centerValue)
  if (!center) return null
  const discriminator = [value.private_attribute_entity_type_name, value.type_name, value._type, value.type, value.private_attribute_constructor]
    .map((item) => typeof item === 'string' ? normalize(item) : '').join(' ')
  const name = stringValue(value.name) ?? humanize(discriminator || 'Refinement region')
  const id = stringValue(value.private_attribute_id) ?? stringValue(value.id) ?? fallbackId
  const unit = quantityUnit(centerValue)
  const size = vectorValue(value.size ?? cache.size)
  if (size && (discriminator.includes('box') || !('axis' in value))) {
    const rotationAxis = vectorValue(value.axis_of_rotation ?? value.axisOfRotation ?? cache.axes) ?? [0, 0, 1]
    const angleValue = value.angle_of_rotation ?? value.angleOfRotation
    const rotationAngleRadians = angleRadians(angleValue)
    return {
      id,
      name,
      kind: 'box',
      center,
      size,
      rotationAxis,
      rotationAngleRadians,
      bounds: rotatedBoxBounds(center, size, rotationAxis, rotationAngleRadians),
      unit: unit ?? quantityUnit(value.size ?? cache.size),
    }
  }
  const axis = vectorValue(value.axis)
  const height = numberValue(value.height ?? value.length)
  const radius = numberValue(value.outer_radius ?? value.outerRadius ?? value.radius)
  const normalizedAxis = axis ? unitVector(axis) : null
  if (normalizedAxis && height !== null && radius !== null && height > 0 && radius > 0) {
    return {
      id,
      name,
      kind: 'cylinder',
      center,
      axis: normalizedAxis,
      height,
      radius,
      bounds: cylinderBounds(center, normalizedAxis, height, radius),
      unit: unit ?? quantityUnit(value.height ?? value.length ?? value.outer_radius ?? value.radius),
    }
  }
  if (radius !== null && radius > 0 && (discriminator.includes('sphere') || !axis)) {
    return {
      id,
      name,
      kind: 'sphere',
      center,
      radius,
      bounds: {
        min: [center[0] - radius, center[1] - radius, center[2] - radius],
        max: [center[0] + radius, center[1] + radius, center[2] + radius],
      },
      unit: unit ?? quantityUnit(value.radius),
    }
  }
  return null
}

function buildDiagnostics(
  rules: VolumeRefinementRule[],
  regions: VolumeRefinementRegion[],
  domain?: BoundingBoxData | null,
): VolumeRefinementDiagnostic[] {
  const diagnostics: VolumeRefinementDiagnostic[] = []
  for (const rule of rules) {
    if (rule.targetCount === 0) diagnostics.push({
      id: `${rule.id}-empty`, severity: 'warning', kind: 'empty-target',
      title: `${rule.name} has no target`,
      detail: 'No region or entity reference was found, so this refinement cannot affect the generated mesh.',
      regionIds: [],
    })
    if (rule.unresolvedTargets.length > 0) diagnostics.push({
      id: `${rule.id}-unresolved`, severity: 'warning', kind: 'unresolved-target',
      title: `${rule.name} has unresolved targets`,
      detail: rule.unresolvedTargets.join(', '),
      regionIds: rule.regions.map((region) => region.id),
    })
  }
  if (domain) {
    for (const region of regions) {
      if (boundsDisjoint(region.bounds, domain)) diagnostics.push({
        id: `${region.id}-outside`, severity: 'warning', kind: 'outside-domain',
        title: `${region.name} is outside the rendered domain`,
        detail: 'Its configured bounds do not intersect the current VolumeMesh asset bounds.',
        regionIds: [region.id],
      })
      else if (!boundsContains(domain, region.bounds)) diagnostics.push({
        id: `${region.id}-partial`, severity: 'info', kind: 'partial-domain',
        title: `${region.name} extends beyond the rendered domain`,
        detail: 'Only part of the configured refinement region intersects the current asset bounds.',
        regionIds: [region.id],
      })
    }
  }
  for (let left = 0; left < regions.length; left += 1) {
    for (let right = left + 1; right < regions.length; right += 1) {
      if (boundsDisjoint(regions[left].bounds, regions[right].bounds)) continue
      diagnostics.push({
        id: `${regions[left].id}-${regions[right].id}-overlap`, severity: 'info', kind: 'overlap',
        title: `${regions[left].name} overlaps ${regions[right].name}`,
        detail: 'Their axis-aligned bounds overlap. This can be intentional; verify spacing precedence in the intersection.',
        regionIds: [regions[left].id, regions[right].id],
      })
    }
  }
  return diagnostics
}

function refinementEntities(candidate: Record<string, unknown>): unknown[] {
  const container = candidate.entities ?? candidate.faces ?? candidate.regions ?? candidate.volumes
  if (Array.isArray(container)) return container
  if (!isRecord(container)) return []
  for (const key of ['stored_entities', 'entities', 'items']) {
    if (Array.isArray(container[key])) return container[key] as unknown[]
  }
  return []
}

function refinementDiscriminator(candidate: Record<string, unknown>): string {
  return [candidate.refinement_type, candidate.refinementType, candidate.model_type, candidate._type, candidate.type, candidate.private_attribute_constructor]
    .map((value) => typeof value === 'string' ? normalize(value) : '').join(' ')
}

function refinementKind(value: string): VolumeRefinementKind | null {
  if (value.includes('axisymmetric')) return 'axisymmetric'
  if (value.includes('structured box')) return 'structured-box'
  if (value.includes('uniform') || value.includes('box refinement') || value.includes('cylinder refinement')) return 'uniform'
  if (value.includes('surface')) return 'surface'
  if (value.includes('geometry')) return 'geometry'
  if (value.includes('refinement')) return 'other'
  return null
}

function entityKey(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (!isRecord(value)) return null
  return [value.private_attribute_id, value.id, value.name].find((item): item is string => typeof item === 'string' && item.trim().length > 0) ?? null
}

function vectorValue(value: unknown): Vector3Tuple | null {
  const raw = isRecord(value) && 'value' in value ? value.value : value
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  return [raw[0] as number, raw[1] as number, raw[2] as number]
}

function numberValue(value: unknown): number | null {
  const raw = isRecord(value) && 'value' in value ? value.value : value
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

function quantityUnit(value: unknown): string | undefined {
  return isRecord(value) && typeof value.units === 'string' ? value.units : undefined
}

function angleRadians(value: unknown): number {
  const angle = numberValue(value) ?? 0
  const units = quantityUnit(value)?.toLowerCase()
  return units?.startsWith('rad') ? angle : angle * Math.PI / 180
}

function unitVector(value: Vector3Tuple): Vector3Tuple | null {
  const length = Math.hypot(...value)
  return length > 0 ? [value[0] / length, value[1] / length, value[2] / length] : null
}

function rotatedBoxBounds(center: Vector3Tuple, size: Vector3Tuple, axis: Vector3Tuple, angle: number): BoundingBoxData {
  const normalizedAxis = unitVector(axis) ?? [0, 0, 1]
  const [x, y, z] = normalizedAxis
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const oneMinus = 1 - cosine
  const matrix = [
    cosine + x * x * oneMinus, x * y * oneMinus - z * sine, x * z * oneMinus + y * sine,
    y * x * oneMinus + z * sine, cosine + y * y * oneMinus, y * z * oneMinus - x * sine,
    z * x * oneMinus - y * sine, z * y * oneMinus + x * sine, cosine + z * z * oneMinus,
  ]
  const half = size.map((value) => value / 2) as [number, number, number]
  const extent: Vector3Tuple = [
    Math.abs(matrix[0]) * half[0] + Math.abs(matrix[1]) * half[1] + Math.abs(matrix[2]) * half[2],
    Math.abs(matrix[3]) * half[0] + Math.abs(matrix[4]) * half[1] + Math.abs(matrix[5]) * half[2],
    Math.abs(matrix[6]) * half[0] + Math.abs(matrix[7]) * half[1] + Math.abs(matrix[8]) * half[2],
  ]
  return boundsFromExtent(center, extent)
}

function cylinderBounds(center: Vector3Tuple, axis: Vector3Tuple, height: number, radius: number): BoundingBoxData {
  const halfHeight = height / 2
  const extent = axis.map((component) => Math.abs(component) * halfHeight + radius * Math.sqrt(Math.max(0, 1 - component * component))) as unknown as Vector3Tuple
  return boundsFromExtent(center, extent)
}

function boundsFromExtent(center: Vector3Tuple, extent: Vector3Tuple): BoundingBoxData {
  return {
    min: [center[0] - extent[0], center[1] - extent[1], center[2] - extent[2]],
    max: [center[0] + extent[0], center[1] + extent[1], center[2] + extent[2]],
  }
}

function boundsDisjoint(left: BoundingBoxData, right: BoundingBoxData): boolean {
  return left.max.some((value, index) => value < right.min[index] || left.min[index] > right.max[index])
}

function boundsContains(outer: BoundingBoxData, inner: BoundingBoxData): boolean {
  return inner.min.every((value, index) => value >= outer.min[index] && inner.max[index] <= outer.max[index])
}

function normalize(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replaceAll('-', ' ').trim().toLowerCase()
}

function humanize(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('-', ' ').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
