import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Play,
  Pause,
  RotateCw,
  Gauge,
  Wind,
  FileOutput,
  BarChart3,
  ScanLine,
  Layers,
  Eye,
  EyeOff,
  Info,
  Film,
} from 'lucide-react'
import { useState, useCallback, useEffect, useMemo } from 'react'
import { resourceStatus } from './ResourceDetailPanel'
import { api, type ResourceDetail } from '../api/client'
import { useConvergenceAssessment } from '../hooks/useConvergenceAssessment'
import type { ConvergenceAssessment, ConvergenceMetric, ConvergenceResult } from '../hooks/useConvergenceAssessment'
import { LazyViewer3D, type MeshGroupData, type ViewerAssetStats, type ViewerSelection } from './viewer/LazyViewer3D'
import { ViewerAssetInformation } from './viewer/ViewerAssetInformation'
import { useResourcePreview } from '../hooks/useResourcePreview'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import { ResourceReviewLayout } from './ResourceReviewLayout'
import ResourceCreateDraftAction from './ResourceCreateDraftAction'
import {
  ResourceReviewDialog,
  ResourceReviewLauncher,
  ResourceReviewLaunchers,
} from './ResourceReviewDialog'
import { useI18n } from '../i18n'
import { ResultTablePreview, isTabularResult } from './ResultTablePreview'
import CaseSlicePlayerPanel, { caseTimeSeriesPlayerTitle, type CaseTimeSeriesArchiveKind } from './CaseSlicePlayerPanel'
import {
  createViewerContext,
  findLengthUnit,
} from '../lib/viewer-tools/context/ViewerContext'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'
import type { UVFEntityInfo } from '../lib/uvf-three'
import { ManifestMemberGroup } from './ManifestMemberGroup'

function formatConvergenceStatus(status: string): string {
  switch (status) {
    case 'converged': return 'Converged — Results are stable'
    case 'not-converged': return 'Not Converged — Results show drift or instability'
    case 'insufficient-data': return 'Insufficient Data — Unable to assess convergence'
    default: return status
  }
}

export function convergenceTrendLabel(metric: Pick<ConvergenceMetric, 'stable' | 'trend'>): string {
  if (metric.stable) return 'stable'
  switch (metric.trend.toLowerCase()) {
    case 'stable':
    case 'increasing':
    case 'decreasing':
      return metric.trend.toLowerCase()
    default:
      return metric.trend
  }
}

export function localizeConvergenceReason(reason: string, translate: (value: string) => string): string {
  return reason.split('; ').map((part) => translate(part)).join('; ')
}

function formatAssessmentKey(key: string): string {
  switch (key) {
    case 'residuals': return 'Residual Convergence'
    case 'forces': return 'Force Coefficients'
    case 'overall': return 'Overall Assessment'
    default: return key.charAt(0).toUpperCase() + key.slice(1)
  }
}

function formatNumber(v: number): string {
  if (Math.abs(v) >= 1) return v.toFixed(4)
  if (Math.abs(v) >= 0.01) return v.toFixed(6)
  return v.toExponential(3)
}

export type CaseStatusView =
  | 'queued'
  | 'preprocessing'
  | 'running'
  | 'completed'
  | 'failed'
  | 'unknown'

type CaseResultRecord = NonNullable<NonNullable<ResourceDetail['results']>['records']>[number]

export function isSliceArchiveResult(record: CaseResultRecord) {
  return timeSeriesArchiveKind(record) === 'slices'
}

export function timeSeriesArchiveKind(record: CaseResultRecord): CaseTimeSeriesArchiveKind | null {
  const resultPath = String(record.path ?? '').replaceAll('\\', '/').toLowerCase()
  const resultName = String(record.name ?? '').toLowerCase()
  if (resultPath === 'results/slices.tar.gz' || (!resultPath && resultName === 'slices.tar.gz')) return 'slices'
  if (resultPath === 'results/surfaces.tar.gz' || (!resultPath && resultName === 'surfaces.tar.gz')) return 'surfaces'
  return null
}

export function isVolumeSnapshotArchive(record: CaseResultRecord) {
  const resultPath = String(record.path ?? '').replaceAll('\\', '/').toLowerCase()
  const resultName = String(record.name ?? '').toLowerCase()
  return resultPath === 'results/volumes.tar.gz' || (!resultPath && resultName === 'volumes.tar.gz')
}

export function findSliceArchive(records: NonNullable<ResourceDetail['results']>['records']) {
  return records?.find(isSliceArchiveResult) ?? null
}

export function findTimeSeriesArchives(records: NonNullable<ResourceDetail['results']>['records']) {
  return records?.flatMap((record) => {
    const kind = timeSeriesArchiveKind(record)
    return kind ? [{ kind, record }] : []
  }) ?? []
}

export function mapCaseStatus(detail: ResourceDetail | null): CaseStatusView {
  const raw = resourceStatus(detail).toLowerCase()
  if (['queued', 'pending', 'waiting'].includes(raw)) return 'queued'
  if (['preprocessing', 'pre-process'].includes(raw)) return 'preprocessing'
  if (['running', 'executing'].includes(raw)) return 'running'
  if (['completed', 'processed', 'success', 'done'].includes(raw)) return 'completed'
  if (['failed', 'error', 'crashed'].includes(raw)) return 'failed'
  return 'unknown'
}

export function statusLabel(view: CaseStatusView): string {
  switch (view) {
    case 'queued': return 'Queued'
    case 'preprocessing': return 'Preprocessing'
    case 'running': return 'Running'
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
    default: return 'Unknown'
  }
}

export function isTerminal(view: CaseStatusView): boolean {
  return view === 'completed' || view === 'failed'
}

type CaseSurfaceGroup = { id: string; visible: boolean; entityIds?: string[] }

export type CaseVisualizationCategory = 'surfaces' | 'slices' | 'isosurfaces' | 'streamlines'

export type CaseVisualizationGroup = {
  category: CaseVisualizationCategory
  members: CaseVisualizationMember[]
}

export type CaseVisualizationMember = MeshGroupData & {
  entityIds: string[]
  playbackKind?: CaseTimeSeriesArchiveKind
  source: 'manifest' | 'output' | 'archive'
}

const caseVisualizationCategoryOrder: CaseVisualizationCategory[] = [
  'surfaces',
  'slices',
  'isosurfaces',
  'streamlines',
]

export function groupCaseVisualizationMembers(groups: MeshGroupData[]): CaseVisualizationGroup[] {
  const categorized = new Map<CaseVisualizationCategory, CaseVisualizationMember[]>(
    caseVisualizationCategoryOrder.map((category) => [category, []]),
  )
  for (const group of groups) {
    const hints = [...(group.path ?? []), group.id, group.name]
      .map((value) => value.trim().toLowerCase().replaceAll(/[^a-z]/g, ''))
    const category = hints.some((hint) => hint.includes('streamline'))
      ? 'streamlines'
      : hints.some((hint) => hint.includes('isosurface'))
        ? 'isosurfaces'
        : hints.some((hint) => hint.includes('slice'))
          ? 'slices'
          : 'surfaces'
    const containerName = group.path?.at(-1) || group.name
    const members = categorized.get(category)!
    const existing = members.find((member) => member.name === containerName)
    if (existing) {
      existing.entityIds.push(group.id)
      existing.visible ||= group.visible
      existing.triangles = (existing.triangles ?? 0) + (group.triangles ?? 0)
      existing.vertices = (existing.vertices ?? 0) + (group.vertices ?? 0)
      continue
    }
    members.push({
      ...group,
      name: containerName,
      entityIds: [group.id],
      source: 'manifest',
    })
  }
  return caseVisualizationCategoryOrder
    .map((category) => ({ category, members: categorized.get(category)! }))
    .filter((group) => group.members.length > 0)
}

function visualizationOutputCategory(outputType: string): CaseVisualizationCategory | null {
  switch (outputType.toLowerCase()) {
    case 'surfaceoutput': return 'surfaces'
    case 'sliceoutput': return 'slices'
    case 'isosurfaceoutput': return 'isosurfaces'
    case 'streamlineoutput': return 'streamlines'
    default: return null
  }
}

function outputPlaybackKind(category: CaseVisualizationCategory, archives: CaseTimeSeriesArchiveKind[]) {
  const kind = category === 'surfaces' ? 'surfaces' : category === 'slices' ? 'slices' : null
  return kind && archives.includes(kind) ? kind : undefined
}

export function caseConfiguredVisualizationMembers(
  simulationParams: unknown,
  archives: CaseTimeSeriesArchiveKind[],
): CaseVisualizationMember[] {
  if (!simulationParams || typeof simulationParams !== 'object' || Array.isArray(simulationParams)) return []
  const outputs = (simulationParams as Record<string, unknown>).outputs
  if (!Array.isArray(outputs)) return []
  return outputs.flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const output = value as Record<string, unknown>
    const category = visualizationOutputCategory(String(output.output_type ?? ''))
    if (!category) return []
    const rawName = String(output.name ?? '').trim() || `${category} ${index + 1}`
    const name = rawName.charAt(0).toUpperCase() + rawName.slice(1)
    return [{
      id: `case-output:${String(output.private_attribute_id ?? `${category}-${index}`)}`,
      name,
      color: '#8da0a6',
      visible: false,
      entityIds: [],
      playbackKind: outputPlaybackKind(category, archives),
      source: 'output' as const,
      path: [category],
    }]
  })
}

export function caseVisualizationSections(
  groups: MeshGroupData[],
  hasSliceArchive: boolean,
  configuredMembers: CaseVisualizationMember[] = [],
): CaseVisualizationGroup[] {
  const sections = groupCaseVisualizationMembers(groups)
  const byCategory = new Map(sections.map((section) => [section.category, section]))
  for (const member of configuredMembers) {
    const category = member.path?.[0] as CaseVisualizationCategory
    let section = byCategory.get(category)
    if (!section) {
      section = { category, members: [] }
      byCategory.set(category, section)
    }
    const normalizedName = member.name.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
    const existing = section.members.find((candidate) => (
      candidate.name.toLowerCase().replaceAll(/[^a-z0-9]/g, '') === normalizedName
    ))
    if (existing) existing.playbackKind ??= member.playbackKind
    else {
      const firstAutomatic = section.members.findIndex((candidate) => candidate.source !== 'output')
      if (firstAutomatic < 0) section.members.push(member)
      else section.members.splice(firstAutomatic, 0, member)
    }
  }
  if (hasSliceArchive && !byCategory.has('slices')) {
    byCategory.set('slices', { category: 'slices', members: [{
      id: 'case-archive:slices',
      name: 'Time-series Slice archive',
      color: '#8da0a6',
      visible: false,
      entityIds: [],
      playbackKind: 'slices',
      source: 'archive',
      path: ['slices'],
    }] })
  }
  return [...byCategory.values()].sort((left, right) => (
      caseVisualizationCategoryOrder.indexOf(left.category)
      - caseVisualizationCategoryOrder.indexOf(right.category)
  ))
}

function caseVisualizationCategoryLabel(category: CaseVisualizationCategory): string {
  switch (category) {
    case 'surfaces': return 'Surfaces'
    case 'slices': return 'Slices'
    case 'isosurfaces': return 'Isosurfaces'
    case 'streamlines': return 'Streamlines'
  }
}

export function caseObjectFieldNames(entities: UVFEntityInfo[], entityId: string | null): string[] {
  return entities.find((entity) => entity.id === entityId)?.fields ?? []
}

export function caseFieldForSelection(activeField: string | null, fieldNames: string[]): string | null {
  return activeField && fieldNames.includes(activeField) ? activeField : null
}

export function visibleCaseSurfaceCount(groups: CaseSurfaceGroup[], visibility: Record<string, boolean>): number {
  return groups.filter((group) => {
    const entityIds = group.entityIds ?? [group.id]
    return entityIds.length > 0 && entityIds.some((id) => visibility[id] ?? group.visible)
  }).length
}

export function caseSurfaceVisibilityMap(groups: CaseSurfaceGroup[], visible: boolean): Record<string, boolean> {
  return Object.fromEntries(groups.flatMap((group) => (group.entityIds ?? [group.id]).map((id) => [id, visible])))
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

function metricText(value: unknown) {
  if (value === undefined || value === null || value === '') return 'Not reported'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value && 'value' in (value as object)) {
    const metric = value as { value?: unknown; units?: unknown }
    return `${metric.value ?? '—'}${metric.units ? ` ${metric.units}` : ''}`
  }
  return JSON.stringify(value)
}

type NormalizedCase = {
  status: CaseStatusView
  runTime: string
  operatingPoint: Record<string, unknown>
  turbulenceModel: string
  resultCount: number
}

export function normalizeCase(detail: ResourceDetail | null): NormalizedCase {
  const view = mapCaseStatus(detail)
  const summary = detail?.summary ?? {}
  const params = detail?.simulation_params ?? {}

  const elapsed = findMetric(summary, ['elapsed_time', 'run_time', 'duration', 'wall_time'])

  const operatingCondition =
    findMetric(params, ['operating_condition']) ??
    findMetric(summary, ['operating_condition']) ??
    {}
  const turbulence =
    findMetric(summary, ['turbulence_model', 'turbulence']) ??
    findMetric(params, ['turbulence_model']) ??
    'Not reported'
  return {
    status: view,
    runTime: metricText(elapsed),
    operatingPoint: (operatingCondition && typeof operatingCondition === 'object'
      ? (operatingCondition as Record<string, unknown>)
      : {}),
    turbulenceModel: typeof turbulence === 'string' ? turbulence : metricText(turbulence),
    resultCount: detail?.results?.records?.length ?? 0,
  }
}

function StatusBadge({ status }: { status: CaseStatusView }) {
  const map: Record<CaseStatusView, { icon: React.ComponentType<{ size?: number }>; className: string }> = {
    queued: { icon: Pause, className: 'status-queued' },
    preprocessing: { icon: RotateCw, className: 'status-preprocessing' },
    running: { icon: Play, className: 'status-running' },
    completed: { icon: CheckCircle2, className: 'status-completed' },
    failed: { icon: AlertCircle, className: 'status-failed' },
    unknown: { icon: CircleDashed, className: 'status-unknown' },
  }
  const cfg = map[status]
  const Icon = cfg.icon
  return (
    <span className={`hero-status ${cfg.className}`}>
      <Icon size={13} /> {statusLabel(status)}
    </span>
  )
}

export default function CaseWorkspace({
  detail,
  resourceId,
  projectId,
  resourceRef,
  annotationsModel,
  geometryResourceId,
  onPlanCase,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  projectId: string
  resourceRef: ResourceRef
  annotationsModel: ProjectAnnotationsModel<JsonValue>
  geometryResourceId?: string | null
  onPlanCase: () => Promise<void>
}) {
  const { t } = useI18n()
  const [activeReviewDialog, setActiveReviewDialog] = useState<'convergence' | 'slices' | null>(null)
  const [activePlayerArchive, setActivePlayerArchive] = useState<{ kind: CaseTimeSeriesArchiveKind; record: CaseResultRecord } | null>(null)
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const [selectedVisualizationId, setSelectedVisualizationId] = useState<string | null>(null)
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({})
  const [viewerEntities, setViewerEntities] = useState<UVFEntityInfo[]>([])
  const [activeField, setActiveField] = useState<string | null>(null)
  const [viewerAssetStats, setViewerAssetStats] = useState<ViewerAssetStats | null>(null)
  const [resultPreview, setResultPreview] = useState<{
    path: string
    content?: string
    error?: string
    loading: boolean
  } | null>(null)
  const viewModel = normalizeCase(detail)
  const terminal = isTerminal(viewModel.status)
  const resultRecords = detail?.results?.records ?? []
  const sliceArchive = findSliceArchive(resultRecords)
  const timeSeriesArchives = findTimeSeriesArchives(resultRecords)
  const hasSurfaceArchive = timeSeriesArchives.some(({ kind }) => kind === 'surfaces')
  const hasErrors = Boolean(detail?.errors && Object.keys(detail.errors).length)

  const { result: convergence, loading: convergenceLoading, refetch: refetchConvergence } =
    useConvergenceAssessment(detail?.id ?? null)

  const convResult = convergence as ConvergenceResult | null
  const { manifest, state: viewerState, source: previewSource, primaryError } = useResourcePreview(
    detail ? 'Case' : null,
    resourceId ?? detail?.id ?? null,
    detail && geometryResourceId ? 'Geometry' : null,
    geometryResourceId ?? null,
  )
  const surfaceGroups = manifest?.groups ?? []
  const configuredVisualizationMembers = useMemo(
    () => caseConfiguredVisualizationMembers(
      detail?.simulation_params ?? { outputs: findMetric(detail?.summary, ['outputs']) },
      [
        ...(sliceArchive ? ['slices' as const] : []),
        ...(hasSurfaceArchive ? ['surfaces' as const] : []),
      ],
    ),
    [detail?.simulation_params, detail?.summary, hasSurfaceArchive, sliceArchive],
  )
  const visualizationGroups = useMemo(
    () => caseVisualizationSections(surfaceGroups, Boolean(sliceArchive), configuredVisualizationMembers),
    [configuredVisualizationMembers, sliceArchive, surfaceGroups],
  )
  const selectedVisualizationObject = visualizationGroups
    .flatMap(({ members }) => members)
    .find((member) => member.id === selectedVisualizationId) ?? null
  const selectedFieldNames = useMemo(
    () => [...new Set((selectedVisualizationObject?.entityIds ?? [])
      .flatMap((entityId) => caseObjectFieldNames(viewerEntities, entityId)))],
    [selectedVisualizationObject, viewerEntities],
  )
  const selectedFieldEntityIds = useMemo(
    () => selectedVisualizationObject?.entityIds ?? [],
    [selectedVisualizationObject],
  )

  useEffect(() => {
    setEntityVisibility(Object.fromEntries(surfaceGroups.map((group) => [group.id, group.visible])))
    setViewerSelection({ groupId: null })
    setSelectedVisualizationId(null)
  }, [manifest?.asset_url])

  useEffect(() => {
    const compatibleField = caseFieldForSelection(activeField, selectedFieldNames)
    if (compatibleField !== activeField) setActiveField(compatibleField)
  }, [activeField, selectedFieldNames])

  const toggleSurfaceVisibility = (member: CaseVisualizationMember) => {
    if (!member.entityIds.length) return
    setEntityVisibility((current) => {
      const visible = member.entityIds.some((entityId) => current[entityId] ?? member.visible)
      return { ...current, ...Object.fromEntries(member.entityIds.map((entityId) => [entityId, !visible])) }
    })
  }

  const openTimeSeriesPlayer = (record: CaseResultRecord) => {
    const kind = timeSeriesArchiveKind(record)
    if (!kind) return
    setActivePlayerArchive({ kind, record })
    setActiveReviewDialog('slices')
  }
  const handleViewerSelection = (selection: ViewerSelection) => {
    setViewerSelection(selection)
    const selectedMember = visualizationGroups
      .flatMap(({ members }) => members)
      .find((member) => selection.groupId && member.entityIds.includes(selection.groupId))
    setSelectedVisualizationId(selectedMember?.id ?? null)
  }
  const unit = findLengthUnit([
    detail?.simulation_params,
    detail?.summary,
    detail?.state,
  ])
  const viewerContext = useMemo(() => createViewerContext({
    projectId,
    resourceRef,
    assetSource: previewSource,
    fallbackAssetRef: geometryResourceId
      ? { id: geometryResourceId, type: 'Geometry' }
      : null,
    unit,
    capabilities: ['distance', 'surface-picking', 'field-probe'],
  }), [geometryResourceId, previewSource, projectId, resourceRef, unit])
  const tools = useWorkspaceViewerTools({
    projectId,
    resourceRef: viewerContext.resourceRef,
    assetRef: viewerContext.assetRef,
    coordinateFrame: viewerContext.coordinateFrame,
    annotationsModel,
    unit: viewerContext.unit,
  })
  const velocity = findMetric(viewModel.operatingPoint, ['velocity_magnitude', 'velocity', 'mach'])

  const openResultPreview = useCallback(async (path: string) => {
    setResultPreview({ path, loading: true })
    try {
      const content = await api.previewResult('Case', resourceId ?? detail?.id ?? '', path)
      setResultPreview({ path, content, loading: false })
    } catch (error) {
      setResultPreview({ path, error: String(error).replace('Error: ', ''), loading: false })
    }
  }, [detail?.id, resourceId])

  const reviewLevel = viewModel.status === 'failed'
    ? 'blocked'
    : viewModel.status === 'completed' && convResult?.status === 'converged'
      ? 'ready'
      : 'warning'
  const reviewLabel = viewModel.status === 'completed'
    ? convResult?.status === 'converged' ? 'Results ready for engineering use' : 'Review result confidence'
    : viewModel.status === 'failed'
      ? 'Resolve solver failure'
      : viewModel.status === 'running'
        ? 'Solution is progressing'
        : viewModel.status === 'unknown'
          ? 'Case state unavailable'
          : `${statusLabel(viewModel.status)} Case`
  const reviewDetail = terminal
    ? 'Judge convergence and physical outputs before using this Case or creating a variation.'
    : 'Monitor residuals, forces, CFL, and solution bounds while the solver advances.'

  return (
    <ResourceReviewLayout
      className="case-workspace case-review-workspace"
      inventoryLabel="Case solution inventory"
      inspectorLabel="Case engineering review"
      inventory={(
        <>
          <div className="geometry-panel-heading">
            <div>
              <span>{previewSource === 'fallback' ? 'CONTEXT' : 'SOLUTION'}</span>
              <strong>{previewSource === 'fallback' ? t('Geometry context') : t('Visualization objects')}</strong>
            </div>
            <span className="geometry-count-badge">{visualizationGroups.reduce((total, group) => total + group.members.length, 0)}</span>
          </div>
          <div className="case-surface-inventory">
            {visualizationGroups.map(({ category, members }) => {
              const categoryLabel = previewSource === 'fallback' && category === 'surfaces'
                ? t('Geometry surfaces')
                : t(caseVisualizationCategoryLabel(category))
              const categoryVisibleCount = visibleCaseSurfaceCount(members, entityVisibility)
              const hasRenderableMembers = members.some((member) => member.entityIds.length > 0)
              const renderableMemberCount = members.filter((member) => member.entityIds.length > 0).length
              const CategoryIcon = category === 'surfaces'
                ? Layers
                : category === 'slices'
                  ? ScanLine
                  : category === 'isosurfaces'
                    ? CircleDashed
                    : Wind
              return (
                <ManifestMemberGroup
                  key={category}
                  label={categoryLabel}
                  memberLabel={categoryLabel}
                  icon={<CategoryIcon size={13} aria-hidden="true" />}
                  total={hasRenderableMembers ? renderableMemberCount : members.length}
                  visibleCount={categoryVisibleCount}
                  onHideAll={() => setEntityVisibility((current) => ({ ...current, ...caseSurfaceVisibilityMap(members, false) }))}
                  onShowAll={() => setEntityVisibility((current) => ({ ...current, ...caseSurfaceVisibilityMap(members, true) }))}
                  defaultExpanded={false}
                  showVisibilityControl={hasRenderableMembers}
                >
                  <div className="case-surface-list">
                    {members.map((group) => {
                      const visible = group.entityIds.some((entityId) => entityVisibility[entityId] ?? group.visible)
                      if (!group.entityIds.length) {
                        return (
                          <div className="case-result-row" key={group.id}>
                            {group.playbackKind ? <Film size={11} /> : <CircleDashed size={11} />}
                            <span>{group.source === 'archive' ? t(group.name) : group.name}</span>
                          </div>
                        )
                      }
                      return (
                        <div className={`geometry-entity-row ${selectedVisualizationId === group.id ? 'selected' : ''} ${visible ? '' : 'hidden'}`} data-entity-id={group.id} key={group.id}>
                          <button type="button" className="geometry-entity-select" onClick={() => {
                            setSelectedVisualizationId(group.id)
                            setViewerSelection({ groupId: group.entityIds[0] ?? null })
                          }} title={t('Select visualization object')}>
                            <span className="viewer-color-swatch" style={{ background: group.color }} />
                            <span>{group.name}</span>
                            <small>{group.triangles !== undefined ? `${group.triangles.toLocaleString()} tris` : t('object')}</small>
                          </button>
                          <button
                            type="button"
                            className="geometry-entity-visibility"
                            aria-label={t(visible ? 'Hide visualization object' : 'Show visualization object')}
                            aria-pressed={visible}
                            onClick={() => toggleSurfaceVisibility(group)}
                          >
                            {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </ManifestMemberGroup>
              )
            })}
            {visualizationGroups.length === 0 && (
              <div className="geometry-empty-list">{t('No visualization objects were reported by the asset.')}</div>
            )}
          </div>
          <div className="case-result-inventory">
            <ManifestMemberGroup
              label={t('Result artifacts')}
              memberLabel={t('Result artifacts')}
              icon={<FileOutput size={13} aria-hidden="true" />}
              total={resultRecords.length}
              visibleCount={resultRecords.length}
              defaultExpanded={false}
              showVisibilityControl={false}
            >
              {resultRecords.map((result, index) => {
              const path = result.path
              const label = result.name ?? path ?? `Result ${index + 1}`
              const previewable = isTabularResult(path, result.file_type) && Boolean(path)
              const archiveKind = timeSeriesArchiveKind(result)
              const timeSeriesPlayable = Boolean(archiveKind)
              const volumeSnapshot = isVolumeSnapshotArchive(result)
              const content = (
                <>
                  {timeSeriesPlayable ? <Film size={11} /> : <FileOutput size={11} />}
                  <span title={path ?? result.name}>{label}</span>
                  <small>{timeSeriesPlayable || previewable ? t('Open') : volumeSnapshot ? t('Final volume snapshot') : result.file_type ?? 'file'}</small>
                </>
              )
              return timeSeriesPlayable ? (
                <button
                  type="button"
                  className="case-result-row previewable"
                  onClick={() => openTimeSeriesPlayer(result)}
                  aria-label={t(caseTimeSeriesPlayerTitle(archiveKind!))}
                  key={path ?? label}
                >
                  {content}
                </button>
              ) : previewable ? (
                <button
                  type="button"
                  className="case-result-row previewable"
                  onClick={() => void openResultPreview(path!)}
                  aria-label={`Preview ${label}`}
                  key={path ?? label}
                >
                  {content}
                </button>
              ) : (
                <div className="case-result-row" key={path ?? label}>{content}</div>
              )
              })}
              {resultRecords.length === 0 && <div className="geometry-empty-list">{t('No result artifacts reported.')}</div>}
            </ManifestMemberGroup>
          </div>
        </>
      )}
      viewer={(
        <>
          <LazyViewer3D
            manifest={manifest}
            state={viewerState}
            selection={viewerSelection}
            onSelectionChange={handleViewerSelection}
            entityVisibility={entityVisibility}
            onEntityVisibilityChange={setEntityVisibility}
            selectedField={activeField}
            onSelectedFieldChange={setActiveField}
            fieldNames={selectedFieldNames}
            fieldEntityIds={selectedFieldEntityIds}
            showFieldPanel={Boolean(selectedVisualizationObject && selectedFieldNames.length > 0)}
            showEntityLegend={false}
            onEntitiesDiscovered={setViewerEntities}
            onAssetStatsChange={setViewerAssetStats}
            projectId={projectId}
            resourceRef={viewerContext.assetRef}
            toolInput={tools.toolInput}
            overlays={tools.overlays}
            onDoubleClick={tools.onDoubleClick}
            toolbar={activeField && <span className="viewer-toolbar-field-hint">Field · {activeField}</span>}
            topToolbar={<ViewerToolsDock model={tools} />}
            fitSelectionWhenSelected
          />
          <ViewerToolPanel model={tools} />
          {previewSource === 'fallback' && (
            <div className="cfd-viewer-source context" role="status" aria-live="polite">
              <ScanLine size={13} />
              <div>
                <strong>Geometry context</strong>
                <span aria-label="case field description">
                  Case field data is unavailable; parent Geometry anchors the solver and result context.
                </span>
              </div>
            </div>
          )}
          {resultPreview && (
            <ResultTablePreview
              path={resultPreview.path}
              cacheScope={`${projectId}:Case:${resourceId ?? detail?.id ?? ''}`}
              content={resultPreview.content}
              loading={resultPreview.loading}
              error={resultPreview.error}
              candidates={resultRecords.flatMap((result, index) => result.path && /\.csv$/i.test(result.path)
                ? [{ path: result.path, label: result.name ?? `Result ${index + 1}` }]
                : [])}
              loadCandidate={(candidatePath) => api.previewResult('Case', resourceId ?? detail?.id ?? '', candidatePath)}
              onClose={() => setResultPreview(null)}
            />
          )}
        </>
      )}
      inspector={(
        <>
          <div className={`geometry-readiness-card ${reviewLevel}`}>
            <div className="geometry-panel-heading case-review-heading">
              <div><span>{t('CASE REVIEW')}</span><strong>{t(reviewLabel)}</strong></div>
              <StatusBadge status={viewModel.status} />
            </div>
            <p>{t(reviewDetail)}</p>
          </div>

          <ViewerAssetInformation stats={viewerAssetStats} />

          {convResult && (
            <div className={`convergence-banner compact convergence-${convResult.status}`}>
              {convResult.status === 'converged' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              <div>
                <strong>{t(formatConvergenceStatus(convResult.status))}</strong>
                <p>{localizeConvergenceReason(convResult.reason, t)}</p>
              </div>
            </div>
          )}

          <div className="geometry-summary-grid case-summary-grid">
            <div><span><Clock size={12} /> Elapsed</span><strong>{viewModel.runTime}</strong></div>
            <div><span><Gauge size={12} /> Operating point</span><strong>{metricText(velocity)}</strong></div>
            <div><span><FileOutput size={12} /> Results</span><strong>{viewModel.resultCount}</strong></div>
            <div><span><Wind size={12} /> Turbulence</span><strong>{viewModel.turbulenceModel}</strong></div>
          </div>

          {hasErrors && (
            <div className="case-warning-banner">
              <AlertCircle size={14} />
              <span>Some Flow360 reads are incomplete; this review may be partial.</span>
            </div>
          )}

          <section className="geometry-selection-card case-selection-card">
            <div className="geometry-section-title"><Info size={13} /> Selection properties</div>
            <dl>
              <div><dt>{t('Visualization object')}</dt><dd>{selectedVisualizationObject?.name ?? t('None selected')}</dd></div>
              <div><dt>Selected field</dt><dd>{activeField ?? 'Base mesh'}</dd></div>
              {selectedVisualizationObject && <div><dt>Triangles</dt><dd>{selectedVisualizationObject.triangles?.toLocaleString() ?? 'Not reported'}</dd></div>}
            </dl>
          </section>

          <ResourceReviewLaunchers>
            {convResult && (
              <ResourceReviewLauncher
                icon={<BarChart3 size={14} />}
                label={t('Convergence evidence')}
                summary={t(formatConvergenceStatus(convResult.status))}
                onClick={() => setActiveReviewDialog('convergence')}
              />
            )}
            {timeSeriesArchives.map(({ kind, record }) => (
              <ResourceReviewLauncher
                key={kind}
                icon={<Film size={14} />}
                label={t(caseTimeSeriesPlayerTitle(kind))}
                summary={t('Prepare and inspect flow-field frames')}
                onClick={() => openTimeSeriesPlayer(record)}
              />
            ))}
          </ResourceReviewLaunchers>

          {previewSource === 'fallback' && (
            <div className="volume-source-warning" role="status">
              <AlertCircle size={14} />
              <span><strong>Geometry context shown</strong>Case result fields are unavailable as a browser asset.</span>
            </div>
          )}

          <div className="case-review-actions">
            <ResourceCreateDraftAction onCreate={onPlanCase} />
          </div>
          <small className="readiness-summary">Variations are staged as auditable Draft revisions before Flow360 execution.</small>
          {primaryError && previewSource === 'fallback' && (
            <small className="cfd-source-detail" title={primaryError}>Spatial context fallback is active</small>
          )}
          {activeReviewDialog === 'convergence' && convResult && (
            <ResourceReviewDialog
              title={t('Convergence evidence')}
              subtitle={t(formatConvergenceStatus(convResult.status))}
              icon={<BarChart3 size={18} />}
              onClose={() => setActiveReviewDialog(null)}
            >
              <div className="case-review-detail-block">
                {Object.entries(convResult.assessments).map(([key, assessment]: [string, ConvergenceAssessment]) => (
                  <div className="case-assessment-compact" key={key}>
                    <strong>{t(formatAssessmentKey(key))}</strong>
                    {Object.entries(assessment.metrics).map(([name, metric]: [string, ConvergenceMetric]) => (
                      <div className={metric.stable ? 'stable' : 'unstable'} key={name}>
                        <span>{name}</span>
                        <small>{formatNumber(metric.final)} · {t(convergenceTrendLabel(metric))}</small>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </ResourceReviewDialog>
          )}
          {activeReviewDialog === 'slices' && activePlayerArchive && (
            <ResourceReviewDialog
              title={t(caseTimeSeriesPlayerTitle(activePlayerArchive.kind))}
              subtitle={t('Large-file preparation and frame index')}
              icon={<Film size={18} />}
              onClose={() => setActiveReviewDialog(null)}
            >
              <CaseSlicePlayerPanel
                caseId={resourceId ?? detail?.id ?? ''}
                resultPath={activePlayerArchive.record.path ?? `results/${activePlayerArchive.kind}.tar.gz`}
                archiveKind={activePlayerArchive.kind}
                sizeBytes={activePlayerArchive.record.size_bytes}
              />
            </ResourceReviewDialog>
          )}
        </>
      )}
    />
  )
}
