import {
  AlertTriangle,
  Box,
  Camera,
  CheckCircle2,
  CircleHelp,
  GitCompare,
  GitPullRequestDraft,
  Eye,
  EyeOff,
  Info,
  LocateFixed,
  Palette,
  Plus,
  Ruler,
  ScanLine,
  Scissors,
  Search,
  Shapes,
  Sparkles,
  Trash2,
  Undo2,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  api,
  type GeometryComparison,
  type GeometryDiagnosticJob,
  type GeometryDiagnosticReport,
  type ResourceDetail,
} from '../api/client'
import {
  geometryReviewTemplates,
  localizeDiagnosticCapability,
  localizeDiagnosticFinding,
  type GeometryReviewTemplateId,
} from '../lib/geometryAdvanced'
import {
  buildGeometryReview,
  formatGeometryNumber,
  type GeometryCheck,
  type GeometryCheckLevel,
} from '../lib/geometryReview'
import {
  geometrySurfaceRoles,
  suggestGeometrySemantics,
  type GeometryBodyIntent,
  type GeometrySemanticAssignment,
  geometrySurfaceRoleForBoundary,
  type GeometrySemanticDraft,
  type GeometrySurfaceRole,
} from '../lib/geometrySemantics'
import { resourceStatus } from './ResourceDetailPanel'
import ResourceCreateDraftAction from './ResourceCreateDraftAction'
import HelpTooltip from './HelpTooltip'
import {
  buildGeometryEntityAppearances,
  canDeleteGeometryAppearance,
  clearGeometryAppearanceOverrides,
  geometryAppearancePresetForBoundary,
  isCfdGeometryAppearancePreset,
  isGeometryAppearancePreset,
  loadGeometryAppearanceAssignments,
  loadGeometryAppearanceLibrary,
  newGeometryAppearance,
  resolveGeometryAppearanceAssignments,
  saveGeometryAppearanceAssignments,
  saveGeometryAppearanceLibrary,
  type GeometryAppearance,
} from '../lib/geometryAppearances'
import { buildSurfaceBoundaryInventory } from '../lib/surfaceMeshReview'
import {
  LazyViewer3D,
  type ViewerAssetStats,
  type ViewerCameraCommand,
  type ViewerClipPlane,
  type ViewerSelection,
} from './viewer/LazyViewer3D'
import { ViewerAssetInformation } from './viewer/ViewerAssetInformation'
import { useResourcePreview } from '../hooks/useResourcePreview'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { useI18n } from '../i18n'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'
import { ManifestMemberGroup, manifestVisibilityMap } from './ManifestMemberGroup'
import './GeometryWorkspace.css'

const readinessCopy = {
  ready: { label: 'Ready', detail: 'Available geometry evidence passes preflight.' },
  warning: { label: 'Ready with warnings', detail: 'Review assumptions and unevaluated diagnostics before meshing.' },
  blocked: { label: 'Blocked', detail: 'Resolve blocking geometry conditions before meshing.' },
}

function CheckIcon({ level }: { level: GeometryCheckLevel }) {
  if (level === 'ready') return <CheckCircle2 size={14} />
  if (level === 'blocked') return <XCircle size={14} />
  if (level === 'warning') return <AlertTriangle size={14} />
  return <CircleHelp size={14} />
}

type GeometryCapabilityPanel = 'appearance' | 'semantics' | 'diagnostics' | 'health'
const topologyCheckKeys = new Set(['free-edges', 'non-manifold', 'self-intersections', 'components'])

function translatedCount(t: (value: string) => string, template: string, count: number) {
  return t(template).replace('{count}', count.toLocaleString())
}

function localizePreflightCheck(t: (value: string) => string, check: GeometryCheck) {
  let detail = t(check.detail)
  if (check.key === 'processing') {
    detail = check.level === 'ready' ? t('Flow360 processing completed') : t('Geometry processing is not complete.')
  } else if (check.key === 'unit') {
    detail = check.level === 'ready'
      ? t('Reported value · {value}').replace('{value}', check.detail.replace(/^Reported as /, ''))
      : t('Length unit must be confirmed before meshing')
  } else if (check.key === 'dimensions' && check.level !== 'ready') {
    detail = t('Bounding box is not available')
  } else if (check.key === 'surfaces') {
    detail = check.level === 'ready'
      ? translatedCount(t, '{count} renderable surfaces', check.count ?? 0)
      : t('No renderable surface inventory is available')
  } else if (topologyCheckKeys.has(check.key)) {
    if (check.level === 'unknown') detail = t('This topology check could not be completed with the synchronized evidence.')
    else if (check.key === 'components') {
      detail = translatedCount(
        t,
        check.level === 'ready' ? '{count} connected components' : '{count} disconnected triangle components detected',
        check.count ?? 0,
      )
    } else {
      detail = check.level === 'ready' ? t('None detected') : translatedCount(t, '{count} detected', check.count ?? 0)
    }
  } else if (check.key === 'read-errors') {
    detail = check.level === 'ready'
      ? t('No partial-read errors')
      : translatedCount(t, '{count} Flow360 metadata sections failed to load', check.count ?? 0)
  }
  return { label: t(check.label), detail }
}

export function GeometryCapabilityDialog({
  title,
  subtitle,
  icon,
  titleHelp,
  children,
  onClose,
}: {
  title: string
  subtitle: string
  icon: ReactNode
  titleHelp?: ReactNode
  children: ReactNode
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    dialogRef.current?.focus()
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const dialog = (
    <div
      className="geometry-capability-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="geometry-capability-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header>
          <span className="geometry-capability-dialog-icon">{icon}</span>
          <div>
            <div className="geometry-capability-dialog-title"><strong>{title}</strong>{titleHelp}</div>
            <small>{subtitle}</small>
          </div>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}><X size={17} /></button>
        </header>
        <div className="geometry-capability-dialog-body">{children}</div>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

export function AdvancedDiagnosticsHelp() {
  const { t } = useI18n()

  return (
    <HelpTooltip
      label={t('About advanced diagnostics')}
      placement="bottom"
      align="start"
      width="guide"
    >
      <div className="help-tooltip__rich">
        <header>
          <strong>{t('How advanced diagnostics are calculated')}</strong>
          <span>{t('All findings come from the synchronized default-LOD Flow360 UVF manifest and indexed triangle buffers; the Geometry is not modified.')}</span>
        </header>
        <dl>
          <div>
            <dt>{t('Small surfaces')}</dt>
            <dd>{t('Area threshold = median provided face area × selected ratio. If no face area exists, triangle threshold = max(2, floor(median triangle count × ratio)).')}</dd>
          </div>
          <div>
            <dt>{t('Mesh topology')}</dt>
            <dd>{t('Vertices are quantized at bounding-box diagonal × 1e-8. Edge incidence finds free and non-manifold edges, union-find counts connected components, and BVH plus SAT tests non-adjacent triangle intersections.')}</dd>
          </div>
          <div>
            <dt>{t('Normal variation')}</dt>
            <dd>{t('Samples up to 128 indexed normals per Face and computes max acos(nᵢ · nⱼ). A Face is flagged when that angle reaches the selected threshold; this is a curvature proxy, not a radius.')}</dd>
          </div>
          <div>
            <dt>{t('Body proximity')}</dt>
            <dd>{t('Computes the per-axis gaps between every pair of solid AABBs, then takes their Euclidean distance and the minimum pair. Overlapping boxes return zero and remain inconclusive.')}</dd>
          </div>
          <div>
            <dt>{t('Exact clearance')}</dt>
            <dd>{t('Exact face-to-face gaps require CAD B-rep and kernel distance queries. UVF does not contain that evidence, so exact CAD clearance stays unavailable.')}</dd>
          </div>
        </dl>
        <section>
          <strong>{t('Capability states')}</strong>
          <span>{t('Available = computed evidence. Proxy = an approximation. Unavailable or unknown = insufficient evidence and is never treated as passed.')}</span>
        </section>
        <section className="help-tooltip__caveat">
          <strong>{t('Limits')}</strong>
          <span>{t('Results depend on the synchronized UVF LOD, tessellation quality, and model coordinate scale. Confirm candidates in 3D or with a CAD kernel before changing Geometry or meshing settings.')}</span>
        </section>
      </div>
    </HelpTooltip>
  )
}

export function GeometryPreflightHelp() {
  const { t } = useI18n()

  return (
    <HelpTooltip
      label={t('About Geometry preflight evidence')}
      placement="bottom"
      align="start"
      width="guide"
    >
      <div className="help-tooltip__rich">
        <header>
          <strong>{t('How Geometry preflight evidence works')}</strong>
          <span>{t('Preflight combines synchronized resource metadata with optional topology diagnostics. It reports evidence for review and never modifies the Geometry.')}</span>
        </header>
        <dl>
          <div>
            <dt>{t('Baseline evidence')}</dt>
            <dd>{t('Checks processing state, physical units, bounding-box dimensions, surface inventory, generated naming, and metadata read errors.')}</dd>
          </div>
          <div>
            <dt>{t('Topology evidence')}</dt>
            <dd>{t('When diagnostics have run, quantized edge incidence, union-find connectivity, and BVH/SAT intersection tests provide tessellation topology evidence.')}</dd>
          </div>
          <div>
            <dt>{t('Decision levels')}</dt>
            <dd>{t('Blocked must be resolved before meshing; warning requires engineering review; unknown means evidence is missing; ready means that specific check passed.')}</dd>
          </div>
          <div>
            <dt>{t('Why unknown appears')}</dt>
            <dd>{t('The synchronized Geometry metadata may not contain topology results. Run diagnostics to calculate supported checks; unsupported checks remain unknown, not passed.')}</dd>
          </div>
        </dl>
        <section>
          <strong>{t('Diagnostic provenance')}</strong>
          <span>{t('The panel records the algorithm version, source, scale-relative tolerance, triangle count, runtime, and completion time for auditability.')}</span>
        </section>
        <section className="help-tooltip__caveat">
          <strong>{t('Limits')}</strong>
          <span>{t('Topology results describe the synchronized default-LOD tessellation, not exact CAD B-rep topology, and depend on tessellation quality and model scale.')}</span>
        </section>
      </div>
    </HelpTooltip>
  )
}

export function GeometryClipPopover({
  axis,
  position,
  onAxisChange,
  onPositionChange,
  onClose,
}: {
  axis: 'x' | 'y' | 'z'
  position: number
  onAxisChange: (axis: 'x' | 'y' | 'z') => void
  onPositionChange: (position: number) => void
  onClose: () => void
}) {
  return (
    <section className="geometry-clip-popover" role="dialog" aria-label="Inspection tools">
      <header>
        <strong><Scissors size={13} /> Inspection tools</strong>
        <button type="button" onClick={onClose} aria-label="Close inspection tools" title="Close inspection tools">
          <X size={13} />
        </button>
      </header>
      <div className="geometry-clip-controls">
        <label>Clip axis
          <select value={axis} onChange={(event) => onAxisChange(event.target.value as 'x' | 'y' | 'z')}>
            <option value="x">X plane</option>
            <option value="y">Y plane</option>
            <option value="z">Z plane</option>
          </select>
        </label>
        <label>Position
          <input
            aria-label="Geometry clipping plane position"
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={position}
            onChange={(event) => onPositionChange(Number(event.target.value))}
          />
        </label>
      </div>
    </section>
  )
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function GeometryAppearanceOptions({ appearances }: { appearances: GeometryAppearance[] }) {
  const general = appearances.filter(({ id }) => !isCfdGeometryAppearancePreset(id))
  const cfd = appearances.filter(({ id }) => isCfdGeometryAppearancePreset(id))
  return (
    <>
      {general.length > 0 && (
        <optgroup label="General display materials">
          {general.map((appearance) => (
            <option key={appearance.id} value={appearance.id}>{appearance.name}</option>
          ))}
        </optgroup>
      )}
      {cfd.length > 0 && (
        <optgroup label="CFD-inspired display presets">
          {cfd.map((appearance) => (
            <option key={appearance.id} value={appearance.id}>{appearance.name}</option>
          ))}
        </optgroup>
      )}
    </>
  )
}

export default function GeometryWorkspace({
  detail,
  resourceId,
  projectId,
  resourceRef,
  annotationsModel,
  geometryVersions,
  onCreateSemanticPlan,
  onCreateAdvancedPlan,
  onPlanSurfaceMesh,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  projectId: string
  resourceRef: ResourceRef
  annotationsModel: ProjectAnnotationsModel<JsonValue>
  geometryVersions: Array<{ id: string; name: string }>
  onCreateSemanticPlan: (draft: GeometrySemanticDraft) => Promise<void>
  onCreateAdvancedPlan: (
    report: GeometryDiagnosticReport,
    comparison: GeometryComparison | null,
    templateId: GeometryReviewTemplateId,
  ) => Promise<void>
  onPlanSurfaceMesh: () => Promise<void>
}) {
  const { t, language } = useI18n()
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({})
  const [entitySearch, setEntitySearch] = useState('')
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand | null>(null)
  const [viewerAssetStats, setViewerAssetStats] = useState<ViewerAssetStats | null>(null)
  const [clipEnabled, setClipEnabled] = useState(false)
  const [clipAxis, setClipAxis] = useState<'x' | 'y' | 'z'>('x')
  const [clipPosition, setClipPosition] = useState(0)
  const [showNormals, setShowNormals] = useState(false)
  const [captureRequest, setCaptureRequest] = useState(0)
  const [bodyIntent, setBodyIntent] = useState<GeometryBodyIntent>('undecided')
  const [selectedRole, setSelectedRole] = useState<GeometrySurfaceRole>('wall')
  const [assignments, setAssignments] = useState<Record<string, GeometrySemanticAssignment>>({})
  const [appearanceAssignments, setAppearanceAssignments] = useState<Record<string, string>>({})
  const [appearances, setAppearances] = useState(loadGeometryAppearanceLibrary)
  const [selectedAppearanceId, setSelectedAppearanceId] = useState('default-cad')
  const [assignmentHistory, setAssignmentHistory] = useState<Array<Record<string, GeometrySemanticAssignment>>>([])
  const [semanticMessage, setSemanticMessage] = useState('')
  const [semanticBusy, setSemanticBusy] = useState(false)
  const [diagnosticRatio, setDiagnosticRatio] = useState(0.1)
  const [curvatureAngle, setCurvatureAngle] = useState(30)
  const [diagnosticReport, setDiagnosticReport] = useState<GeometryDiagnosticReport | null>(null)
  const [diagnosticBusy, setDiagnosticBusy] = useState(false)
  const [diagnosticJob, setDiagnosticJob] = useState<GeometryDiagnosticJob | null>(null)
  const [diagnosticError, setDiagnosticError] = useState('')
  const [reviewTemplate, setReviewTemplate] = useState<GeometryReviewTemplateId>('aircraft')
  const [compareId, setCompareId] = useState('')
  const [comparison, setComparison] = useState<GeometryComparison | null>(null)
  const [comparisonBusy, setComparisonBusy] = useState(false)
  const [advancedPlanBusy, setAdvancedPlanBusy] = useState(false)
  const [pendingFocusEntityIds, setPendingFocusEntityIds] = useState<string[]>([])
  const [activeCapabilityPanel, setActiveCapabilityPanel] = useState<GeometryCapabilityPanel | null>(null)
  const diagnosticRunToken = useRef(0)
  const { manifest, state: viewerState } = useResourcePreview(
    detail ? 'Geometry' : null,
    resourceId ?? detail?.id ?? null,
  )
  const status = resourceStatus(detail)
  const review = useMemo(
    () => buildGeometryReview(detail, manifest, status, diagnosticReport),
    [detail, diagnosticReport, manifest, status],
  )
  const tools = useWorkspaceViewerTools({
    projectId,
    resourceRef,
    annotationsModel,
    unit: review.unit,
  })
  const selectedGroup = manifest?.groups.find((group) => group.id === viewerSelection.groupId) ?? null
  const selectedEdge = manifest?.edges?.find((edge) => edge.id === viewerSelection.groupId) ?? null
  const selectedGroupIds = viewerSelection.groupIds?.length
    ? viewerSelection.groupIds
    : selectedGroup ? [selectedGroup.id] : []
  const selectedGroups = manifest?.groups.filter((group) => selectedGroupIds.includes(group.id)) ?? []
  const selectedGroupIdSet = new Set(selectedGroupIds)
  const selectedEntityIds = selectedGroups.length > 0
    ? selectedGroups.map((group) => group.id)
    : selectedEdge ? [selectedEdge.id] : []
  const selectedEntitiesVisible = selectedEntityIds.every((id) => entityVisibility[id] !== false)
  const resourceKey = resourceId ?? detail?.id ?? ''
  const clipPlane = useMemo<ViewerClipPlane | null>(() => {
    if (!clipEnabled) return null
    const normal: [number, number, number] = clipAxis === 'x'
      ? [1, 0, 0]
      : clipAxis === 'y' ? [0, 1, 0] : [0, 0, 1]
    return { normal, constant: -clipPosition }
  }, [clipAxis, clipEnabled, clipPosition])
  const filteredGroups = useMemo(() => {
    const query = entitySearch.trim().toLowerCase()
    if (!query) return manifest?.groups ?? []
    return (manifest?.groups ?? []).filter((group) =>
      group.name.toLowerCase().includes(query) || group.id.toLowerCase().includes(query),
    )
  }, [entitySearch, manifest])
  const filteredEdges = useMemo(() => {
    const query = entitySearch.trim().toLowerCase()
    if (!query) return manifest?.edges ?? []
    return (manifest?.edges ?? []).filter((edge) =>
      edge.name.toLowerCase().includes(query) || edge.id.toLowerCase().includes(query),
    )
  }, [entitySearch, manifest])
  const entityIsVisible = (entityId: string) => entityVisibility[entityId] !== false
  const visibleFaceCount = manifest?.groups.filter((group) => entityIsVisible(group.id)).length ?? 0
  const visibleEdgeCount = manifest?.edges?.filter((edge) => entityIsVisible(edge.id)).length ?? 0
  const blockingCount = review.checks.filter((check) => check.level === 'blocked').length
  const warningCount = review.checks.filter((check) =>
    check.level === 'warning' || check.level === 'unknown',
  ).length
  const attentionChecks = review.checks.filter((check) => check.level !== 'ready')
  const passedChecks = review.checks.filter((check) => check.level === 'ready')
  const unavailableTopologyChecks = attentionChecks.filter((check) =>
    check.level === 'unknown' && topologyCheckKeys.has(check.key),
  )
  const visibleAttentionChecks = attentionChecks.filter((check) =>
    !(check.level === 'unknown' && topologyCheckKeys.has(check.key)),
  )
  const requestCamera = (type: ViewerCameraCommand['type']) => {
    setCameraCommand({ type, nonce: Date.now() })
  }
  const readiness = readinessCopy[review.readiness]
  const appearanceById = useMemo(
    () => new Map(appearances.map((appearance) => [appearance.id, appearance])),
    [appearances],
  )
  const defaultAppearance = appearanceById.get('default-cad') ?? appearances[0]
  const selectedAppearance = appearanceById.get(selectedAppearanceId) ?? defaultAppearance
  const selectedAppearanceIsPreset = isGeometryAppearancePreset(selectedAppearance?.id ?? '')
  const selectedAppearanceCanDelete = canDeleteGeometryAppearance(selectedAppearance?.id ?? '', appearances.length)
  const parameterBoundaryInventory = useMemo(
    () => buildSurfaceBoundaryInventory(manifest?.groups ?? [], detail?.simulation_params),
    [detail?.simulation_params, manifest?.groups],
  )
  const parameterAppearanceAssignments = useMemo(
    () => Object.fromEntries(parameterBoundaryInventory.flatMap((surface) => {
      if (surface.status !== 'assigned') return []
      const presetId = geometryAppearancePresetForBoundary(surface.assignments[0]?.modelType ?? '')
      return presetId ? [[surface.id, presetId]] : []
    })),
    [parameterBoundaryInventory],
  )
  const parameterSemanticAssignments = useMemo(
    () => Object.fromEntries(parameterBoundaryInventory.flatMap((surface) => {
      if (surface.status !== 'assigned') return []
      const assignment = surface.assignments[0]
      const role = geometrySurfaceRoleForBoundary(assignment?.modelType ?? '')
      return role ? [[surface.id, {
        groupId: surface.id,
        groupName: surface.name,
        role,
        provenance: 'provided' as const,
        reason: `Assigned by the active Flow360 ${assignment.modelType} boundary model.`,
      }]] : []
    })),
    [parameterBoundaryInventory],
  )
  const effectiveSemanticAssignments = useMemo(
    () => ({ ...assignments, ...parameterSemanticAssignments }),
    [assignments, parameterSemanticAssignments],
  )
  const assignmentList = Object.values(effectiveSemanticAssignments)
    .sort((a, b) => a.groupName.localeCompare(b.groupName))
  const unassignedCount = Math.max(0, (manifest?.groups.length ?? 0) - assignmentList.length)
  const semanticAppearanceAssignments = useMemo(
    () => Object.fromEntries(Object.values(assignments).flatMap((assignment) => {
      const presetId = geometryAppearancePresetForBoundary(assignment.role)
      return presetId ? [[assignment.groupId, presetId]] : []
    })),
    [assignments],
  )
  const effectiveAppearanceAssignments = useMemo(
    () => resolveGeometryAppearanceAssignments(
      parameterAppearanceAssignments,
      semanticAppearanceAssignments,
      appearanceAssignments,
    ),
    [appearanceAssignments, parameterAppearanceAssignments, semanticAppearanceAssignments],
  )
  const appearanceForGroup = (groupId: string) =>
    appearanceById.get(effectiveAppearanceAssignments[groupId]) ?? defaultAppearance
  const entityAppearances = useMemo(
    () => buildGeometryEntityAppearances(
      effectiveAppearanceAssignments,
      appearances,
      manifest?.groups.map((group) => group.id) ?? [],
      defaultAppearance?.id,
    ),
    [appearances, defaultAppearance?.id, effectiveAppearanceAssignments, manifest],
  )
  const selectedAppearanceNames = new Set(selectedGroups.map((group) => appearanceForGroup(group.id)?.name))
  const selectedSurfaceOverrideIds = selectedGroups.map((group) => appearanceAssignments[group.id])
  const selectedSurfaceOverrideIdSet = new Set(selectedSurfaceOverrideIds.filter(Boolean))
  const selectedSurfaceAppearanceId = selectedSurfaceOverrideIds.every((id) => !id)
    ? '__cfd_auto__'
    : selectedSurfaceOverrideIds.every(Boolean) && selectedSurfaceOverrideIdSet.size === 1
      ? [...selectedSurfaceOverrideIdSet][0]
      : '__mixed__'

  useEffect(() => {
    setViewerSelection({ groupId: null })
    setEntityVisibility({})
    setAssignments({})
    setAssignmentHistory([])
    setSemanticMessage('')
    setDiagnosticReport(null)
    setDiagnosticError('')
    setCompareId('')
    setComparison(null)
    setPendingFocusEntityIds([])
    setActiveCapabilityPanel(null)
    setAppearanceAssignments(resourceKey ? loadGeometryAppearanceAssignments(resourceKey) : {})
  }, [resourceKey])

  const setGeometryAppearanceAssignments = (next: Record<string, string>) => {
    setAppearanceAssignments(next)
    if (resourceKey) saveGeometryAppearanceAssignments(resourceKey, next)
  }

  const chooseGroups = (ids: string[]) => {
    setViewerSelection({ groupId: ids.at(-1) ?? null, groupIds: ids })
  }

  const toggleGroupSelection = (groupId: string, additive: boolean) => {
    if (!additive) {
      chooseGroups([groupId])
      return
    }
    chooseGroups(selectedGroupIds.includes(groupId)
      ? selectedGroupIds.filter((id) => id !== groupId)
      : [...selectedGroupIds, groupId])
  }

  const toggleEntityVisibility = (entityId: string) => {
    setEntityVisibility((current) => ({
      ...current,
      [entityId]: current[entityId] === false,
    }))
  }

  const setSelectedEntitiesVisible = (visible: boolean) => {
    if (selectedEntityIds.length === 0) return
    setEntityVisibility((current) => ({
      ...current,
      ...Object.fromEntries(selectedEntityIds.map((id) => [id, visible])),
    }))
  }

  const isolateSelectedEntities = () => {
    if (selectedEntityIds.length === 0) return
    const selected = new Set(selectedEntityIds)
    const allEntities = [...(manifest?.groups ?? []), ...(manifest?.edges ?? [])]
    setEntityVisibility(Object.fromEntries(allEntities.map(({ id }) => [id, selected.has(id)])))
  }

  const applyAppearanceToSelection = (appearanceId = selectedAppearanceId) => {
    if (selectedGroups.length === 0) return
    const next = { ...appearanceAssignments }
    for (const group of selectedGroups) next[group.id] = appearanceId
    setGeometryAppearanceAssignments(next)
  }

  const assignSurfaceMaterial = (appearanceId: string) => {
    if (appearanceId === '__cfd_auto__') {
      const next = clearGeometryAppearanceOverrides(appearanceAssignments, selectedGroups.map(({ id }) => id))
      setGeometryAppearanceAssignments(next)
      return
    }
    setSelectedAppearanceId(appearanceId)
    applyAppearanceToSelection(appearanceId)
  }

  const createAppearance = () => {
    const appearance = newGeometryAppearance('New display material', '#6f8790', 0.9)
    const next = [...appearances, appearance]
    setAppearances(next)
    saveGeometryAppearanceLibrary(next)
    setSelectedAppearanceId(appearance.id)
  }

  const updateSelectedAppearance = (patch: Partial<{ name: string; color: string; opacity: number }>) => {
    if (!selectedAppearance) return
    const next = appearances.map((item) => item.id === selectedAppearance.id
      ? { ...item, ...patch }
      : item)
    setAppearances(next)
    saveGeometryAppearanceLibrary(next)
  }

  const duplicateAppearance = () => {
    if (!selectedAppearance) return
    const appearance = newGeometryAppearance(
      `${selectedAppearance.name} copy`,
      selectedAppearance.color,
      selectedAppearance.opacity,
    )
    const next = [...appearances, appearance]
    setAppearances(next)
    saveGeometryAppearanceLibrary(next)
    setSelectedAppearanceId(appearance.id)
  }

  const deleteAppearance = () => {
    const current = appearances.find((item) => item.id === selectedAppearanceId)
    if (!current || !canDeleteGeometryAppearance(current.id, appearances.length)) return
    const nextLibrary = appearances.filter((item) => item.id !== current.id)
    const fallback = nextLibrary[0]
    const nextAssignments = Object.fromEntries(
      Object.entries(appearanceAssignments).map(([groupId, appearanceId]) => [
        groupId,
        appearanceId === current.id ? fallback.id : appearanceId,
      ]),
    )
    setAppearances(nextLibrary)
    saveGeometryAppearanceLibrary(nextLibrary)
    setGeometryAppearanceAssignments(nextAssignments)
    setSelectedAppearanceId(fallback.id)
  }

  const commitAssignments = (next: Record<string, GeometrySemanticAssignment>) => {
    setAssignmentHistory((history) => [...history.slice(-9), assignments])
    setAssignments(next)
    setSemanticMessage('')
  }

  const assignGroups = (
    groups: Array<{ id: string; name: string }>,
    role: GeometrySurfaceRole,
  ) => {
    if (groups.length === 0) return
    const next = { ...assignments }
    for (const group of groups) {
      next[group.id] = {
        groupId: group.id,
        groupName: group.name,
        role,
        provenance: 'provided',
        reason: 'Assigned by the user in Geometry review.',
      }
    }
    commitAssignments(next)
  }

  const undoAssignments = () => {
    setAssignmentHistory((history) => {
      const previous = history.at(-1)
      if (!previous) return history
      setAssignments(previous)
      setSemanticMessage('Restored the previous semantic draft.')
      return history.slice(0, -1)
    })
  }

  const applySuggestions = () => {
    const suggestions = suggestGeometrySemantics(manifest?.groups ?? [])
    if (suggestions.length === 0) {
      setSemanticMessage('No high-confidence name-based suggestions are available. Assign roles manually or rename CAD groups.')
      return
    }
    const next = { ...assignments }
    for (const assignment of suggestions) {
      if (!next[assignment.groupId]) next[assignment.groupId] = assignment
    }
    commitAssignments(next)
    setSemanticMessage(`${suggestions.length} name-based suggestion(s) added for review.`)
  }

  const createSemanticPlan = async () => {
    setSemanticBusy(true)
    setSemanticMessage('')
    try {
      await onCreateSemanticPlan({ bodyIntent, assignments: assignmentList })
    } catch (cause) {
      setSemanticMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSemanticBusy(false)
    }
  }

  const focusDiagnostic = (entityIds: string[]) => {
    const target = manifest?.groups.find((group) =>
      entityIds.includes(group.id) || entityIds.includes(group.name),
    )
    if (!target) {
      if (manifest) {
        setDiagnosticError('The affected entity is not present in the rendered surface inventory.')
      } else {
        setPendingFocusEntityIds(entityIds)
        setDiagnosticError('Waiting for the synchronized 3D surface inventory before locating this finding.')
      }
      return
    }
    setPendingFocusEntityIds([])
    setViewerSelection({ groupId: target.id })
    requestCamera('fit-selection')
  }

  useEffect(() => {
    if (pendingFocusEntityIds.length === 0 || !manifest) return
    const target = manifest.groups.find((group) =>
      pendingFocusEntityIds.includes(group.id) || pendingFocusEntityIds.includes(group.name),
    )
    if (!target) {
      setPendingFocusEntityIds([])
      setDiagnosticError('The affected entity is not present in the rendered surface inventory.')
      return
    }
    setViewerSelection({ groupId: target.id })
    setCameraCommand({ type: 'fit-selection', nonce: Date.now() })
    setPendingFocusEntityIds([])
    setDiagnosticError('')
  }, [manifest, pendingFocusEntityIds])

  useEffect(() => {
    diagnosticRunToken.current += 1
    setDiagnosticBusy(false)
    setDiagnosticJob(null)
    setDiagnosticReport(null)
    if (!resourceId) return
    let cancelled = false
    void api.latestGeometryDiagnosticsJob(resourceId)
      .then((job) => {
        if (!cancelled && job?.report) {
          setDiagnosticJob(job)
          setDiagnosticReport(job.report)
        }
      })
      .catch((cause) => {
        if (!cancelled) setDiagnosticError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => { cancelled = true }
  }, [resourceId])

  const runDiagnostics = async () => {
    if (!resourceId) return
    const runToken = ++diagnosticRunToken.current
    setDiagnosticBusy(true)
    setDiagnosticJob(null)
    setDiagnosticError('')
    try {
      let job = await api.startGeometryDiagnostics(resourceId, diagnosticRatio, curvatureAngle)
      if (runToken !== diagnosticRunToken.current) return
      setDiagnosticJob(job)
      while (job.status === 'queued' || job.status === 'running') {
        await new Promise((resolve) => window.setTimeout(resolve, 350))
        if (runToken !== diagnosticRunToken.current) return
        job = await api.geometryDiagnosticsJob(resourceId, job.id)
        setDiagnosticJob(job)
      }
      if (job.status === 'completed' && job.report) {
        setDiagnosticReport(job.report)
      } else if (job.status === 'failed') {
        throw new Error(job.error || 'Geometry diagnostics failed')
      }
    } catch (cause) {
      setDiagnosticReport(null)
      setDiagnosticError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (runToken === diagnosticRunToken.current) setDiagnosticBusy(false)
    }
  }

  const cancelDiagnostics = async () => {
    if (!resourceId || !diagnosticJob || !diagnosticBusy) return
    diagnosticRunToken.current += 1
    setDiagnosticBusy(false)
    try {
      setDiagnosticJob(await api.cancelGeometryDiagnostics(resourceId, diagnosticJob.id))
    } catch (cause) {
      setDiagnosticError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const runComparison = async () => {
    if (!resourceId || !compareId) return
    setComparisonBusy(true)
    setDiagnosticError('')
    try {
      setComparison(await api.compareGeometries(resourceId, compareId))
    } catch (cause) {
      setComparison(null)
      setDiagnosticError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setComparisonBusy(false)
    }
  }

  const createAdvancedPlan = async () => {
    if (!diagnosticReport) return
    setAdvancedPlanBusy(true)
    setDiagnosticError('')
    try {
      await onCreateAdvancedPlan(diagnosticReport, comparison, reviewTemplate)
    } catch (cause) {
      setDiagnosticError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setAdvancedPlanBusy(false)
    }
  }

  return (
    <section className={`geometry-workspace geometry-review-workspace ${activeCapabilityPanel ? 'geometry-capability-open' : ''}`}>
      <aside className="geometry-entity-panel">
        <div className="geometry-panel-heading">
          <div><span>MODEL</span><strong>Geometry inventory</strong></div>
          <span className="geometry-count-badge">
            {(manifest?.groups.length ?? 0) + (manifest?.edges?.length ?? 0)}
          </span>
        </div>
        <label className="geometry-entity-search">
          <Search size={13} />
          <input
            value={entitySearch}
            onChange={(event) => setEntitySearch(event.target.value)}
            placeholder="Search faces and edges…"
            aria-label="Search geometry entities"
          />
        </label>
        <div className="geometry-selection-tools">
          <strong>{`${selectedGroups.length} ${selectedGroups.length === 1 ? 'face' : 'faces'} selected`}</strong>
          <button type="button" onClick={() => chooseGroups(filteredGroups.map((group) => group.id))}>
            Select filtered
          </button>
          <button type="button" disabled={selectedGroupIds.length === 0} onClick={() => chooseGroups([])}>Clear</button>
        </div>
        <div className="geometry-entity-tree">
          <ManifestMemberGroup
            label="Geometry bodies"
            memberLabel="surfaces"
            icon={<Box size={13} aria-hidden="true" />}
            total={manifest?.groups.length ?? 0}
            visibleCount={visibleFaceCount}
            onHideAll={() => setEntityVisibility((current) => ({
              ...current,
              ...manifestVisibilityMap(manifest?.groups ?? [], false),
            }))}
            onShowAll={() => setEntityVisibility((current) => ({
              ...current,
              ...manifestVisibilityMap(manifest?.groups ?? [], true),
            }))}
          >
            {filteredGroups.map((group) => {
              const visible = entityIsVisible(group.id)
              return (
              <div
                data-entity-id={group.id}
                className={`geometry-entity-row ${selectedGroupIdSet.has(group.id) ? 'selected' : ''} ${visible ? '' : 'hidden'}`}
                key={group.id}
              >
                <button
                  type="button"
                  className="geometry-entity-select"
                  onClick={(event) => toggleGroupSelection(
                    group.id,
                    event.ctrlKey || event.metaKey || event.shiftKey,
                  )}
                  title="Select; Ctrl, Cmd, or Shift-click to add/remove"
                >
                  <span
                    className="viewer-color-swatch"
                    style={{ background: entityAppearances[group.id]?.color ?? group.color }}
                  />
                  <span className="geometry-face-name">
                    <span>{group.name}</span>
                    <small title={`Display material: ${appearanceForGroup(group.id)?.name ?? 'Default CAD'}`}>
                      {appearanceForGroup(group.id)?.name ?? 'Default CAD'}
                    </small>
                  </span>
                  <small className={effectiveSemanticAssignments[group.id] ? 'assigned' : ''}>
                    {effectiveSemanticAssignments[group.id]
                      ? effectiveSemanticAssignments[group.id].role
                      : group.triangles !== undefined ? `${group.triangles} tris` : 'unassigned'}
                  </small>
                </button>
                <button
                  type="button"
                  className="geometry-entity-visibility"
                  aria-label={`${visible ? 'Hide' : 'Show'} surface ${group.name}`}
                  aria-pressed={visible}
                  title={`${visible ? 'Hide' : 'Show'} surface`}
                  onClick={() => toggleEntityVisibility(group.id)}
                >
                  {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
              )
            })}
          </ManifestMemberGroup>
          <ManifestMemberGroup
            label="CAD edges"
            memberLabel="edges"
            icon={<Shapes size={13} aria-hidden="true" />}
            total={manifest?.edges?.length ?? 0}
            visibleCount={visibleEdgeCount}
            onHideAll={() => setEntityVisibility((current) => ({
              ...current,
              ...manifestVisibilityMap(manifest?.edges ?? [], false),
            }))}
            onShowAll={() => setEntityVisibility((current) => ({
              ...current,
              ...manifestVisibilityMap(manifest?.edges ?? [], true),
            }))}
          >
            {filteredEdges.map((edge) => {
              const visible = entityIsVisible(edge.id)
              return (
              <div
                className={`geometry-entity-row ${viewerSelection.groupId === edge.id ? 'selected' : ''} ${visible ? '' : 'hidden'}`}
                data-entity-id={edge.id}
                key={edge.id}
              >
                <button
                  type="button"
                  className="geometry-entity-select"
                  onClick={() => setViewerSelection({ groupId: edge.id })}
                  title="Select edge"
                >
                  <span className="geometry-edge-mark" />
                  <span>{edge.name}</span>
                  <small>{edge.segments !== undefined ? `${edge.segments} segs` : 'edge'}</small>
                </button>
                <button
                  type="button"
                  className="geometry-entity-visibility"
                  aria-label={`${visible ? 'Hide' : 'Show'} edge ${edge.name}`}
                  aria-pressed={visible}
                  title={`${visible ? 'Hide' : 'Show'} edge`}
                  onClick={() => toggleEntityVisibility(edge.id)}
                >
                  {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
              )
            })}
          </ManifestMemberGroup>
          {filteredGroups.length === 0 && filteredEdges.length === 0 && (
            <div className="geometry-empty-list">{`No geometry entities match “${entitySearch}”.`}</div>
          )}
        </div>
        {review.groupsAreAutogenerated && (
          <div className="geometry-semantic-warning">
            <AlertTriangle size={14} />
            <span><strong>Unclassified CAD faces</strong>Names are generated and need CFD semantics.</span>
          </div>
        )}
      </aside>

      <div className="viewer-section geometry-review-viewer">
        <LazyViewer3D
          manifest={manifest}
          state={viewerState}
          selection={viewerSelection}
          onSelectionChange={setViewerSelection}
          entityVisibility={entityVisibility}
          onEntityVisibilityChange={setEntityVisibility}
          entityAppearances={entityAppearances}
          clipPlane={clipPlane}
          projectId={projectId}
          resourceRef={resourceRef}
          toolInput={tools.toolInput}
          overlays={tools.overlays}
          onDoubleClick={tools.onDoubleClick}
          captureRequest={captureRequest}
          onCapture={(dataUrl) => downloadDataUrl(
            dataUrl,
            `${detail?.id ?? resourceId ?? 'geometry'}-review.png`,
          )}
          showNormals={showNormals}
          showEntityLegend={false}
          showFieldPanel={false}
          cameraCommand={cameraCommand}
          onAssetStatsChange={setViewerAssetStats}
          floatingPanel={clipEnabled && (
            <GeometryClipPopover
              axis={clipAxis}
              position={clipPosition}
              onAxisChange={setClipAxis}
              onPositionChange={setClipPosition}
              onClose={() => setClipEnabled(false)}
            />
          )}
          topToolbar={(
              <div className="geometry-camera-toolbar" aria-label="Geometry actions">
                <button
                  className={clipEnabled ? 'active' : ''}
                  aria-pressed={clipEnabled}
                  onClick={() => setClipEnabled((enabled) => !enabled)}
                  title="Toggle clipping plane"
                ><Scissors size={13} /> Clip</button>
                <ViewerToolsDock model={tools} />
                <button
                  className={showNormals ? 'active' : ''}
                  aria-pressed={showNormals}
                  onClick={() => setShowNormals((visible) => !visible)}
                  title="Toggle vertex normals"
                ><ScanLine size={13} /> Normals</button>
                <button onClick={() => setCaptureRequest((value) => value + 1)} title="Export PNG">
                  <Camera size={13} /> PNG
                </button>
              </div>
          )}
        />
        <ViewerToolPanel model={tools} />
      </div>

      <aside className="geometry-review-panel">
        <div className={`geometry-readiness-card ${review.readiness}`}>
          <div className="geometry-panel-heading">
            <div><span>GEOMETRY PREFLIGHT</span><strong>{readiness.label}</strong></div>
            {review.readiness === 'ready'
              ? <CheckCircle2 size={20} />
              : review.readiness === 'blocked'
                ? <XCircle size={20} />
                : <AlertTriangle size={20} />}
          </div>
          <p>{readiness.detail}</p>
          <div className="geometry-readiness-counts">
            <button
              type="button"
              className="blocked"
              disabled={blockingCount === 0}
              onClick={() => setActiveCapabilityPanel('health')}
            >{blockingCount} blockers</button>
            <button
              type="button"
              className="warning"
              disabled={warningCount === 0}
              onClick={() => setActiveCapabilityPanel('health')}
              aria-label={`Review ${warningCount} Geometry warnings or unknown checks`}
            >{warningCount} warnings / unknown</button>
          </div>
        </div>

        <ViewerAssetInformation stats={viewerAssetStats} />

        <div className="geometry-summary-grid">
          <div className="geometry-summary-wide"><span><Ruler size={12} /> Dimensions</span><strong>
            {review.dimensions
              ? review.dimensions.map(formatGeometryNumber).join(' × ')
              : 'Not reported'}
            {review.dimensions && review.unit ? ` ${review.unit}` : ''}
          </strong></div>
          <div><span><Box size={12} /> Vertices</span><strong>{manifest?.vertices?.toLocaleString() ?? '—'}</strong></div>
          <div><span><Ruler size={12} /> Diagonal</span><strong>
            {review.diagonal === null
              ? '—'
              : `${formatGeometryNumber(review.diagonal)}${review.unit ? ` ${review.unit}` : ''}`}
          </strong></div>
        </div>

        <section className="geometry-selection-card">
          <div className="geometry-section-title"><Info size={13} /> Selection properties</div>
          {selectedGroups.length > 1 ? (
            <dl>
              <div><dt>Type</dt><dd>Face selection</dd></div>
              <div><dt>Selected</dt><dd>{selectedGroups.length} faces</dd></div>
              <div><dt>Triangles</dt><dd>{selectedGroups.reduce((sum, group) => sum + (group.triangles ?? 0), 0).toLocaleString()}</dd></div>
              <div><dt>Display material</dt><dd>
                {selectedAppearanceNames.size === 1
                  ? [...selectedAppearanceNames][0]
                  : `${selectedAppearanceNames.size} materials`}
              </dd></div>
            </dl>
          ) : selectedGroup ? (
            <dl>
              <div><dt>Name</dt><dd>{selectedGroup.name}</dd></div>
              <div><dt>ID</dt><dd title={selectedGroup.id}>{selectedGroup.id}</dd></div>
              <div><dt>Triangles</dt><dd>{selectedGroup.triangles?.toLocaleString() ?? 'Not reported'}</dd></div>
              <div><dt>Vertices</dt><dd>{selectedGroup.vertices?.toLocaleString() ?? 'Not reported'}</dd></div>
              <div><dt>Display material</dt><dd>{appearanceForGroup(selectedGroup.id)?.name ?? 'Default CAD'}</dd></div>
              <div><dt>CFD semantics</dt><dd>
                {assignments[selectedGroup.id]
                  ? `${assignments[selectedGroup.id].role} · ${assignments[selectedGroup.id].provenance}`
                  : 'Unassigned'}
              </dd></div>
            </dl>
          ) : selectedEdge ? (
            <dl>
              <div><dt>Type</dt><dd>Edge</dd></div>
              <div><dt>Name</dt><dd>{selectedEdge.name}</dd></div>
              <div><dt>ID</dt><dd title={selectedEdge.id}>{selectedEdge.id}</dd></div>
              <div><dt>Segments</dt><dd>{selectedEdge.segments?.toLocaleString() ?? 'Not reported'}</dd></div>
            </dl>
          ) : (
            <p>Select a face or edge in the viewer or model tree to inspect it.</p>
          )}
          {selectedEntityIds.length > 0 && (
            <div className="geometry-selection-actions" aria-label="Selection actions">
              <button type="button" onClick={() => requestCamera('fit-selection')}>
                <LocateFixed size={12} /> Focus
              </button>
              <button type="button" onClick={isolateSelectedEntities}>
                <ScanLine size={12} /> Isolate
              </button>
              <button type="button" onClick={() => setSelectedEntitiesVisible(!selectedEntitiesVisible)}>
                {selectedEntitiesVisible ? <EyeOff size={12} /> : <Eye size={12} />}
                {selectedEntitiesVisible ? 'Hide' : 'Show'}
              </button>
              <button type="button" onClick={() => setEntityVisibility({})}>
                <Eye size={12} /> Show all
              </button>
              {selectedGroups.length > 0 && (
                <>
                  <button type="button" onClick={() => setActiveCapabilityPanel('appearance')}>
                    <Palette size={12} /> Material
                  </button>
                  <button type="button" onClick={() => setActiveCapabilityPanel('semantics')}>
                    <Sparkles size={12} /> CFD role
                  </button>
                </>
              )}
              <button type="button" onClick={() => chooseGroups([])}>
                <X size={12} /> Clear
              </button>
            </div>
          )}
          {selectedGroups.length > 0 && (
            <label className="geometry-selection-material">
              Surface material
              <select
                aria-label="Surface material for selected faces"
                value={selectedSurfaceAppearanceId}
                onChange={(event) => assignSurfaceMaterial(event.target.value)}
              >
                {selectedSurfaceAppearanceId === '__mixed__' && (
                  <option value="__mixed__" disabled>Mixed materials</option>
                )}
                <option value="__cfd_auto__">
                  Follow CFD semantics{selectedAppearanceNames.size === 1 ? ` · ${[...selectedAppearanceNames][0]}` : ''}
                </option>
                <GeometryAppearanceOptions appearances={appearances} />
              </select>
            </label>
          )}
        </section>

        <div className="geometry-capability-launchers" aria-label="Geometry review tools">
          <button type="button" onClick={() => setActiveCapabilityPanel('appearance')}>
            <Palette size={14} /><span><strong>Display material</strong><small>Visual appearance</small></span>
          </button>
          <button type="button" onClick={() => setActiveCapabilityPanel('semantics')}>
            <Sparkles size={14} /><span><strong>CFD semantics</strong><small>{assignmentList.length}/{manifest?.groups.length ?? 0} assigned</small></span>
          </button>
          <button type="button" onClick={() => setActiveCapabilityPanel('diagnostics')}>
            <GitCompare size={14} /><span><strong>Diagnostics</strong><small>{diagnosticReport ? `${diagnosticReport.findings.length} findings` : 'On demand'}</small></span>
          </button>
          <button type="button" onClick={() => setActiveCapabilityPanel('health')}>
            <Shapes size={14} /><span><strong>Preflight evidence</strong><small>{diagnosticReport?.topology ? (blockingCount ? `${blockingCount} blockers` : `${warningCount} to review`) : 'Topology not evaluated'}</small></span>
          </button>
        </div>

        {activeCapabilityPanel === 'appearance' && (
          <GeometryCapabilityDialog
            title="Display material"
            subtitle="Visual appearance only · shared across projects"
            icon={<Palette size={17} />}
            onClose={() => setActiveCapabilityPanel(null)}
          >
          <div className="geometry-disclosure-content">
            <div className="geometry-panel-intent">
              <strong>How the model looks</strong>
              <span>3D appearance follows current CFD roles by default. Choosing a material here creates a visual override; it does not change SimulationParams.</span>
            </div>
            <label className="geometry-semantic-field">
              Display material
              <select value={selectedAppearanceId} onChange={(event) => setSelectedAppearanceId(event.target.value)}>
                <GeometryAppearanceOptions appearances={appearances} />
              </select>
            </label>
            <label className="geometry-semantic-field">
              Name
              <input
                value={selectedAppearance?.name ?? ''}
                onChange={(event) => updateSelectedAppearance({ name: event.target.value })}
              />
            </label>
            <div className="geometry-appearance-fields">
              <label>Color<input aria-label="Appearance color" type="color" value={selectedAppearance?.color ?? '#6f8790'} onInput={(event) => updateSelectedAppearance({ color: event.currentTarget.value })} /></label>
              <label>Opacity <strong>{Math.round((selectedAppearance?.opacity ?? 0.9) * 100)}%</strong><input aria-label="Appearance opacity" type="range" min="0.05" max="1" step="0.05" value={selectedAppearance?.opacity ?? 0.9} onInput={(event) => updateSelectedAppearance({ opacity: Number(event.currentTarget.value) })} /></label>
            </div>
            <button
              type="button"
              className="geometry-appearance-assign"
              disabled={selectedGroups.length === 0}
              onClick={() => applyAppearanceToSelection()}
            >
              {`Override selected surfaces (${selectedGroups.length})`}
            </button>
            <div className="geometry-appearance-actions">
              <button type="button" onClick={createAppearance}><Plus size={11} /> New</button>
              <button type="button" onClick={duplicateAppearance}>Duplicate</button>
              <button
                type="button"
                disabled={!selectedAppearanceCanDelete}
                onClick={deleteAppearance}
                title={selectedAppearanceIsPreset ? 'System presets cannot be deleted. Duplicate it to create a custom material.' : 'Delete custom display material'}
              ><Trash2 size={11} /> Delete</button>
            </div>
            <small className="geometry-semantic-safety">
              {selectedAppearanceIsPreset ? 'Protected system preset. ' : 'Custom display material. '}
              Shared across projects · Material ID: {selectedAppearance?.id}. Names are editable labels; Surface links use the stable ID.
            </small>
          </div>
          </GeometryCapabilityDialog>
        )}

        {activeCapabilityPanel === 'semantics' && (
          <GeometryCapabilityDialog
            title="CFD semantic draft"
            subtitle={`Solver roles · ${assignmentList.length}/${manifest?.groups.length ?? 0} assigned`}
            icon={<Sparkles size={17} />}
            onClose={() => setActiveCapabilityPanel(null)}
          >
          <div className="geometry-disclosure-content">
          <div className="geometry-panel-intent">
            <strong>What the surface means physically</strong>
            <span>This is the physical source of truth. Wall, Farfield, Inflow and other roles automatically drive 3D display presets unless a surface has a visual override.</span>
          </div>
          <div className="geometry-semantic-progress">
            <span>{assignmentList.length} assigned</span>
            <span>{unassignedCount} unassigned</span>
          </div>
          <label className="geometry-semantic-field">
            Workflow intent
            <select value={bodyIntent} onChange={(event) => setBodyIntent(event.target.value as GeometryBodyIntent)}>
              <option value="undecided">Undecided</option>
              <option value="external-aerodynamics">External aerodynamics</option>
              <option value="internal-flow">Internal flow</option>
              <option value="rotating-machinery">Rotating machinery</option>
              <option value="conjugate-heat-transfer">Conjugate heat transfer</option>
            </select>
          </label>
          <label className="geometry-semantic-field">
            Surface role
            <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as GeometrySurfaceRole)}>
              {geometrySurfaceRoles.map((role) => (
                <option key={role.value} value={role.value}>{role.label}</option>
              ))}
            </select>
          </label>
          <div className="geometry-semantic-actions">
            <button
              type="button"
              disabled={selectedGroups.length === 0}
              onClick={() => assignGroups(selectedGroups, selectedRole)}
            >{`Assign selected (${selectedGroups.length})`}</button>
            <button
              type="button"
              disabled={filteredGroups.length === 0}
              onClick={() => assignGroups(filteredGroups, selectedRole)}
            >{`Assign filtered (${filteredGroups.length})`}</button>
            <button type="button" onClick={applySuggestions}><Sparkles size={11} /> Suggest</button>
            <button type="button" disabled={assignmentHistory.length === 0} onClick={undoAssignments}><Undo2 size={11} /> Undo</button>
          </div>
          {assignmentList.length > 0 && (
            <div className="geometry-semantic-diff">
              <strong>Draft changes</strong>
              {assignmentList.slice(0, 6).map((assignment) => (
                <div key={assignment.groupId}>
                  <span title={assignment.groupName}>{assignment.groupName}</span>
                  <small className={assignment.provenance}>{assignment.role} · {assignment.provenance}</small>
                </div>
              ))}
              {assignmentList.length > 6 && <small>+{assignmentList.length - 6} more assignments</small>}
            </div>
          )}
          {semanticMessage && <p className="geometry-semantic-message">{semanticMessage}</p>}
          <button
            type="button"
            className="geometry-semantic-plan"
            disabled={semanticBusy || assignmentList.length === 0 || bodyIntent === 'undecided'}
            onClick={() => void createSemanticPlan()}
          >
            <GitPullRequestDraft size={13} /> {semanticBusy ? 'Creating Draft review…' : 'Create AI Draft review'}
          </button>
          <small className="geometry-semantic-safety">Creates a Draft review and preflight; no mesh or solver run is started.</small>
          </div>
          </GeometryCapabilityDialog>
        )}

        {activeCapabilityPanel === 'diagnostics' && (
          <GeometryCapabilityDialog
            title={t('Advanced diagnostics')}
            subtitle={diagnosticReport
              ? translatedCount(t, '{count} findings', diagnosticReport.findings.length)
              : t('Server-backed · on demand')}
            icon={<GitCompare size={17} />}
            titleHelp={<AdvancedDiagnosticsHelp />}
            onClose={() => setActiveCapabilityPanel(null)}
          >
          <div className="geometry-disclosure-content geometry-advanced-diagnostics">
          <p className="geometry-advanced-intro">{t('Server-backed evidence only. Unsupported checks remain explicitly unknown.')}</p>
          <label className="geometry-semantic-field">
            {t('Small-surface threshold ratio')}
            <select
              aria-label="Small-surface threshold ratio"
              value={diagnosticRatio}
              onChange={(event) => {
                setDiagnosticRatio(Number(event.target.value))
                setDiagnosticReport(null)
              }}
            >
              <option value={0.05}>{t('5% of median surface evidence')}</option>
              <option value={0.1}>{t('10% of median surface evidence')}</option>
              <option value={0.2}>{t('20% of median surface evidence')}</option>
            </select>
          </label>
          <label className="geometry-semantic-field">
            {t('Face-normal variation threshold')}
            <select
              aria-label="Face-normal variation threshold"
              value={curvatureAngle}
              onChange={(event) => {
                setCurvatureAngle(Number(event.target.value))
                setDiagnosticReport(null)
              }}
            >
              <option value={15}>{t('15° sensitive')}</option>
              <option value={30}>{t('30° balanced')}</option>
              <option value={45}>{t('45° coarse')}</option>
              <option value={60}>{t('60° very coarse')}</option>
            </select>
          </label>
          <button
            type="button"
            className="geometry-diagnostic-run"
            disabled={diagnosticBusy || !resourceId}
            onClick={() => void runDiagnostics()}
          >
            <ScanLine size={12} /> {diagnosticBusy ? t('Analyzing synchronized evidence…') : t('Run advanced diagnostics')}
          </button>
          {diagnosticBusy && diagnosticJob && (
            <div className="geometry-diagnostic-progress" role="status" aria-live="polite">
              <div>
                <span>{t(diagnosticJob.stage.replaceAll('-', ' '))}</span>
                <strong>{diagnosticJob.progress}%</strong>
              </div>
              <progress max={100} value={diagnosticJob.progress} />
              <button type="button" onClick={() => void cancelDiagnostics()}>{t('Cancel analysis')}</button>
            </div>
          )}
          {!diagnosticBusy && diagnosticJob?.status === 'cancelled' && (
            <small className="geometry-diagnostic-cancelled">{t('Diagnostic analysis cancelled.')}</small>
          )}

          {diagnosticReport && (
            <>
              <div className="geometry-capabilities">
                {diagnosticReport.capabilities.map((capability) => {
                  const localized = localizeDiagnosticCapability(capability, t)
                  return (
                    <div className={capability.status} key={capability.key} title={localized.detail}>
                      <span>{localized.label}</span>
                      <strong>{localized.status}</strong>
                    </div>
                  )
                })}
              </div>
              <small className="geometry-diagnostic-fingerprint" title={diagnosticReport.fingerprint}>
                {t('Evidence cache key ·')} {diagnosticReport.fingerprint.slice(0, 12)}
              </small>
              <div className="geometry-diagnostic-findings">
                {diagnosticReport.findings.map((finding) => {
                  const localized = localizeDiagnosticFinding(finding, t)
                  const entityCount = finding.entity_ids?.length ?? 0
                  return (
                    <article className={finding.severity} key={finding.id}>
                      <div>
                        <strong>{localized.title}</strong>
                        <small>{localized.detail}</small>
                      </div>
                      {entityCount > 0 && (
                        <button type="button" onClick={() => focusDiagnostic(finding.entity_ids ?? [])}>
                          <LocateFixed size={11} /> {translatedCount(t, 'Locate {count}', entityCount)}
                        </button>
                      )}
                      {localized.recommendation && <p>{localized.recommendation}</p>}
                    </article>
                  )
                })}
              </div>
              {diagnosticReport.grouping_proposals.length > 0 && (
                <div className="geometry-grouping-proposals">
                  <strong>{t('Semi-automatic groups')}</strong>
                  {diagnosticReport.grouping_proposals.map((proposal) => (
                    <button
                      type="button"
                      key={proposal.id}
                      title={t(proposal.basis)}
                      onClick={() => focusDiagnostic(proposal.entity_ids)}
                    >
                      <span>{proposal.label}</span>
                      <small>{translatedCount(t, '{count} surfaces · review inferred group', proposal.entity_ids.length)}</small>
                    </button>
                  ))}
                </div>
              )}

              <label className="geometry-semantic-field">
                {t('Domain review template')}
                <select
                  aria-label="Domain review template"
                  value={reviewTemplate}
                  onChange={(event) => setReviewTemplate(event.target.value as GeometryReviewTemplateId)}
                >
                  {geometryReviewTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{t(template.label)}</option>
                  ))}
                </select>
              </label>
              <div className="geometry-template-checks">
                {geometryReviewTemplates.find((template) => template.id === reviewTemplate)?.checks.map((check) => (
                  <span key={check}>{t(check)}</span>
                ))}
              </div>

              {geometryVersions.length > 1 && (
                <div className="geometry-version-compare">
                  <label className="geometry-semantic-field">
                    {t('Compare with Geometry')}
                    <select
                      aria-label="Compare with Geometry"
                      value={compareId}
                      onChange={(event) => {
                        setCompareId(event.target.value)
                        setComparison(null)
                      }}
                    >
                      <option value="">{t('Select synchronized version…')}</option>
                      {geometryVersions.filter((version) => version.id !== resourceId).map((version) => (
                        <option key={version.id} value={version.id}>{version.name}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" disabled={!compareId || comparisonBusy} onClick={() => void runComparison()}>
                    <GitCompare size={11} /> {comparisonBusy ? t('Comparing…') : t('Compare versions')}
                  </button>
                  {comparison && (
                    <div className="geometry-comparison-metrics">
                      {comparison.metrics.map((metric) => (
                        <div key={metric.key}>
                          <span>{t(metric.label)}</span>
                          <strong>{metric.baseline.toLocaleString()} → {metric.candidate.toLocaleString()}</strong>
                          <small className={metric.delta === 0 ? '' : metric.delta > 0 ? 'added' : 'removed'}>
                            {metric.delta > 0 ? '+' : ''}{metric.delta.toLocaleString()}
                          </small>
                        </div>
                      ))}
                      <p>{t('{added} added · {removed} removed named surfaces')
                        .replace('{added}', comparison.added_surfaces.length.toLocaleString())
                        .replace('{removed}', comparison.removed_surfaces.length.toLocaleString())}</p>
                    </div>
                  )}
                </div>
              )}
              <button
                type="button"
                className="geometry-semantic-plan"
                disabled={advancedPlanBusy}
                onClick={() => void createAdvancedPlan()}
              >
                <GitPullRequestDraft size={13} /> {advancedPlanBusy ? t('Creating advanced Draft review…') : t('Create advanced Draft review')}
              </button>
            </>
          )}
          {diagnosticError && <p className="geometry-semantic-message">{diagnosticError}</p>}
          </div>
          </GeometryCapabilityDialog>
        )}

        {activeCapabilityPanel === 'health' && (
          <GeometryCapabilityDialog
            title={t('Geometry preflight evidence')}
            subtitle={blockingCount
              ? t('{blockers} blockers · {warnings} warnings or unknown')
                .replace('{blockers}', blockingCount.toLocaleString())
                .replace('{warnings}', warningCount.toLocaleString())
              : translatedCount(t, '{count} warnings or unknown to review', warningCount)}
            icon={<Shapes size={17} />}
            titleHelp={<GeometryPreflightHelp />}
            onClose={() => setActiveCapabilityPanel(null)}
          >
          <div className="geometry-disclosure-content geometry-preflight-evidence">
          <div className="geometry-panel-intent">
            <strong>{translatedCount(t, 'Why preflight reports {count} warnings or unknown', warningCount)}</strong>
            <span>{t('Each item states its evidence. Unknown means no diagnostic result exists; it is never silently treated as passed.')}</span>
          </div>
          <div className="geometry-health-group-title">
            <div className="geometry-health-group-title__label">
              <strong>{t('Needs review')}</strong>
            </div>
            <span>{translatedCount(t, '{count} checks', visibleAttentionChecks.length + (unavailableTopologyChecks.length > 0 ? 1 : 0))}</span>
          </div>
          <div className="geometry-checks">
            {unavailableTopologyChecks.length > 0 && (
              <div className="unknown geometry-topology-unavailable">
                <CheckIcon level="unknown" />
                <span>
                  <strong>{t('Topology health not evaluated')}</strong>
                  <small>{translatedCount(t, '{count} checks unavailable · Run diagnostics to inspect the synchronized UVF tessellation.', unavailableTopologyChecks.length)}</small>
                </span>
                <button type="button" disabled={diagnosticBusy || !resourceId} onClick={() => void runDiagnostics()}>
                  <ScanLine size={11} /> {diagnosticBusy ? t('Running…') : t('Run topology diagnostics')}
                </button>
              </div>
            )}
            {visibleAttentionChecks.map((check) => {
              const localized = localizePreflightCheck(t, check)
              return (
                <div className={check.level} key={check.key} title={localized.detail}>
                  <CheckIcon level={check.level} />
                  <span><strong>{localized.label}</strong><small>{localized.detail}</small></span>
                  {check.entityIds && check.entityIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => focusDiagnostic(check.entityIds ?? [])}
                      title={t('Focus the first affected surface')}
                    ><LocateFixed size={11} /> {t('Locate')}</button>
                  )}
                </div>
              )
            })}
          </div>
          {diagnosticBusy && diagnosticJob && (
            <div className="geometry-diagnostic-progress" role="status" aria-live="polite">
              <div><span>{t(diagnosticJob.stage.replaceAll('-', ' '))}</span><strong>{diagnosticJob.progress}%</strong></div>
              <progress max={100} value={diagnosticJob.progress} />
              <button type="button" onClick={() => void cancelDiagnostics()}>{t('Cancel analysis')}</button>
            </div>
          )}
          {diagnosticReport?.topology && (
            <div className="geometry-topology-provenance">
              <strong>{t('Diagnostic provenance')}</strong>
              <dl>
                <div><dt>{t('Algorithm')}</dt><dd>{diagnosticReport.topology.algorithm_version}</dd></div>
                <div><dt>{t('Source')}</dt><dd>{t(diagnosticReport.topology.source)}</dd></div>
                <div><dt>{t('Tolerance')}</dt><dd>{diagnosticReport.topology.tolerance.toExponential(3)} · {t('Bounding-box diagonal × topology tolerance ratio')}</dd></div>
                <div><dt>{t('Mesh')}</dt><dd>{t('{triangles} triangles · {duration} ms')
                  .replace('{triangles}', diagnosticReport.topology.triangle_count.toLocaleString(language))
                  .replace('{duration}', diagnosticReport.topology.duration_ms.toLocaleString(language))}</dd></div>
                <div><dt>{t('Completed')}</dt><dd>{new Date(diagnosticReport.topology.completed_at).toLocaleString(language)}</dd></div>
              </dl>
              {diagnosticReport.topology.limitations.map((limitation) => <small key={limitation}>{t(limitation)}</small>)}
              <button type="button" disabled={diagnosticBusy || !resourceId} onClick={() => void runDiagnostics()}>
                <ScanLine size={11} /> {t('Run topology diagnostics again')}
              </button>
            </div>
          )}
          {passedChecks.length > 0 && (
            <details className="geometry-health-passed">
              <summary>{translatedCount(t, 'Passed evidence · {count}', passedChecks.length)}</summary>
              <div className="geometry-checks">
                {passedChecks.map((check) => {
                  const localized = localizePreflightCheck(t, check)
                  return (
                    <div className={check.level} key={check.key} title={localized.detail}>
                      <CheckIcon level={check.level} />
                      <span><strong>{localized.label}</strong><small>{localized.detail}</small></span>
                    </div>
                  )
                })}
              </div>
            </details>
          )}
          </div>
          </GeometryCapabilityDialog>
        )}

        <ResourceCreateDraftAction onCreate={onPlanSurfaceMesh} />
      </aside>
    </section>
  )
}
