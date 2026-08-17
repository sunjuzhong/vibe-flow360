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
  Film,
  Folder,
  ChevronDown,
  LoaderCircle,
} from 'lucide-react'
import { useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { resourceStatus } from './ResourceDetailPanel'
import { api, type ResourceDetail, type SlicePlayerJob } from '../api/client'
import { useConvergenceAssessment } from '../hooks/useConvergenceAssessment'
import type { ConvergenceAssessment, ConvergenceMetric, ConvergenceResult } from '../hooks/useConvergenceAssessment'
import { LazyViewer3D, type MeshGroupData, type ViewerAssetStats, type ViewerCameraCommand, type ViewerManifest, type ViewerSelection } from './viewer/LazyViewer3D'
import { ViewerAssetInformation } from './viewer/ViewerAssetInformation'
import { ViewerFieldDiagnostics } from './viewer/ViewerFieldDiagnostics'
import { CaseVisualizationSelectionCard } from './CaseVisualizationSelectionCard'
import { useResourcePreview } from '../hooks/useResourcePreview'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import { isolatedManifestVisibility } from '../lib/manifestVisibility'
import { ResourceReviewLayout } from './ResourceReviewLayout'
import ResourceCreateDraftAction from './ResourceCreateDraftAction'
import {
  ResourceReviewDialog,
  ResourceReviewLauncher,
  ResourceReviewLaunchers,
} from './ResourceReviewDialog'
import { useI18n } from '../i18n'
import { ResultTablePreview, isTabularResult } from './ResultTablePreview'
import CaseSlicePlayerPanel, { caseTimeSeriesPlayerTitle, slicePlayerAssetURL, type CaseTimeSeriesArchiveKind, type SlicePlaybackFrame } from './CaseSlicePlayerPanel'
import {
  createViewerContext,
  findLengthUnit,
} from '../lib/viewer-tools/context/ViewerContext'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'
import type { UVFEntityInfo, UVFFieldHistogram } from '../lib/uvf-three'
import { meshGroupManifestHints, normalizeManifestHint } from '../lib/manifestGroups'
import { ManifestMemberGroup } from './ManifestMemberGroup'
import { ParameterEntityInventory, useDraftEntities, useGhostEntities, useParameterEntityUnit, useParameterEntityVisibility } from './DraftEntityInventory'
import type { DraftEntityMutation } from '../lib/draftEntities'

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

export function caseResourceIdentity(resourceId?: string | null, detailId?: string | null): string {
  return resourceId || detailId || ''
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
  /** GeometryGroup ancestors below the category root. */
  folderPath?: string[]
  playbackKind?: CaseTimeSeriesArchiveKind
  source: 'manifest' | 'output' | 'archive'
}

export type CaseVisualizationTreeNode =
  | { kind: 'folder'; id: string; name: string; members: CaseVisualizationMember[]; children: CaseVisualizationTreeNode[] }
  | { kind: 'member'; id: string; member: CaseVisualizationMember }

export function caseVisualizationMemberTree(members: CaseVisualizationMember[]): CaseVisualizationTreeNode[] {
  const root: Extract<CaseVisualizationTreeNode, { kind: 'folder' }> = {
    kind: 'folder', id: 'root', name: 'root', members: [], children: [],
  }
  for (const member of members) {
    let parent = root
    const pathParts: string[] = []
    for (const folderName of member.folderPath ?? []) {
      pathParts.push(folderName)
      const folderID = `folder:${pathParts.map(normalizeManifestHint).join('/')}`
      let folder = parent.children.find((node): node is Extract<CaseVisualizationTreeNode, { kind: 'folder' }> => (
        node.kind === 'folder' && node.id === folderID
      ))
      if (!folder) {
        folder = { kind: 'folder', id: folderID, name: folderName, members: [], children: [] }
        parent.children.push(folder)
      }
      folder.members.push(member)
      parent = folder
    }
    parent.children.push({ kind: 'member', id: member.id, member })
  }
  return root.children
}

function CaseVisualizationTreeRows({
  nodes,
  entityVisibility,
  setVisibility,
  renderMember,
}: {
  nodes: CaseVisualizationTreeNode[]
  entityVisibility: Record<string, boolean>
  setVisibility: (members: CaseVisualizationMember[], visible: boolean) => void
  renderMember: (member: CaseVisualizationMember) => ReactNode
}) {
  return nodes.map((node) => {
    if (node.kind === 'member') return renderMember(node.member)
    const counts = caseVisualizationGroupCounts(node.members, entityVisibility)
    const renderable = node.members.some((member) => member.entityIds.length > 0)
    return (
      <div className="case-manifest-folder" key={node.id}>
        <ManifestMemberGroup
          label={node.name}
          memberLabel={node.name}
          icon={<Folder size={12} aria-hidden="true" />}
          total={counts.total}
          visibleCount={counts.visible}
          onHideAll={() => setVisibility(node.members, false)}
          onShowAll={() => setVisibility(node.members, true)}
          showVisibilityControl={renderable}
          defaultExpanded
        >
          <div className="case-surface-list case-manifest-folder__children">
            <CaseVisualizationTreeRows
              nodes={node.children}
              entityVisibility={entityVisibility}
              setVisibility={setVisibility}
              renderMember={renderMember}
            />
          </div>
        </ManifestMemberGroup>
      </div>
    )
  })
}

export function reconcileCaseVisualizationSelection(
  selectedVisualizationId: string | null,
  viewerSelection: ViewerSelection,
  groups: CaseVisualizationGroup[],
): { selectedVisualizationId: string | null; viewerSelection: ViewerSelection } {
  if (!selectedVisualizationId) return { selectedVisualizationId: null, viewerSelection }
  const member = groups.flatMap(({ members }) => members)
    .find((candidate) => candidate.id === selectedVisualizationId)
  if (!member) return { selectedVisualizationId: null, viewerSelection: { groupId: null } }
  if (!member.entityIds.length) return { selectedVisualizationId, viewerSelection }
  const groupId = viewerSelection.groupId && member.entityIds.includes(viewerSelection.groupId)
    ? viewerSelection.groupId
    : member.entityIds[0]
  return {
    selectedVisualizationId,
    viewerSelection: { groupId, groupIds: member.entityIds },
  }
}

export type CaseArchiveLayer = {
  memberId: string
  manifest: ViewerManifest
  entityIds: string[]
  fields: string[]
}

type ArchiveManifestEntry = {
  id?: unknown
  name?: unknown
  type?: unknown
  resources?: { buffers?: { sections?: Array<{ name?: unknown }> } }
}

export function caseArchiveLayerFromEntries(
  member: CaseVisualizationMember,
  assetURL: string,
  frame: NonNullable<NonNullable<SlicePlayerJob['report']>['playback']>['frames'][number],
  entries: ArchiveManifestEntry[],
): CaseArchiveLayer | null {
  const faces = entries.filter((entry) => entry.type === 'Face' && typeof entry.id === 'string')
  if (!faces.length) return null
  const fields = [...new Set(entries.flatMap((entry) => entry.resources?.buffers?.sections ?? [])
    .map((section) => String(section.name ?? ''))
    .filter((name) => name && !['indices', 'position', 'normal', 'edgePosition'].includes(name)))]
  const entityIDPrefix = `archive:${member.id}:`
  const entityIds = faces.map((entry) => `${entityIDPrefix}${String(entry.id)}`)
  return {
    memberId: member.id,
    entityIds,
    fields,
    manifest: {
      asset_url: assetURL,
      format: 'flow360-uvf',
      entity_id_prefix: entityIDPrefix,
      bounding_box: { min: frame.bounds[0], max: frame.bounds[1] },
      groups: faces.map((entry, index) => ({
        id: `${entityIDPrefix}${String(entry.id)}`,
        name: faces.length === 1 ? member.name : `${member.name} ${index + 1}`,
        color: member.color,
        visible: true,
      })),
      vertices: frame.preview_vertices || frame.vertices,
      elements: frame.preview_triangles || frame.triangles,
    },
  }
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
  const categorizedGroups = groups.map((group) => {
    const hints = meshGroupManifestHints(group).map(normalizeManifestHint)
    const category: CaseVisualizationCategory = hints.some((hint) => hint.includes('streamline'))
      ? 'streamlines'
      : hints.some((hint) => hint.includes('isosurface'))
        ? 'isosurfaces'
        : hints.some((hint) => hint.includes('slice'))
          ? 'slices'
          : 'surfaces'
    return { category, group }
  })
  for (const { category, group } of categorizedGroups) {
    const relativePath = (group.path ?? []).slice(1)
    const isFace = group.entity_type === 'Face'
    const isSolidGeometry = group.entity_type === 'SolidGeometry'
    const containerName = group.path?.at(-1) || group.name
    const memberName = isFace ? relativePath.at(-1) || group.name : isSolidGeometry ? group.name : containerName
    const folderPath = isFace ? relativePath.slice(0, -1) : isSolidGeometry ? relativePath : []
    const members = categorized.get(category)!
    const memberKey = `${folderPath.map(normalizeManifestHint).join('/')}\u0000${normalizeManifestHint(memberName)}`
    const existing = isSolidGeometry ? undefined : members.find((member) => (
      `${(member.folderPath ?? []).map(normalizeManifestHint).join('/')}\u0000${normalizeManifestHint(member.name)}` === memberKey
    ))
    if (existing) {
      existing.entityIds.push(group.id)
      existing.visible ||= group.visible
      existing.triangles = (existing.triangles ?? 0) + (group.triangles ?? 0)
      existing.vertices = (existing.vertices ?? 0) + (group.vertices ?? 0)
      continue
    }
    members.push({
      ...group,
      name: memberName,
      folderPath,
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
      const descendants = section.members.filter((candidate) => candidate.source === 'manifest'
        && candidate.path?.some((segment) => normalizeManifestHint(segment) === normalizedName))
      if (descendants.length > 0) {
        for (const descendant of descendants) descendant.playbackKind ??= member.playbackKind
        continue
      }
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

export function caseCommonFieldNames(
  entities: UVFEntityInfo[],
  members: CaseVisualizationMember[],
): string[] {
  if (!members.length) return []
  const fieldsByMember = members.map((member) => new Set(member.entityIds
    .flatMap((entityId) => caseObjectFieldNames(entities, entityId))))
  return [...fieldsByMember[0]].filter((field) => fieldsByMember
    .slice(1).every((fields) => fields.has(field)))
}

export function nextCaseVisualizationSelection(
  selectedIds: string[],
  memberId: string,
  additive: boolean,
): string[] {
  if (!additive) return [memberId]
  return selectedIds.includes(memberId)
    ? selectedIds.filter((id) => id !== memberId)
    : [...selectedIds, memberId]
}

export function caseFieldForSelection(activeField: string | null, fieldNames: string[]): string | null {
  return activeField && fieldNames.includes(activeField) ? activeField : null
}

export function caseVisualizationSelectionKey(selectedIds: string[]): string {
  return [...selectedIds].sort().join('\u0000')
}

export function visibleCaseSurfaceCount(groups: CaseSurfaceGroup[], visibility: Record<string, boolean>): number {
  return groups.filter((group) => {
    const entityIds = group.entityIds ?? [group.id]
    return entityIds.length > 0 && entityIds.some((id) => visibility[id] ?? group.visible)
  }).length
}

export function caseVisualizationGroupCounts(
  groups: CaseSurfaceGroup[],
  visibility: Record<string, boolean>,
): { total: number; visible: number } {
  return {
    total: groups.length,
    visible: visibleCaseSurfaceCount(groups, visibility),
  }
}

export function caseSurfaceVisibilityMap(groups: CaseSurfaceGroup[], visible: boolean): Record<string, boolean> {
  return Object.fromEntries(groups.flatMap((group) => (group.entityIds ?? [group.id]).map((id) => [id, visible])))
}

export function isolateCaseVisualizationMap(
  groups: CaseSurfaceGroup[],
  selectedEntityIds: string[],
  manifestGroups: MeshGroupData[] = [],
): Record<string, boolean> {
  return {
    ...caseSurfaceVisibilityMap(groups, false),
    ...(manifestGroups.length
      ? isolatedManifestVisibility(manifestGroups, selectedEntityIds)
      : Object.fromEntries(selectedEntityIds.map((id) => [id, true]))),
  }
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
  onMutateDraftEntity,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  projectId: string
  resourceRef: ResourceRef
  annotationsModel: ProjectAnnotationsModel<JsonValue>
  geometryResourceId?: string | null
  onPlanCase: () => Promise<void>
  onMutateDraftEntity?: (mutation: DraftEntityMutation) => Promise<void>
}) {
  const { t } = useI18n()
  const [activeReviewDialog, setActiveReviewDialog] = useState<'convergence' | 'slices' | null>(null)
  const [activePlayerArchive, setActivePlayerArchive] = useState<{ kind: CaseTimeSeriesArchiveKind; record: CaseResultRecord; memberId?: string } | null>(null)
  const [archiveLayers, setArchiveLayers] = useState<Record<string, CaseArchiveLayer>>({})
  const [archiveLayerLoading, setArchiveLayerLoading] = useState<string | null>(null)
  const [archiveLayerError, setArchiveLayerError] = useState('')
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const [selectedVisualizationIds, setSelectedVisualizationIds] = useState<string[]>([])
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({})
  const [parameterEntityVisibility, setParameterEntityVisibility] = useParameterEntityVisibility(detail?.simulation_params)
  const parameterEntityUnit = useParameterEntityUnit(detail?.simulation_params)
  const draftEntities = useDraftEntities(detail?.simulation_params)
  const ghostEntities = useGhostEntities(detail?.simulation_params)
  const parameterEntities = useMemo(() => [...draftEntities, ...ghostEntities], [draftEntities, ghostEntities])
  const [viewerEntities, setViewerEntities] = useState<UVFEntityInfo[]>([])
  const [activeField, setActiveField] = useState<string | null>(null)
  const [fieldHistogram, setFieldHistogram] = useState<UVFFieldHistogram | null>(null)
  const [fieldVisualizationEnabled, setFieldVisualizationEnabled] = useState(false)
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand | null>(null)
  const [viewerAssetStats, setViewerAssetStats] = useState<ViewerAssetStats | null>(null)
  const archiveLayerRequestRef = useRef<Record<string, number>>({})
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
  const resourceIdentity = caseResourceIdentity(resourceId, detail?.id)

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
  const configuredVisualizationGroups = useMemo(
    () => caseVisualizationSections(surfaceGroups, Boolean(sliceArchive), configuredVisualizationMembers),
    [configuredVisualizationMembers, sliceArchive, surfaceGroups],
  )
  const visualizationGroups = useMemo(() => configuredVisualizationGroups.map((section) => ({
    ...section,
    members: section.members.map((member) => {
      const layer = archiveLayers[member.id]
      return layer ? {
        ...member,
        entityIds: layer.entityIds,
        triangles: layer.manifest.elements,
        vertices: layer.manifest.vertices,
        visible: true,
        source: 'archive' as const,
      } : member
    }),
  })), [archiveLayers, configuredVisualizationGroups])
  const archiveLayerManifests = useMemo(
    () => Object.values(archiveLayers).map((layer) => layer.manifest),
    [archiveLayers],
  )
  const renderableVisualizationGroups = useMemo(
    () => [...surfaceGroups, ...archiveLayerManifests.flatMap((layerManifest) => layerManifest.groups)],
    [archiveLayerManifests, surfaceGroups],
  )
  const allVisualizationMembers = visualizationGroups.flatMap(({ members }) => members)
  const selectedVisualizationObjects = selectedVisualizationIds.flatMap((id) => {
    const member = allVisualizationMembers.find((candidate) => candidate.id === id)
    return member ? [member] : []
  })
  const selectedVisualizationItems = selectedVisualizationObjects.map((member) => ({
    ...member,
    typeLabel: t(caseVisualizationCategoryLabel(visualizationGroups
      .find(({ members }) => members.some((candidate) => candidate.id === member.id))?.category ?? 'surfaces')),
  }))
  const selectedFieldNames = useMemo(
    () => caseCommonFieldNames(viewerEntities, selectedVisualizationObjects),
    [selectedVisualizationObjects, viewerEntities],
  )
  const selectedFieldEntityIds = useMemo(
    () => selectedVisualizationObjects.flatMap((member) => member.entityIds),
    [selectedVisualizationObjects],
  )
  const selectedVisualizationKey = useMemo(
    () => caseVisualizationSelectionKey(selectedVisualizationIds),
    [selectedVisualizationIds],
  )
  const previousSelectedVisualizationKeyRef = useRef(selectedVisualizationKey)
  const selectedVisualizationVisible = selectedVisualizationObjects.some((member) => member.entityIds.some(
    (entityId) => entityVisibility[entityId] ?? member.visible,
  ))

  useEffect(() => {
    setEntityVisibility(Object.fromEntries(surfaceGroups.map((group) => [group.id, group.visible])))
  }, [manifest?.asset_url])

  useEffect(() => {
    if (viewerState.status !== 'ready' || !selectedVisualizationIds.length) return
    const availableMembers = visualizationGroups.flatMap(({ members }) => members)
    const nextSelectedIds = selectedVisualizationIds.filter((id) => availableMembers.some((member) => member.id === id))
    const nextGroupIds = nextSelectedIds.flatMap((id) => availableMembers
      .find((member) => member.id === id)?.entityIds ?? [])
    if (nextSelectedIds.length !== selectedVisualizationIds.length) setSelectedVisualizationIds(nextSelectedIds)
    const currentGroupIds = viewerSelection.groupIds ?? []
    if (
      (nextGroupIds.at(-1) ?? null) !== viewerSelection.groupId
      || currentGroupIds.length !== nextGroupIds.length
      || currentGroupIds.some((id, index) => id !== nextGroupIds[index])
    ) {
      setViewerSelection({ groupId: nextGroupIds.at(-1) ?? null, groupIds: nextGroupIds })
    }
  }, [selectedVisualizationIds, viewerSelection, viewerState.status, visualizationGroups])

  useEffect(() => {
    setArchiveLayers({})
    setArchiveLayerLoading(null)
    setArchiveLayerError('')
    setViewerSelection({ groupId: null })
    setSelectedVisualizationIds([])
    setActiveField(null)
    setFieldVisualizationEnabled(false)
  }, [resourceIdentity])

  useEffect(() => {
    if (selectedVisualizationIds.length) return
    setFieldVisualizationEnabled(false)
    setActiveField(null)
  }, [selectedVisualizationIds.length])

  useEffect(() => {
    if (previousSelectedVisualizationKeyRef.current === selectedVisualizationKey) return
    previousSelectedVisualizationKeyRef.current = selectedVisualizationKey
    setFieldVisualizationEnabled(false)
    setActiveField(null)
    setFieldHistogram(null)
  }, [selectedVisualizationKey])

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

  const installArchiveLayer = useCallback(async (member: CaseVisualizationMember, job: SlicePlayerJob, requestedFrame?: SlicePlaybackFrame) => {
    const requestID = (archiveLayerRequestRef.current[member.id] ?? 0) + 1
    archiveLayerRequestRef.current[member.id] = requestID
    const frame = requestedFrame ?? job.report?.playback?.frames[0]
    if (!job.report?.playback?.ready || !frame) throw new Error(t('No playable frame is available in this result archive.'))
    const manifestPath = frame.preview_manifest_path || frame.manifest_path
    const assetURL = slicePlayerAssetURL(resourceId ?? detail?.id ?? '', job.id, manifestPath)
    const response = await fetch(assetURL)
    if (!response.ok) throw new Error(t('The prepared result layer could not be loaded.'))
    const entries = await response.json() as ArchiveManifestEntry[]
    const layer = caseArchiveLayerFromEntries(member, assetURL, frame, entries)
    if (!layer) throw new Error(t('The prepared result layer contains no selectable surfaces.'))
    if (archiveLayerRequestRef.current[member.id] !== requestID) return
    setArchiveLayers((current) => ({ ...current, [member.id]: layer }))
    setEntityVisibility((current) => ({
      ...current,
      ...Object.fromEntries(layer.entityIds.map((entityId) => [entityId, true])),
    }))
    setSelectedVisualizationIds([member.id])
    setViewerSelection({ groupId: layer.entityIds[0] ?? null, groupIds: layer.entityIds })
    setArchiveLayerError('')
  }, [detail?.id, resourceId, t])

  const activateArchiveMember = useCallback(async (member: CaseVisualizationMember) => {
    setSelectedVisualizationIds([member.id])
    const loaded = archiveLayers[member.id]
    if (loaded) {
      setViewerSelection({ groupId: loaded.entityIds[0] ?? null, groupIds: loaded.entityIds })
      return
    }
    if (!member.playbackKind) return
    const archive = timeSeriesArchives.find(({ kind }) => kind === member.playbackKind)
    if (!archive) return
    setArchiveLayerLoading(member.id)
    setArchiveLayerError('')
    try {
      const job = await api.latestSlicePlayer(resourceId ?? detail?.id ?? '', archive.record.path ?? `results/${member.playbackKind}.tar.gz`)
      if (job.status === 'completed' && job.report?.playback?.ready) {
        await installArchiveLayer(member, job)
      } else {
        setActivePlayerArchive({ kind: member.playbackKind, record: archive.record, memberId: member.id })
        setActiveReviewDialog('slices')
      }
    } catch {
      setActivePlayerArchive({ kind: member.playbackKind, record: archive.record, memberId: member.id })
      setActiveReviewDialog('slices')
    } finally {
      setArchiveLayerLoading(null)
    }
  }, [archiveLayers, detail?.id, installArchiveLayer, resourceId, timeSeriesArchives])

  const handleArchivePlaybackFrameChange = useCallback((job: SlicePlayerJob, frame: SlicePlaybackFrame) => {
    const memberId = activePlayerArchive?.memberId
    if (!memberId) return
    const member = configuredVisualizationGroups
      .flatMap(({ members }) => members)
      .find((candidate) => candidate.id === memberId)
    if (!member) return
    void installArchiveLayer(member, job, frame)
      .catch((cause) => setArchiveLayerError(cause instanceof Error ? cause.message : String(cause)))
  }, [activePlayerArchive?.memberId, configuredVisualizationGroups, installArchiveLayer])

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
    setSelectedVisualizationIds(selectedMember ? [selectedMember.id] : [])
  }
  const selectVisualizationMember = (member: CaseVisualizationMember, additive: boolean) => {
    const selectedIds = nextCaseVisualizationSelection(selectedVisualizationIds, member.id, additive)
    const entityIds = selectedIds.flatMap((id) => allVisualizationMembers
      .find((candidate) => candidate.id === id)?.entityIds ?? [])
    setSelectedVisualizationIds(selectedIds)
    setViewerSelection({ groupId: entityIds.at(-1) ?? null, groupIds: entityIds })
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
            <span className="geometry-count-badge">{visualizationGroups.reduce((total, group) => total + group.members.length, 0) + parameterEntities.length}</span>
          </div>
          <div className="case-surface-inventory">
            {visualizationGroups.map(({ category, members }) => {
              const categoryLabel = previewSource === 'fallback' && category === 'surfaces'
                ? t('Geometry surfaces')
                : t(caseVisualizationCategoryLabel(category))
              const categoryCounts = caseVisualizationGroupCounts(members, entityVisibility)
              const hasRenderableMembers = members.some((member) => member.entityIds.length > 0)
              const memberTree = caseVisualizationMemberTree(members)
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
                  total={categoryCounts.total}
                  visibleCount={categoryCounts.visible}
                  onHideAll={() => setEntityVisibility((current) => ({ ...current, ...caseSurfaceVisibilityMap(members, false) }))}
                  onShowAll={() => setEntityVisibility((current) => ({ ...current, ...caseSurfaceVisibilityMap(members, true) }))}
                  defaultExpanded={false}
                  showVisibilityControl={hasRenderableMembers}
                >
                  <div className="case-surface-list">
                    <CaseVisualizationTreeRows
                      nodes={memberTree}
                      entityVisibility={entityVisibility}
                      setVisibility={(folderMembers, visible) => setEntityVisibility((current) => ({
                        ...current,
                        ...caseSurfaceVisibilityMap(folderMembers, visible),
                      }))}
                      renderMember={(group) => {
                      const visible = group.entityIds.some((entityId) => entityVisibility[entityId] ?? group.visible)
                      if (!group.entityIds.length) {
                        const loadingLayer = archiveLayerLoading === group.id
                        return (
                          <div className={`geometry-entity-row archive-placeholder ${selectedVisualizationIds.includes(group.id) ? 'selected' : ''}`} key={group.id}>
                            <button
                              type="button"
                              className="geometry-entity-select"
                              onClick={() => void activateArchiveMember(group)}
                              title={t(group.playbackKind ? 'Load result layer into the 3D view' : 'Select visualization object')}
                            >
                              <span className="case-archive-entity-icon">{group.playbackKind ? <Film size={11} /> : <CircleDashed size={11} />}</span>
                              <span>{group.source === 'archive' ? t(group.name) : group.name}</span>
                              <small>{group.playbackKind ? t('Result archive layer') : t('Unavailable')}</small>
                            </button>
                            <button
                              type="button"
                              className="geometry-entity-visibility"
                              disabled={!group.playbackKind || loadingLayer}
                              onClick={() => void activateArchiveMember(group)}
                              title={t(group.playbackKind ? 'Load result layer into the 3D view' : 'Visualization output is not available in the 3D preview')}
                              aria-label={t(group.playbackKind ? 'Load result layer into the 3D view' : 'Visualization output is not available in the 3D preview')}
                              aria-pressed={false}
                            >
                              {loadingLayer ? <LoaderCircle className="spin" size={13} /> : <EyeOff size={13} />}
                            </button>
                          </div>
                        )
                      }
                      return (
                        <div className={`geometry-entity-row case-visualization-row ${selectedVisualizationIds.includes(group.id) ? 'selected' : ''} ${visible ? '' : 'hidden'}`} data-entity-id={group.id} key={group.id}>
                          <button type="button" className="geometry-entity-select" onClick={(event) => {
                            selectVisualizationMember(group, event.shiftKey || event.metaKey || event.ctrlKey)
                          }} title={t('Select; Shift, Ctrl, or Cmd-click to add or remove')} aria-label={`${t('Select visualization object')}: ${group.name}`}>
                            <span className="viewer-color-swatch" style={{ background: group.color }} />
                            <span title={group.name}>{group.name}</span>
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
                    }} />
                  </div>
                </ManifestMemberGroup>
              )
            })}
            {visualizationGroups.length === 0 && (
              <div className="geometry-empty-list">{t('No visualization objects were reported by the asset.')}</div>
            )}
            {archiveLayerError && <div className="slice-player-error" role="alert"><AlertCircle size={13} />{archiveLayerError}</div>}
          </div>
          {(draftEntities.length > 0 || ghostEntities.length > 0 || Boolean(onMutateDraftEntity)) && (
            <div className="case-parameter-entity-inventory">
              <ParameterEntityInventory
                entities={draftEntities}
                visibility={parameterEntityVisibility}
                onVisibilityChange={setParameterEntityVisibility}
                source="draft"
                unit={parameterEntityUnit}
                onMutate={onMutateDraftEntity}
              />
              <ParameterEntityInventory
                entities={ghostEntities}
                visibility={parameterEntityVisibility}
                onVisibilityChange={setParameterEntityVisibility}
                source="ghost"
              />
            </div>
          )}
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
            additionalManifests={archiveLayerManifests}
            preserveCameraOnAssetChange
            state={viewerState}
            selection={viewerSelection}
            onSelectionChange={handleViewerSelection}
            entityVisibility={entityVisibility}
            onEntityVisibilityChange={setEntityVisibility}
            parameterEntities={parameterEntities}
            parameterEntityVisibility={parameterEntityVisibility}
            selectedField={fieldVisualizationEnabled ? activeField : null}
            onSelectedFieldChange={setActiveField}
            fieldNames={selectedFieldNames}
            fieldEntityIds={selectedFieldEntityIds}
            fieldStateResetKey={selectedVisualizationKey}
            onFieldHistogramChange={setFieldHistogram}
            showFieldPanel={Boolean(fieldVisualizationEnabled && selectedVisualizationObjects.length && selectedFieldNames.length > 0)}
            fieldPanelExtra={(fieldPanel) => (
              <ViewerFieldDiagnostics
                field={fieldPanel.field}
                range={fieldPanel.range}
                histogram={fieldHistogram}
              />
            )}
            showVectorControls={fieldVisualizationEnabled}
            showEntityLegend={false}
            onEntitiesDiscovered={setViewerEntities}
            onAssetStatsChange={setViewerAssetStats}
            projectId={projectId}
            resourceRef={viewerContext.assetRef}
            toolInput={tools.toolInput}
            overlays={tools.overlays}
            onDoubleClick={tools.onDoubleClick}
            topToolbar={<ViewerToolsDock model={tools} />}
            cameraCommand={cameraCommand}
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

          <details className="case-review-details case-review-evidence">
            <summary>
              <span>{t('Review evidence')}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </summary>
            <div className="case-review-evidence-content">
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
            </div>
          </details>

          {hasErrors && (
            <div className="case-warning-banner">
              <AlertCircle size={14} />
              <span>Some Flow360 reads are incomplete; this review may be partial.</span>
            </div>
          )}

          {selectedVisualizationObjects.length > 0 && (
            <CaseVisualizationSelectionCard
              items={selectedVisualizationItems}
              visible={selectedVisualizationVisible}
              fieldNames={selectedFieldNames}
              fieldVisualizationEnabled={fieldVisualizationEnabled}
              activeField={activeField}
              onFocus={() => setCameraCommand({ type: 'fit-selection', nonce: Date.now() })}
              onIsolate={() => setEntityVisibility((current) => ({
                ...current,
                ...isolateCaseVisualizationMap(allVisualizationMembers, selectedFieldEntityIds, renderableVisualizationGroups),
              }))}
              onToggleVisibility={() => setEntityVisibility((current) => ({
                ...current,
                ...Object.fromEntries(selectedFieldEntityIds.map((id) => [id, !selectedVisualizationVisible])),
              }))}
              onShowAll={() => setEntityVisibility((current) => ({
                ...current,
                ...caseSurfaceVisibilityMap(allVisualizationMembers, true),
              }))}
              onClear={() => {
                setSelectedVisualizationIds([])
                setViewerSelection({ groupId: null })
              }}
              onFieldVisualizationChange={(checked) => {
                setFieldVisualizationEnabled(checked)
                if (!checked) setActiveField(null)
              }}
            />
          )}

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
                onPlaybackFrameChange={handleArchivePlaybackFrameChange}
              />
            </ResourceReviewDialog>
          )}
        </>
      )}
    />
  )
}
