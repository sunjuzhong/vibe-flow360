import {
  AlertTriangle,
  Box,
  Camera,
  CheckCircle2,
  CircleHelp,
  Focus,
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
  View,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type GeometryComparison,
  type GeometryDiagnosticJob,
  type GeometryDiagnosticReport,
  type ResourceDetail,
} from '../api/client'
import {
  geometryReviewTemplates,
  type GeometryReviewTemplateId,
} from '../lib/geometryAdvanced'
import {
  buildGeometryReview,
  formatGeometryNumber,
  type GeometryCheckLevel,
} from '../lib/geometryReview'
import {
  geometrySurfaceRoles,
  suggestGeometrySemantics,
  type GeometryBodyIntent,
  type GeometrySemanticAssignment,
  type GeometrySemanticDraft,
  type GeometrySurfaceRole,
} from '../lib/geometrySemantics'
import { resourceStatus } from './ResourceDetailPanel'
import {
  buildGeometryEntityAppearances,
  isCfdGeometryAppearancePreset,
  loadGeometryAppearanceAssignments,
  loadGeometryAppearanceLibrary,
  newGeometryAppearance,
  saveGeometryAppearanceAssignments,
  saveGeometryAppearanceLibrary,
  type GeometryAppearance,
} from '../lib/geometryAppearances'
import {
  LazyViewer3D,
  type ViewerCameraCommand,
  type ViewerClipPlane,
  type ViewerSelection,
} from './viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import type { ProjectAnnotationsModel } from '../hooks/useProjectAnnotations'
import { useWorkspaceViewerTools } from '../hooks/useWorkspaceViewerTools'
import { ViewerToolPanel, ViewerToolsDock } from '../lib/viewer-tools/ViewerToolsUI'
import type { JsonValue, ResourceRef } from '../lib/viewer-tools/types'

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
        <optgroup label="CFD boundary display presets">
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
  onPlanSurfaceMesh: () => void
}) {
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({})
  const [entitySearch, setEntitySearch] = useState('')
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand | null>(null)
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
  const diagnosticRunToken = useRef(0)
  const { manifest, state: viewerState } = useResourcePreview(
    detail ? 'Geometry' : null,
    resourceId ?? detail?.id ?? null,
  )
  const status = resourceStatus(detail)
  const review = useMemo(
    () => buildGeometryReview(detail, manifest, status),
    [detail, manifest, status],
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
  const requestCamera = (type: ViewerCameraCommand['type']) => {
    setCameraCommand({ type, nonce: Date.now() })
  }
  const readiness = readinessCopy[review.readiness]
  const assignmentList = Object.values(assignments).sort((a, b) => a.groupName.localeCompare(b.groupName))
  const unassignedCount = Math.max(0, (manifest?.groups.length ?? 0) - assignmentList.length)
  const appearanceById = useMemo(
    () => new Map(appearances.map((appearance) => [appearance.id, appearance])),
    [appearances],
  )
  const defaultAppearance = appearanceById.get('default-cad') ?? appearances[0]
  const selectedAppearance = appearanceById.get(selectedAppearanceId) ?? defaultAppearance
  const appearanceForGroup = (groupId: string) =>
    appearanceById.get(appearanceAssignments[groupId]) ?? defaultAppearance
  const entityAppearances = useMemo(
    () => buildGeometryEntityAppearances(
      appearanceAssignments,
      appearances,
      manifest?.groups.map((group) => group.id) ?? [],
      defaultAppearance?.id,
    ),
    [appearanceAssignments, appearances, defaultAppearance?.id, manifest],
  )
  const selectedAppearanceNames = new Set(selectedGroups.map((group) => appearanceForGroup(group.id)?.name))
  const selectedSurfaceAppearanceIds = new Set(
    selectedGroups.map((group) => appearanceForGroup(group.id)?.id).filter(Boolean),
  )
  const selectedSurfaceAppearanceId = selectedSurfaceAppearanceIds.size === 1
    ? [...selectedSurfaceAppearanceIds][0]
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

  const applyAppearanceToSelection = (appearanceId = selectedAppearanceId) => {
    if (selectedGroups.length === 0) return
    const next = { ...appearanceAssignments }
    for (const group of selectedGroups) next[group.id] = appearanceId
    setGeometryAppearanceAssignments(next)
  }

  const assignSurfaceMaterial = (appearanceId: string) => {
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
    if (!current || appearances.length <= 1) return
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
    <section className="geometry-workspace geometry-review-workspace">
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
          <strong>{selectedGroups.length} face{selectedGroups.length === 1 ? '' : 's'} selected</strong>
          <button type="button" onClick={() => chooseGroups(filteredGroups.map((group) => group.id))}>
            Select filtered
          </button>
          <button type="button" disabled={selectedGroupIds.length === 0} onClick={() => chooseGroups([])}>Clear</button>
        </div>
        <div className="geometry-entity-tree">
          <div className="geometry-tree-root">
            <Box size={13} />
            <strong>Geometry bodies</strong>
            <span>{visibleFaceCount}/{manifest?.groups.length ?? 0} visible</span>
          </div>
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
                <small className={assignments[group.id] ? 'assigned' : ''}>
                  {assignments[group.id]
                    ? assignments[group.id].role
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
          <div className="geometry-tree-root geometry-edge-root">
            <Shapes size={13} />
            <strong>CAD edges</strong>
            <span>{visibleEdgeCount}/{manifest?.edges?.length ?? 0} visible</span>
          </div>
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
          {filteredGroups.length === 0 && filteredEdges.length === 0 && (
            <div className="geometry-empty-list">No geometry entities match “{entitySearch}”.</div>
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
          toolbar={(
            <div className="geometry-camera-toolbar" aria-label="Geometry camera controls">
              <button onClick={() => requestCamera('fit')} title="Fit all"><Focus size={13} /> Fit</button>
              <button
                onClick={() => requestCamera('fit-selection')}
                disabled={!viewerSelection.groupId}
                title="Fit selected surface"
              >
                <View size={13} /> Selection
              </button>
              <span />
              <button onClick={() => requestCamera('x')} title="View from positive X">X</button>
              <button onClick={() => requestCamera('y')} title="View from positive Y">Y</button>
              <button onClick={() => requestCamera('z')} title="View from positive Z">Z</button>
              <button onClick={() => requestCamera('iso')} title="Isometric view">ISO</button>
              <span />
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
            <span className="blocked">{blockingCount} blockers</span>
            <span className="warning">{warningCount} warnings / unknown</span>
          </div>
        </div>

        <div className="geometry-summary-grid">
          <div><span><Ruler size={12} /> Dimensions</span><strong>
            {review.dimensions
              ? review.dimensions.map(formatGeometryNumber).join(' × ')
              : 'Not reported'}
            {review.dimensions && review.unit ? ` ${review.unit}` : ''}
          </strong></div>
          <div><span><Shapes size={12} /> Surfaces</span><strong>{manifest?.groups.length ?? '—'}</strong></div>
          <div><span><Box size={12} /> Vertices</span><strong>{manifest?.vertices?.toLocaleString() ?? '—'}</strong></div>
          <div><span><Ruler size={12} /> Diagonal</span><strong>
            {review.diagonal === null
              ? '—'
              : `${formatGeometryNumber(review.diagonal)}${review.unit ? ` ${review.unit}` : ''}`}
          </strong></div>
        </div>

        {clipEnabled && (
          <section className="geometry-inspection-card">
            <div className="geometry-section-title"><Ruler size={13} /> Inspection tools</div>
            {clipEnabled && (
              <div className="geometry-clip-controls">
                <label>Clip axis
                  <select value={clipAxis} onChange={(event) => setClipAxis(event.target.value as 'x' | 'y' | 'z')}>
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
                    value={clipPosition}
                    onChange={(event) => setClipPosition(Number(event.target.value))}
                  />
                </label>
              </div>
            )}
          </section>
        )}

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
                <GeometryAppearanceOptions appearances={appearances} />
              </select>
            </label>
          )}
        </section>

        <details className="geometry-appearance-card geometry-disclosure-card" open>
          <summary>
            <span><Palette size={13} /> Display material</span>
            <small>Shared across projects</small>
          </summary>
          <div className="geometry-disclosure-content">
            <label className="geometry-semantic-field">
              Material record
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
              Apply material to selected ({selectedGroups.length})
            </button>
            <div className="geometry-appearance-actions">
              <button type="button" onClick={createAppearance}><Plus size={11} /> New</button>
              <button type="button" onClick={duplicateAppearance}>Duplicate</button>
              <button type="button" disabled={appearances.length <= 1} onClick={deleteAppearance}><Trash2 size={11} /> Delete</button>
            </div>
            <small className="geometry-semantic-safety">
              Visual display only; CFD boundary semantics are assigned separately below. Material ID: {selectedAppearance?.id}.
              Names are editable labels; Surface links use the stable ID.
            </small>
          </div>
        </details>

        <details className="geometry-semantics-card geometry-disclosure-card">
          <summary>
            <span><Sparkles size={13} /> CFD semantic draft</span>
            <small>{assignmentList.length}/{manifest?.groups.length ?? 0} assigned</small>
          </summary>
          <div className="geometry-disclosure-content">
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
            >Assign selected ({selectedGroups.length})</button>
            <button
              type="button"
              disabled={filteredGroups.length === 0}
              onClick={() => assignGroups(filteredGroups, selectedRole)}
            >Assign filtered ({filteredGroups.length})</button>
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
            <GitPullRequestDraft size={13} /> {semanticBusy ? 'Creating review plan…' : 'Create AI review plan'}
          </button>
          <small className="geometry-semantic-safety">Creates a local plan and preflight; no remote resource is changed.</small>
          </div>
        </details>

        <details className="geometry-advanced-card geometry-disclosure-card">
          <summary>
            <span><GitCompare size={13} /> Advanced diagnostics</span>
            <small>{diagnosticReport ? `${diagnosticReport.findings.length} findings` : 'On demand'}</small>
          </summary>
          <div className="geometry-disclosure-content">
          <p className="geometry-advanced-intro">Server-backed evidence only. Unsupported checks remain explicitly unknown.</p>
          <label className="geometry-semantic-field">
            Small-surface threshold ratio
            <select
              aria-label="Small-surface threshold ratio"
              value={diagnosticRatio}
              onChange={(event) => {
                setDiagnosticRatio(Number(event.target.value))
                setDiagnosticReport(null)
              }}
            >
              <option value={0.05}>5% of median surface evidence</option>
              <option value={0.1}>10% of median surface evidence</option>
              <option value={0.2}>20% of median surface evidence</option>
            </select>
          </label>
          <label className="geometry-semantic-field">
            Face-normal variation threshold
            <select
              aria-label="Face-normal variation threshold"
              value={curvatureAngle}
              onChange={(event) => {
                setCurvatureAngle(Number(event.target.value))
                setDiagnosticReport(null)
              }}
            >
              <option value={15}>15° sensitive</option>
              <option value={30}>30° balanced</option>
              <option value={45}>45° coarse</option>
              <option value={60}>60° very coarse</option>
            </select>
          </label>
          <button
            type="button"
            className="geometry-diagnostic-run"
            disabled={diagnosticBusy || !resourceId}
            onClick={() => void runDiagnostics()}
          >
            <ScanLine size={12} /> {diagnosticBusy ? 'Analyzing synchronized evidence…' : 'Run advanced diagnostics'}
          </button>
          {diagnosticBusy && diagnosticJob && (
            <div className="geometry-diagnostic-progress" role="status" aria-live="polite">
              <div>
                <span>{diagnosticJob.stage.replaceAll('-', ' ')}</span>
                <strong>{diagnosticJob.progress}%</strong>
              </div>
              <progress max={100} value={diagnosticJob.progress} />
              <button type="button" onClick={() => void cancelDiagnostics()}>Cancel analysis</button>
            </div>
          )}
          {!diagnosticBusy && diagnosticJob?.status === 'cancelled' && (
            <small className="geometry-diagnostic-cancelled">Diagnostic analysis cancelled.</small>
          )}

          {diagnosticReport && (
            <>
              <div className="geometry-capabilities">
                {diagnosticReport.capabilities.map((capability) => (
                  <div className={capability.status} key={capability.key} title={capability.detail}>
                    <span>{capability.key.replaceAll('-', ' ')}</span>
                    <strong>{capability.status}</strong>
                  </div>
                ))}
              </div>
              <small className="geometry-diagnostic-fingerprint" title={diagnosticReport.fingerprint}>
                Evidence cache key · {diagnosticReport.fingerprint.slice(0, 12)}
              </small>
              <div className="geometry-diagnostic-findings">
                {diagnosticReport.findings.map((finding) => (
                  <article className={finding.severity} key={finding.id}>
                    <div>
                      <strong>{finding.title}</strong>
                      <small>{finding.detail}</small>
                    </div>
                    {(finding.entity_ids?.length ?? 0) > 0 && (
                      <button type="button" onClick={() => focusDiagnostic(finding.entity_ids ?? [])}>
                        <LocateFixed size={11} /> Locate {finding.entity_ids?.length}
                      </button>
                    )}
                    {finding.recommendation && <p>{finding.recommendation}</p>}
                  </article>
                ))}
              </div>
              {diagnosticReport.grouping_proposals.length > 0 && (
                <div className="geometry-grouping-proposals">
                  <strong>Semi-automatic groups</strong>
                  {diagnosticReport.grouping_proposals.map((proposal) => (
                    <button
                      type="button"
                      key={proposal.id}
                      title={proposal.basis}
                      onClick={() => focusDiagnostic(proposal.entity_ids)}
                    >
                      <span>{proposal.label}</span>
                      <small>{proposal.entity_ids.length} surfaces · review inferred group</small>
                    </button>
                  ))}
                </div>
              )}

              <label className="geometry-semantic-field">
                Domain review template
                <select
                  aria-label="Domain review template"
                  value={reviewTemplate}
                  onChange={(event) => setReviewTemplate(event.target.value as GeometryReviewTemplateId)}
                >
                  {geometryReviewTemplates.map((template) => (
                    <option key={template.id} value={template.id}>{template.label}</option>
                  ))}
                </select>
              </label>
              <div className="geometry-template-checks">
                {geometryReviewTemplates.find((template) => template.id === reviewTemplate)?.checks.map((check) => (
                  <span key={check}>{check}</span>
                ))}
              </div>

              {geometryVersions.length > 1 && (
                <div className="geometry-version-compare">
                  <label className="geometry-semantic-field">
                    Compare with Geometry
                    <select
                      aria-label="Compare with Geometry"
                      value={compareId}
                      onChange={(event) => {
                        setCompareId(event.target.value)
                        setComparison(null)
                      }}
                    >
                      <option value="">Select synchronized version…</option>
                      {geometryVersions.filter((version) => version.id !== resourceId).map((version) => (
                        <option key={version.id} value={version.id}>{version.name}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" disabled={!compareId || comparisonBusy} onClick={() => void runComparison()}>
                    <GitCompare size={11} /> {comparisonBusy ? 'Comparing…' : 'Compare versions'}
                  </button>
                  {comparison && (
                    <div className="geometry-comparison-metrics">
                      {comparison.metrics.map((metric) => (
                        <div key={metric.key}>
                          <span>{metric.label}</span>
                          <strong>{metric.baseline.toLocaleString()} → {metric.candidate.toLocaleString()}</strong>
                          <small className={metric.delta === 0 ? '' : metric.delta > 0 ? 'added' : 'removed'}>
                            {metric.delta > 0 ? '+' : ''}{metric.delta.toLocaleString()}
                          </small>
                        </div>
                      ))}
                      <p>{comparison.added_surfaces.length} added · {comparison.removed_surfaces.length} removed named surfaces</p>
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
                <GitPullRequestDraft size={13} /> {advancedPlanBusy ? 'Creating advanced review…' : 'Create advanced review plan'}
              </button>
            </>
          )}
          {diagnosticError && <p className="geometry-semantic-message">{diagnosticError}</p>}
          </div>
        </details>

        <details className="geometry-health-card geometry-disclosure-card">
          <summary>
            <span><Shapes size={13} /> Geometry health evidence</span>
            <small>{blockingCount ? `${blockingCount} blockers` : `${warningCount} to review`}</small>
          </summary>
          <div className="geometry-disclosure-content">
          <div className="geometry-checks">
            {review.checks.map((check) => (
              <div className={check.level} key={check.key} title={check.detail}>
                <CheckIcon level={check.level} />
                <span><strong>{check.label}</strong><small>{check.detail}</small></span>
                {check.entityIds && check.entityIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => focusDiagnostic(check.entityIds ?? [])}
                    title="Focus the first affected surface"
                  ><LocateFixed size={11} /> Locate</button>
                )}
              </div>
            ))}
          </div>
          </div>
        </details>

        <button
          className="geometry-plan-action"
          onClick={onPlanSurfaceMesh}
          disabled={review.readiness === 'blocked'}
          title={review.readiness === 'blocked' ? 'Resolve Geometry blockers before planning the Surface Mesh' : ''}
        >
          <GitPullRequestDraft size={15} />
          {review.readiness === 'blocked' ? 'Resolve blockers first' : 'Plan Surface Mesh'}
        </button>
      </aside>
    </section>
  )
}
