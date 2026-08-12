import type { ResourceDetail } from '../api/client'
import type { MeshGroupData } from '../components/viewer/LazyViewer3D'
import type { UVFFieldFilter, UVFFieldHistogram, UVFFieldInfo } from './uvf-three'
import {
  compactParameterValue,
  unwrapSimulationParams,
  valueAtPath,
} from './planStages'
import { buildVolumeRefinementReview } from './volumeRefinementReview'
import { meshGroupManifestHints, meshGroupMatchesKey } from './manifestGroups'

export type VolumeViewMode = 'overview' | 'zones' | 'quality' | 'boundary-layer' | 'refinements' | 'slices'

export type VolumeCapabilityStatus = 'available' | 'proxy' | 'unavailable'

export type VolumeCapability = {
  key: 'asset' | 'zones' | 'quality' | 'boundary-layer' | 'refinements' | 'slices' | 'parameters'
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

export type VolumeSliceVariant = 'flat' | 'crinkled'

export type VolumeSliceVariantFamily = {
  key: string
  name: string
  flatGroupIds: string[]
  crinkledGroupIds: string[]
}

export type VolumeSliceVariantReview = {
  families: VolumeSliceVariantFamily[]
  hasFlat: boolean
  hasCrinkled: boolean
  pairedCount: number
}

export type BoundaryLayerDefaults = {
  firstLayerThickness?: string
  growthRate?: string
  layerCount?: string
  layerCountMode: 'fixed' | 'automatic' | 'unknown'
}

export type BoundaryLayerTarget = {
  key: string
  name: string
  matchedGroupId?: string
  match: 'id' | 'name' | 'pattern' | 'unmatched'
}

export type BoundaryLayerRule = {
  id: string
  name: string
  kind: 'boundary-layer' | 'passive-spacing'
  behavior: 'grow' | 'projected' | 'unchanged'
  firstLayerThickness?: string
  growthRate?: string
  targets: BoundaryLayerTarget[]
}

export type BoundaryLayerReview = {
  defaults: BoundaryLayerDefaults
  rules: BoundaryLayerRule[]
  evidenceFields: UVFFieldInfo[]
  configured: boolean
  targetCount: number
  matchedTargetCount: number
  unmatchedTargetCount: number
}

export type VolumeQualitySeverity = 'critical' | 'warning' | 'pass'

export type VolumeQualityThreshold = {
  fieldName: string
  metric: 'skewness' | 'non-orthogonality' | 'orthogonality' | 'aspect-ratio' | 'jacobian' | 'quality'
  riskDirection: 'min' | 'max'
  warning: number
  critical: number
  source: 'baseline' | 'custom'
  rationale: string
}

export type VolumeQualityThresholdOverride = Pick<VolumeQualityThreshold, 'warning' | 'critical'>

export type VolumeQualityFinding = {
  id: string
  fieldName: string
  severity: VolumeQualitySeverity
  riskDirection: 'min' | 'max'
  worstValue: number
  warningThreshold: number
  criticalThreshold: number
  estimatedWarningCount?: number
  estimatedCriticalCount?: number
  sampleCount?: number
  advice: string
  rationale: string
}

export type VolumeQualityAssessment = {
  findings: VolumeQualityFinding[]
  unsupportedFields: string[]
  criticalCount: number
  warningCount: number
  passCount: number
}

const qualityFieldPattern = /(?:^|[_\s-])(aspect(?:[_\s-]*ratio)?|edge(?:[_\s-]*length)?|cell(?:[_\s-]*volume)?|volume|jacobian|orthog(?:onality)?|skew(?:ness)?|quality|non[_\s-]*orthogonal)(?:$|[_\s-])/i
const boundaryLayerFieldPattern = /(?:^|[_\s-])(boundary[_\s-]*layer|first[_\s-]*(?:layer[_\s-]*)?(?:height|thickness)|prism|layer[_\s-]*(?:count|height|thickness|growth)|wall[_\s-]*spacing)(?:$|[_\s-])/i
const sliceVariantSuffixPattern = /^(.*?)\s*\((flat|crinkled)\)\s*$/i

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

export function classifyBoundaryLayerEvidenceFields(fields: UVFFieldInfo[]): UVFFieldInfo[] {
  return fields.filter((field) => field.kind === 'scalar' && boundaryLayerFieldPattern.test(normalizeFieldName(field.name)))
}

export function buildVolumeSliceVariantReview(groups: MeshGroupData[]): VolumeSliceVariantReview {
  const families = new Map<string, VolumeSliceVariantFamily>()
  for (const group of groups) {
    const match = meshGroupManifestHints(group)
      .map((hint) => hint.match(sliceVariantSuffixPattern))
      .find((candidate): candidate is RegExpMatchArray => candidate !== null)
    if (!match) continue
    const name = match[1].trim()
    if (!name) continue
    const key = normalizeKey(name)
    const family = families.get(key) ?? { key, name, flatGroupIds: [], crinkledGroupIds: [] }
    if (match[2].toLowerCase() === 'flat') family.flatGroupIds.push(group.id)
    else family.crinkledGroupIds.push(group.id)
    families.set(key, family)
  }
  const rows = Array.from(families.values()).sort((left, right) => left.name.localeCompare(right.name))
  return {
    families: rows,
    hasFlat: rows.some((family) => family.flatGroupIds.length > 0),
    hasCrinkled: rows.some((family) => family.crinkledGroupIds.length > 0),
    pairedCount: rows.filter((family) => family.flatGroupIds.length > 0 && family.crinkledGroupIds.length > 0).length,
  }
}

export function selectedVolumeSliceVariantReview(
  review: VolumeSliceVariantReview,
  selectedGroupIds: string[],
): VolumeSliceVariantReview {
  const selected = new Set(selectedGroupIds)
  const families = review.families.filter((family) => (
    [...family.flatGroupIds, ...family.crinkledGroupIds].some((id) => selected.has(id))
  ))
  return {
    families,
    hasFlat: families.some((family) => family.flatGroupIds.length > 0),
    hasCrinkled: families.some((family) => family.crinkledGroupIds.length > 0),
    pairedCount: families.filter((family) => family.flatGroupIds.length > 0 && family.crinkledGroupIds.length > 0).length,
  }
}

export function applyVolumeSliceVariantVisibility(
  visibility: Record<string, boolean>,
  review: VolumeSliceVariantReview,
  variant: VolumeSliceVariant,
): Record<string, boolean> {
  const next = { ...visibility }
  for (const family of review.families) {
    const selected = variant === 'flat' ? family.flatGroupIds : family.crinkledGroupIds
    const fallback = variant === 'flat' ? family.crinkledGroupIds : family.flatGroupIds
    const visible = selected.length > 0 ? selected : fallback
    for (const groupId of [...family.flatGroupIds, ...family.crinkledGroupIds]) next[groupId] = visible.includes(groupId)
  }
  return next
}

export function buildBoundaryLayerReview({
  simulationParams,
  groups,
  fields,
}: {
  simulationParams: unknown
  groups: MeshGroupData[]
  fields: UVFFieldInfo[]
}): BoundaryLayerReview {
  const params = unwrapSimulationParams(simulationParams)
  const firstLayer = valueAtPath(params, 'meshing.defaults.boundary_layer_first_layer_thickness')
  const growthRate = valueAtPath(params, 'meshing.defaults.boundary_layer_growth_rate')
  const layerCount = valueAtPath(params, 'meshing.defaults.number_of_boundary_layers')
  const refinements = [
    valueAtPath(params, 'meshing.refinements'),
    valueAtPath(params, 'meshing.volume_meshing.refinements'),
  ].find(Array.isArray) as unknown[] | undefined
  const rules = (refinements ?? []).flatMap((candidate, index) => {
    if (!isRecord(candidate)) return []
    const kind = boundaryRuleKind(candidate)
    if (!kind) return []
    const behavior = kind === 'boundary-layer'
      ? 'grow' as const
      : stringValue(candidate.type) === 'projected' ? 'projected' as const : 'unchanged' as const
    const targets = extractBoundaryTargets(candidate, groups)
    return [{
      id: stringValue(candidate.id) ?? `boundary-rule-${index + 1}`,
      name: stringValue(candidate.name) ?? (kind === 'boundary-layer' ? 'Boundary layer refinement' : 'Passive spacing'),
      kind,
      behavior,
      firstLayerThickness: valueText(candidate.first_layer_thickness),
      growthRate: valueText(candidate.growth_rate),
      targets,
    }]
  })
  const targets = rules.flatMap((rule) => rule.targets)
  return {
    defaults: {
      firstLayerThickness: valueText(firstLayer),
      growthRate: valueText(growthRate),
      layerCount: valueText(layerCount),
      layerCountMode: layerCount !== undefined && layerCount !== null ? 'fixed' : firstLayer !== undefined ? 'automatic' : 'unknown',
    },
    rules,
    evidenceFields: classifyBoundaryLayerEvidenceFields(fields),
    configured: firstLayer !== undefined || growthRate !== undefined || layerCount !== undefined || rules.length > 0,
    targetCount: targets.length,
    matchedTargetCount: targets.filter((target) => target.match !== 'unmatched').length,
    unmatchedTargetCount: targets.filter((target) => target.match === 'unmatched').length,
  }
}

export function volumeQualityRiskDirection(fieldName: string): 'min' | 'max' {
  const normalized = normalizeFieldName(fieldName)
  if (/minimum|min edge|cell volume|jacobian|orthogonality|quality/.test(normalized)) return 'min'
  return 'max'
}

export function buildVolumeQualityThresholds(
  fields: UVFFieldInfo[],
  overrides: Record<string, VolumeQualityThresholdOverride> = {},
): VolumeQualityThreshold[] {
  const thresholds: VolumeQualityThreshold[] = []
  for (const field of fields) {
    const baseline = volumeQualityBaseline(field.name)
    if (!baseline) continue
    const override = overrides[field.name]
    if (!override || !validThresholdOrder(baseline.riskDirection, override.warning, override.critical)) {
      thresholds.push({ fieldName: field.name, ...baseline, source: 'baseline' })
      continue
    }
    thresholds.push({
      fieldName: field.name,
      ...baseline,
      warning: override.warning,
      critical: override.critical,
      source: 'custom',
    })
  }
  return thresholds
}

export function assessVolumeMeshQuality({
  fields,
  thresholds,
  histogram,
}: {
  fields: UVFFieldInfo[]
  thresholds: VolumeQualityThreshold[]
  histogram?: UVFFieldHistogram | null
}): VolumeQualityAssessment {
  const fieldByName = new Map(fields.map((field) => [field.name, field]))
  const thresholdByName = new Map(thresholds.map((threshold) => [threshold.fieldName, threshold]))
  const findings = thresholds.flatMap((threshold) => {
    const field = fieldByName.get(threshold.fieldName)
    if (!field) return []
    const worstValue = threshold.riskDirection === 'min' ? field.min : field.max
    const severity = riskCrosses(threshold.riskDirection, worstValue, threshold.critical)
      ? 'critical' as const
      : riskCrosses(threshold.riskDirection, worstValue, threshold.warning) ? 'warning' as const : 'pass' as const
    const activeHistogram = histogram?.field.name === field.name ? histogram : null
    return [{
      id: `volume-quality-${normalizeKey(field.name)}`,
      fieldName: field.name,
      severity,
      riskDirection: threshold.riskDirection,
      worstValue,
      warningThreshold: threshold.warning,
      criticalThreshold: threshold.critical,
      estimatedWarningCount: activeHistogram ? estimateHistogramRiskCount(activeHistogram, threshold.riskDirection, threshold.warning) : undefined,
      estimatedCriticalCount: activeHistogram ? estimateHistogramRiskCount(activeHistogram, threshold.riskDirection, threshold.critical) : undefined,
      sampleCount: activeHistogram?.sampleCount,
      advice: volumeQualityAdvice(threshold.metric),
      rationale: threshold.rationale,
    }]
  }).sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
  return {
    findings,
    unsupportedFields: fields.filter((field) => !thresholdByName.has(field.name)).map((field) => field.name),
    criticalCount: findings.filter((finding) => finding.severity === 'critical').length,
    warningCount: findings.filter((finding) => finding.severity === 'warning').length,
    passCount: findings.filter((finding) => finding.severity === 'pass').length,
  }
}

export function volumeQualityRiskFilter(
  field: UVFFieldInfo,
  threshold: VolumeQualityThreshold,
): UVFFieldFilter {
  return {
    enabled: true,
    operator: 'and',
    rules: [{
      id: `volume-threshold-${normalizeKey(field.name)}`,
      fieldName: field.name,
      min: threshold.riskDirection === 'min' ? field.min : threshold.warning,
      max: threshold.riskDirection === 'min' ? threshold.warning : field.max,
    }],
  }
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
    const provided = meshGroupManifestHints(group)
      .map((hint) => zoneTypes.get(normalizeKey(hint)))
      .find((candidate): candidate is VolumeZoneType => candidate !== undefined)
    if (provided) return { ...group, zoneType: provided, typeProvenance: 'provided' }
    const inferred = meshGroupManifestHints(group)
      .map(inferZoneType)
      .find((candidate) => candidate !== 'unknown') ?? 'unknown'
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
  const boundaryLayer = buildBoundaryLayerReview({
    simulationParams: detail?.simulation_params,
    groups,
    fields,
  })
  const refinements = buildVolumeRefinementReview({
    simulationParams: detail?.simulation_params,
    groups,
  })
  const sliceVariants = buildVolumeSliceVariantReview(groups)
  const aggregateQuality = findMetric(
    [detail?.summary, detail?.state],
    ['minimum_orthogonality', 'min_orthogonality', 'max_skewness', 'maximum_skewness', 'min_cell_size', 'minimum_cell_size'],
  )
  const hasExplicitSlices = sliceVariants.families.length > 0
    || fields.some((field) => /(?:^|[_\s-])slice(?:$|[_\s-])/i.test(field.name))
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
      key: 'boundary-layer',
      label: 'Boundary-layer review',
      status: boundaryLayer.configured && boundaryLayer.evidenceFields.length > 0
        ? 'available'
        : boundaryLayer.configured || boundaryLayer.evidenceFields.length > 0 ? 'proxy' : 'unavailable',
      detail: boundaryLayer.configured
        ? boundaryLayer.evidenceFields.length > 0
          ? `${boundaryLayer.rules.length} local rule(s) and ${boundaryLayer.evidenceFields.length} generated evidence field(s) are available.`
          : 'Meshing intent is available, but generated prism-layer evidence is not present in the asset.'
        : boundaryLayer.evidenceFields.length > 0
          ? 'Generated layer fields exist, but the source meshing intent is unavailable.'
          : 'No boundary-layer defaults, local rules, or generated evidence fields were found.',
    },
    {
      key: 'refinements',
      label: 'Refinement zones',
      status: refinements.visualizableCount > 0 ? 'available' : refinements.configured ? 'proxy' : 'unavailable',
      detail: refinements.visualizableCount > 0
        ? `${refinements.rules.length} refinement rule(s) and ${refinements.visualizableCount} spatial region(s) are traceable.`
        : refinements.configured
          ? 'Refinement intent exists, but no Box, Cylinder, or Sphere geometry can be reconstructed.'
          : 'No non-boundary-layer volume refinement configuration was found.',
    },
    {
      key: 'slices',
      label: 'Volume slices',
      status: hasExplicitSlices ? 'available' : previewSource === 'primary' ? 'proxy' : 'unavailable',
      detail: hasExplicitSlices
        ? sliceVariants.families.length > 0
          ? `${sliceVariants.families.length} generated slice(s) expose Flat/Crinkled face variants.`
          : 'The asset reports slice data.'
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
  const boundaryLayer = capabilities.find((capability) => capability.key === 'boundary-layer')!
  const boundaryLayerReview = buildBoundaryLayerReview({
    simulationParams: detail?.simulation_params,
    groups,
    fields,
  })
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
      label: 'Boundary-layer intent is traceable',
      status: boundaryLayerReview.configured ? 'ready' : boundaryLayer.status === 'proxy' ? 'warning' : 'missing',
      hint: boundaryLayer.detail,
    },
    {
      label: 'No partial Flow360 reads were reported',
      status: noErrors ? 'ready' : 'warning',
      hint: noErrors ? 'All resource reads succeeded.' : `${Object.keys(detail?.errors ?? {}).length} partial read(s) require review.`,
    },
  ]
}

function boundaryRuleKind(candidate: Record<string, unknown>): BoundaryLayerRule['kind'] | null {
  const discriminator = [
    candidate.refinement_type,
    candidate.model_type,
    candidate.private_attribute_constructor,
    candidate.kind,
    candidate._type,
    candidate.type,
    candidate.name,
  ].map((value) => typeof value === 'string' ? normalizeKey(value) : '').join(' ')
  if (discriminator.includes('boundarylayer') || discriminator.includes('boundary layer')) return 'boundary-layer'
  if (discriminator.includes('passivespacing') || discriminator.includes('passive spacing')) return 'passive-spacing'
  if ((candidate.type === 'projected' || candidate.type === 'unchanged') && hasEntityContainer(candidate)) return 'passive-spacing'
  if ('first_layer_thickness' in candidate && hasEntityContainer(candidate)) return 'boundary-layer'
  return null
}

function hasEntityContainer(candidate: Record<string, unknown>): boolean {
  return 'entities' in candidate || 'faces' in candidate || 'surfaces' in candidate
}

function extractBoundaryTargets(candidate: Record<string, unknown>, groups: MeshGroupData[]): BoundaryLayerTarget[] {
  const container = candidate.entities ?? candidate.faces ?? candidate.surfaces
  const entities = entityArray(container)
  const keys = entities.flatMap((entity) => {
    if (typeof entity === 'string') return [entity]
    if (!isRecord(entity)) return []
    const primary = [entity.private_attribute_id, entity.id, entity.name]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    return [
      primary,
      ...(Array.isArray(entity.private_attribute_sub_components) ? entity.private_attribute_sub_components : []),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  })
  return Array.from(new Set(keys)).flatMap((key) => matchBoundaryTargets(key, groups))
}

function entityArray(container: unknown): unknown[] {
  if (Array.isArray(container)) return container
  if (!isRecord(container)) return []
  for (const key of ['stored_entities', 'entities', 'items']) {
    if (Array.isArray(container[key])) return container[key] as unknown[]
  }
  return []
}

function matchBoundaryTargets(key: string, groups: MeshGroupData[]): BoundaryLayerTarget[] {
  const normalized = normalizeKey(key)
  const idMatch = groups.find((group) => normalizeKey(group.id) === normalized)
  if (idMatch) return [{ key, name: idMatch.name, matchedGroupId: idMatch.id, match: 'id' }]
  const nameMatch = key.includes('*') ? undefined : groups.find((group) => meshGroupMatchesKey(group, key))
  if (nameMatch) return [{ key, name: nameMatch.name, matchedGroupId: nameMatch.id, match: 'name' }]
  if (key.includes('*')) {
    const expression = new RegExp(`^${escapeRegExp(key).replaceAll('\\*', '.*')}$`, 'i')
    const patternMatches = groups.filter((group) => meshGroupManifestHints(group).some((hint) => expression.test(hint)))
    if (patternMatches.length > 0) return patternMatches.map((group) => ({ key, name: group.name, matchedGroupId: group.id, match: 'pattern' as const }))
  }
  return [{ key, name: key, match: 'unmatched' }]
}

function valueText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return compactParameterValue(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

function volumeQualityBaseline(fieldName: string): Omit<VolumeQualityThreshold, 'fieldName' | 'source'> | null {
  const normalized = normalizeFieldName(fieldName)
  if (/non\s*orthog/.test(normalized)) {
    return {
      metric: 'non-orthogonality',
      riskDirection: 'max',
      warning: 65,
      critical: 75,
      rationale: 'Angle-based screening baseline; confirm against the solver and mesh-generation requirements.',
    }
  }
  if (/orthog/.test(normalized)) {
    return {
      metric: 'orthogonality',
      riskDirection: 'min',
      warning: 0.15,
      critical: 0.05,
      rationale: 'Normalized orthogonality screening baseline where values closer to zero are riskier.',
    }
  }
  if (/skew/.test(normalized)) {
    return {
      metric: 'skewness',
      riskDirection: 'max',
      warning: 0.85,
      critical: 0.95,
      rationale: 'Normalized skewness screening baseline where values closer to one are riskier.',
    }
  }
  if (/aspect/.test(normalized)) {
    return {
      metric: 'aspect-ratio',
      riskDirection: 'max',
      warning: 50,
      critical: 100,
      rationale: 'General-purpose aspect-ratio screen; aligned boundary-layer cells may require a project-specific limit.',
    }
  }
  if (/jacobian/.test(normalized)) {
    return {
      metric: 'jacobian',
      riskDirection: 'min',
      warning: 0.2,
      critical: 0.05,
      rationale: 'Normalized Jacobian screening baseline; non-positive values require immediate review.',
    }
  }
  if (/quality/.test(normalized)) {
    return {
      metric: 'quality',
      riskDirection: 'min',
      warning: 0.2,
      critical: 0.05,
      rationale: 'Generic normalized quality baseline; verify the field definition before accepting the mesh.',
    }
  }
  return null
}

function validThresholdOrder(direction: 'min' | 'max', warning: number, critical: number): boolean {
  if (!Number.isFinite(warning) || !Number.isFinite(critical)) return false
  return direction === 'min' ? critical <= warning : critical >= warning
}

function riskCrosses(direction: 'min' | 'max', value: number, threshold: number): boolean {
  return direction === 'min' ? value <= threshold : value >= threshold
}

function estimateHistogramRiskCount(
  histogram: UVFFieldHistogram,
  direction: 'min' | 'max',
  threshold: number,
): number {
  const count = histogram.bins.reduce((sum, bin) => {
    if (bin.max <= bin.min) return sum + (riskCrosses(direction, bin.min, threshold) ? bin.count : 0)
    if (direction === 'max') {
      if (bin.min >= threshold) return sum + bin.count
      if (bin.max <= threshold) return sum
      return sum + bin.count * (bin.max - threshold) / (bin.max - bin.min)
    }
    if (bin.max <= threshold) return sum + bin.count
    if (bin.min >= threshold) return sum
    return sum + bin.count * (threshold - bin.min) / (bin.max - bin.min)
  }, 0)
  return Math.max(0, Math.min(histogram.sampleCount, Math.round(count)))
}

function volumeQualityAdvice(metric: VolumeQualityThreshold['metric']): string {
  if (metric === 'skewness' || metric === 'non-orthogonality') {
    return 'Inspect abrupt size transitions, concave intersections, and narrow gaps; reduce growth or add targeted refinement where the field peaks.'
  }
  if (metric === 'aspect-ratio') {
    return 'Confirm whether the worst cells are wall-aligned layers; if not, reduce stretching and smooth the transition into the core mesh.'
  }
  if (metric === 'orthogonality' || metric === 'jacobian') {
    return 'Inspect topology and nearby refinement transitions; locally improve alignment and remove collapsed or highly distorted cells.'
  }
  return 'Verify the field definition, locate the worst region, and correlate it with skewness, orthogonality, and local sizing before acceptance.'
}

function severityRank(severity: VolumeQualitySeverity): number {
  return severity === 'critical' ? 2 : severity === 'warning' ? 1 : 0
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
