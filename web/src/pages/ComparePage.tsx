import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Box,
  BookmarkPlus,
  FileDown,
  CheckCircle2,
  Download,
  FileOutput,
  GitCompare,
  GitPullRequestDraft,
  LibraryBig,
  Pencil,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import {
  api,
  type CaseComparison,
  type CompareWorkspace,
  type CompareWorkspaceParticipant,
  type CompareWorkspaceViewState,
  type CompareResult,
  type Flow360Status,
  type ProjectInfo,
  type ProjectItem,
  type ProjectRecord,
  type SweepResult,
} from '../api/client'
import Flow360IdLink from '../components/Flow360IdLink'
import JsonPreview from '../components/JsonPreview'
import { ResultFileComparisonDialog } from '../components/ResultFileComparisonDialog'
import TopBar from '../components/TopBar'
import { CaseVisualizationSelectionCard } from '../components/CaseVisualizationSelectionCard'
import { LazyViewer3D, type MeshGroupData, type ViewerCameraCommand, type ViewerCameraState, type ViewerSelection } from '../components/viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import { useI18n } from '../i18n'
import type { UVFEntityInfo } from '../lib/uvf-three'

type CompareView = 'evidence' | 'visual' | 'files' | 'parameters' | 'sweep'
export type CompareCaseOption = ProjectItem & { projectId: string; projectName: string }

function valueText(value: unknown) {
  if (value === undefined) return '—'
  if (value === null) return 'Removed'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

type JsonExpansionState = Record<string, boolean>

export function CompareParameterValue({ value, expansion, onExpansionChange }: {
  value: unknown
  expansion?: Readonly<JsonExpansionState>
  onExpansionChange?: (path: string, open: boolean) => void
}) {
  if (value !== null && typeof value === 'object') {
    return <JsonPreview value={value} className="compare-json-preview" expansion={expansion} onExpansionChange={onExpansionChange} />
  }
  return <span className="compare-scalar-value">{valueText(value)}</span>
}

function CompareParameterDiffRow({ diff, expansion, onExpansionChange }: {
  diff: CompareResult['diffs'][number]
  expansion: JsonExpansionState
  onExpansionChange: (path: string, open: boolean) => void
}) {
  return (
    <div className="compare-diff-row">
      <code>{diff.path}<small>{diff.compared_to}</small></code>
      <div className="compare-diff-value"><CompareParameterValue value={diff.baseline} expansion={expansion} onExpansionChange={onExpansionChange} /></div>
      <div className="compare-diff-value"><CompareParameterValue value={diff.other} expansion={expansion} onExpansionChange={onExpansionChange} /></div>
    </div>
  )
}

function formatBytes(value?: number) {
  if (!value) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
}

export function toggleCaseSelection(selectedIds: string[], id: string) {
  return selectedIds.includes(id)
    ? selectedIds.filter((selected) => selected !== id)
    : [...selectedIds, id]
}

export function mergeCompareCaseOptions(current: CompareCaseOption[], external: CompareCaseOption[]) {
  return [...current, ...external].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
}

export function buildCompareParticipants(result: CompareResult, options: CompareCaseOption[], fallbackProject: { id: string; name?: string }) {
  return result.cases.map((item) => {
    const option = options.find((candidate) => candidate.id === item.id)
    return {
      project_id: option?.projectId ?? fallbackProject.id,
      project_name_snapshot: option?.projectName ?? fallbackProject.name,
      case_id: item.id,
      case_name_snapshot: item.name,
    }
  })
}

export function compareEvidenceRevisions(previous: CompareResult | undefined, current: CompareResult) {
  if (!previous) return null
  const previousCases = new Map(previous.cases.map((item) => [item.id, item]))
  let statusChanges = 0
  let kpiChanges = 0
  let artifactChanges = 0
  for (const item of current.cases) {
    const before = previousCases.get(item.id)
    if (!before) { statusChanges++; artifactChanges += item.artifacts?.length ?? 0; continue }
    if (before.status !== item.status || before.convergence?.status !== item.convergence?.status) statusChanges++
    const priorKPIs = new Map((before.kpis ?? []).map((kpi) => [kpi.name, kpi.value]))
    kpiChanges += (item.kpis ?? []).filter((kpi) => priorKPIs.get(kpi.name) !== kpi.value).length
    const priorArtifacts = new Set((before.artifacts ?? []).map((artifact) => artifact.path))
    const currentArtifacts = new Set((item.artifacts ?? []).map((artifact) => artifact.path))
    artifactChanges += [...priorArtifacts].filter((path) => !currentArtifacts.has(path)).length + [...currentArtifacts].filter((path) => !priorArtifacts.has(path)).length
  }
  return { statusChanges, kpiChanges, artifactChanges, parameterDiffChange: current.diffs.length - previous.diffs.length }
}

function markdownText(value: string) { return value.replaceAll('|', '\\|').replaceAll('\n', ' ') }

export function buildCompareWorkspaceReport(workspace: CompareWorkspace, revisionId?: string) {
  const revision = workspace.revisions?.find((item) => item.id === revisionId) ?? workspace.revisions?.at(-1)
  if (!revision) return ''
  const participants = revision.participants?.length ? revision.participants : workspace.participants
  const sessions = workspace.ai_sessions?.filter((session) => session.evidence_revision_id === revision.id) ?? []
  const lines = [`# ${workspace.name}`, '', `Evidence revision: ${revision.number} (${revision.created_at})`, '', '## Participants', '', '| Role | Project | Case |', '| --- | --- | --- |']
  participants.forEach((item) => lines.push(`| ${item.role} | ${markdownText(item.project_name_snapshot || item.project_id)} | ${markdownText(item.case_name_snapshot)} |`))
  lines.push('', '## Revision history', '')
  workspace.revisions?.forEach((item) => lines.push(`- Revision ${item.number} — ${item.created_at}; Cases: ${item.snapshot.cases.map((entry) => markdownText(entry.name)).join(', ')}`))
  lines.push('', '## Evidence summary', '')
  revision.snapshot.cases.forEach((item) => lines.push(`- **${markdownText(item.name)}** — status: ${item.status}; convergence: ${item.convergence?.status ?? 'unknown'}; KPIs: ${(item.kpis ?? []).map((kpi) => `${kpi.name}=${kpi.value}`).join(', ') || 'none'}; artifacts: ${item.artifacts?.length ?? 0}`))
  lines.push('', `## Parameter differences (${revision.snapshot.diffs.length})`, '')
  revision.snapshot.diffs.forEach((diff) => lines.push(`- \`${diff.path}\` (${diff.compared_to ?? 'candidate'})`))
  lines.push('', '## AI analysis history', '')
  if (!sessions.length) lines.push('No AI analysis was saved for this evidence revision.')
  sessions.forEach((session, index) => lines.push(`### Analysis ${index + 1}`, '', session.question ? `Question: ${session.question}` : 'General comparison analysis', '', session.analysis, ''))
  return lines.join('\n')
}

export function parseSweepValues(input: string) {
  return input
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))
}

export function buildArtifactMatrix(cases: CaseComparison[]) {
  const paths = [...new Set(cases.flatMap((item) => (item.artifacts ?? []).map((artifact) => artifact.path)))].sort()
  return paths.map((path) => ({
    path,
    category: cases.flatMap((item) => item.artifacts ?? []).find((artifact) => artifact.path === path)?.category ?? 'other',
    byCase: Object.fromEntries(cases.map((item) => [item.id, (item.artifacts ?? []).find((artifact) => artifact.path === path)])),
  }))
}

export type CompareManifestItemKey = Pick<MeshGroupData, 'id' | 'name' | 'path'>
type CompareManifestAction = {
  nonce: number
  type: 'isolate' | 'visibility' | 'show-all'
  item?: CompareManifestItemKey
  visible?: boolean
}

function normalizedManifestItemText(value: string) {
  return value.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '')
}

export function matchCompareManifestItem(groups: MeshGroupData[], selected: CompareManifestItemKey): MeshGroupData | null {
  const exact = groups.find((group) => group.id === selected.id)
  if (exact) return exact
  const selectedPath = [...(selected.path ?? []), selected.name].map(normalizedManifestItemText).join('/')
  const byPath = groups.find((group) => (
    [...(group.path ?? []), group.name].map(normalizedManifestItemText).join('/') === selectedPath
  ))
  if (byPath) return byPath
  const normalizedName = normalizedManifestItemText(selected.name)
  return groups.find((group) => normalizedManifestItemText(group.name) === normalizedName) ?? null
}

function fieldsForCompareItem(entities: UVFEntityInfo[], item: MeshGroupData | null) {
  if (!item) return []
  return entities.find((entity) => entity.id === item.id)?.fields ?? []
}

function CompareViewport({ item, projectId, availability = 'available', selectedField, onSelectedFieldChange, fieldVisualizationEnabled, onFieldVisualizationChange, wireframe, onWireframeChange, cameraCommand, onCameraCommand, cameraState, onCameraStateChange, linkedSelection, onLinkedSelectionChange, manifestAction, onManifestAction, savedVisibility, onVisibilityStateChange }: {
  item: CaseComparison
  projectId: string
  availability?: CompareWorkspaceParticipant['availability']
  selectedField: string | null
  onSelectedFieldChange: (field: string | null) => void
  fieldVisualizationEnabled: boolean
  onFieldVisualizationChange: (enabled: boolean) => void
  wireframe: boolean
  onWireframeChange: (wireframe: boolean) => void
  cameraCommand: ViewerCameraCommand | null
  onCameraCommand: (command: ViewerCameraCommand) => void
  cameraState: ViewerCameraState | null
  onCameraStateChange: (state: ViewerCameraState) => void
  linkedSelection: { sourceId: string; item: CompareManifestItemKey | null } | null
  onLinkedSelectionChange: (sourceId: string, item: CompareManifestItemKey | null) => void
  manifestAction: CompareManifestAction | null
  onManifestAction: (action: CompareManifestAction) => void
  savedVisibility?: Record<string, boolean>
  onVisibilityStateChange: (caseId: string, visibility: Record<string, boolean>) => void
}) {
  const { t } = useI18n()
  const { manifest, state, source } = useResourcePreview(availability === 'available' ? 'Case' : null, availability === 'available' ? item.id : null)
  const groups = useMemo(() => manifest?.groups ?? [], [manifest])
  const [selection, setSelection] = useState<ViewerSelection>({ groupId: null })
  const [entities, setEntities] = useState<UVFEntityInfo[]>([])
  const [entityVisibility, setEntityVisibility] = useState<Record<string, boolean>>({})
  const selectedItem = groups.find((group) => group.id === selection.groupId) ?? null
  const selectedFieldNames = fieldsForCompareItem(entities, selectedItem)
  const selectedVisible = selectedItem ? entityVisibility[selectedItem.id] ?? selectedItem.visible : false
  const linkedMatchMissing = Boolean(linkedSelection?.item && linkedSelection.sourceId !== item.id && !selectedItem)

  useEffect(() => {
    setEntityVisibility({ ...Object.fromEntries(groups.map((group) => [group.id, group.visible])), ...savedVisibility })
    setSelection({ groupId: null })
  }, [manifest?.asset_url])

  const updateVisibility = (next: Record<string, boolean>) => {
    setEntityVisibility(next)
    onVisibilityStateChange(item.id, next)
  }

  useEffect(() => {
    if (!linkedSelection) return
    const matched = linkedSelection.item ? matchCompareManifestItem(groups, linkedSelection.item) : null
    setSelection({ groupId: matched?.id ?? null })
  }, [groups, linkedSelection])

  useEffect(() => {
    if (!manifestAction) return
    if (manifestAction.type === 'show-all') {
      updateVisibility(Object.fromEntries(groups.map((group) => [group.id, true])))
      return
    }
    if (!manifestAction.item) return
    const matched = matchCompareManifestItem(groups, manifestAction.item)
    if (!matched) return
    if (manifestAction.type === 'isolate') {
      updateVisibility(Object.fromEntries(groups.map((group) => [group.id, group.id === matched.id])))
    } else if (manifestAction.type === 'visibility') {
      updateVisibility({ ...entityVisibility, [matched.id]: Boolean(manifestAction.visible) })
    }
  }, [groups, manifestAction])

  const selectItem = (next: MeshGroupData | null) => {
    setSelection({ groupId: next?.id ?? null })
    onLinkedSelectionChange(item.id, next)
  }

  const handleViewerSelection = (next: ViewerSelection) => {
    const selected = groups.find((group) => group.id === next.groupId) ?? null
    setSelection(next)
    onLinkedSelectionChange(item.id, selected)
  }

  return (
    <article className="compare-viewport-card">
      <header>
        <div><span>{item.name}</span><small>{item.id}</small></div>
        <strong>{source === 'fallback' ? t('Context only') : source === 'primary' ? t('Case result asset') : t('Loading')}</strong>
      </header>
      <label className="compare-manifest-picker">
        <span>{t('Manifest item')}</span>
        <select value={selectedItem?.id ?? ''} onChange={(event) => selectItem(groups.find((group) => group.id === event.target.value) ?? null)}>
          <option value="">{t('Select an item')}</option>
          {groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
        </select>
      </label>
      <div className="compare-viewport">
        {availability === 'available' ? <LazyViewer3D
          manifest={manifest}
          state={state}
          selection={selection}
          onSelectionChange={handleViewerSelection}
          entityVisibility={entityVisibility}
          onEntityVisibilityChange={updateVisibility}
          onEntitiesDiscovered={setEntities}
          selectedField={fieldVisualizationEnabled ? selectedField : null}
          onSelectedFieldChange={onSelectedFieldChange}
          fieldNames={selectedFieldNames}
          fieldEntityIds={selectedItem ? [selectedItem.id] : []}
          showFieldPanel={fieldVisualizationEnabled && selectedFieldNames.length > 0}
          wireframe={wireframe}
          onWireframeChange={onWireframeChange}
          cameraCommand={cameraCommand}
          cameraState={cameraState}
          onCameraStateChange={onCameraStateChange}
          projectId={projectId}
          showWarnings={false}
          showEntityLegend={false}
        /> : <div className="compare-snapshot-only"><AlertCircle size={18} /><strong>{t('Saved evidence only')}</strong><span>{t('The original Case is unavailable. Parameters, KPIs, artifact metadata, and AI history remain available from the saved snapshot.')}</span></div>}
      </div>
      {linkedMatchMissing && (
        <div className="compare-manifest-missing" role="status"><AlertCircle size={13} />{t('No matching manifest item in this Case.')}</div>
      )}
      {selectedItem && (
        <div className="compare-selection-card-wrap">
          <CaseVisualizationSelectionCard
            items={[{ ...selectedItem, typeLabel: selectedItem.entity_type || t('Visualization object'), entityIds: [selectedItem.id] }]}
            visible={selectedVisible}
            fieldNames={selectedFieldNames}
            fieldVisualizationEnabled={fieldVisualizationEnabled}
            activeField={selectedFieldNames.includes(selectedField ?? '') ? selectedField : null}
            onFocus={() => onCameraCommand({ type: 'fit-selection', nonce: Date.now() })}
            onIsolate={() => onManifestAction({ type: 'isolate', item: selectedItem, nonce: Date.now() })}
            onToggleVisibility={() => onManifestAction({ type: 'visibility', item: selectedItem, visible: !selectedVisible, nonce: Date.now() })}
            onShowAll={() => onManifestAction({ type: 'show-all', nonce: Date.now() })}
            onClear={() => selectItem(null)}
            onFieldVisualizationChange={onFieldVisualizationChange}
          />
        </div>
      )}
    </article>
  )
}

export default function ComparePage() {
  const { t, language } = useI18n()
  const navigate = useNavigate()
  const { projectId: routeProjectId = '', compareId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const querySelectedIds = useMemo(
    () => (searchParams.get('cases') ?? '').split(',').filter(Boolean),
    [searchParams],
  )
  const [workspace, setWorkspace] = useState<CompareWorkspace | null>(null)
  const selectedIds = useMemo(() => workspace
    ? [...workspace.participants].sort((left, right) => left.position - right.position).map((participant) => participant.case_id)
    : querySelectedIds,
  [querySelectedIds, workspace])
  const projectId = routeProjectId || workspace?.participants[0]?.project_id || ''
  const workspaceHydrated = useRef(false)
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [cases, setCases] = useState<ProjectItem[]>([])
  const [externalCases, setExternalCases] = useState<CompareCaseOption[]>([])
  const [projectOptions, setProjectOptions] = useState<ProjectRecord[]>([])
  const [externalProjectId, setExternalProjectId] = useState('')
  const [externalProjectLoading, setExternalProjectLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CompareResult | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [activeView, setActiveView] = useState<CompareView>('evidence')
  const [visualCandidateId, setVisualCandidateId] = useState('')
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [fieldVisualizationEnabled, setFieldVisualizationEnabled] = useState(false)
  const [wireframe, setWireframe] = useState(false)
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand | null>(null)
  const [cameraSync, setCameraSync] = useState<{ sourceId: string; state: ViewerCameraState } | null>(null)
  const [linkedManifestSelection, setLinkedManifestSelection] = useState<{ sourceId: string; item: CompareManifestItemKey | null } | null>(null)
  const [manifestAction, setManifestAction] = useState<CompareManifestAction | null>(null)
  const [analysis, setAnalysis] = useState('')
  const [analysisQuestion, setAnalysisQuestion] = useState('')
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [filePreview, setFilePreview] = useState<{ path: string; caseIds: string[]; contents: Record<string, string>; loading: boolean; error?: string } | null>(null)
  const [parameterName, setParameterName] = useState('operating_condition.alpha.value')
  const [parameterValues, setParameterValues] = useState('0, 5, 10')
  const [sweep, setSweep] = useState<SweepResult | null>(null)
  const [sweepLoading, setSweepLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [parameterExpansions, setParameterExpansions] = useState<Record<string, JsonExpansionState>>({})
  const [selectedResultPath, setSelectedResultPath] = useState<string | null>(null)
  const [visualVisibility, setVisualVisibility] = useState<Record<string, Record<string, boolean>>>({})
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveLoading, setSaveLoading] = useState(false)
  const [workspaceSaveState, setWorkspaceSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [selectedRevisionId, setSelectedRevisionId] = useState('')
  const [refreshLoading, setRefreshLoading] = useState(false)
  const [analysisSessionId, setAnalysisSessionId] = useState('')
  const [editParticipantsOpen, setEditParticipantsOpen] = useState(false)
  const [participantDraft, setParticipantDraft] = useState<CompareWorkspaceParticipant[]>([])
  const [newParticipantProjectId, setNewParticipantProjectId] = useState('')
  const [newParticipantCaseId, setNewParticipantCaseId] = useState('')
  const [participantUpdateLoading, setParticipantUpdateLoading] = useState(false)

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
    if (compareId) {
      api.compareWorkspace(compareId)
        .then((saved) => {
          setWorkspace(saved)
          const requestedRevisionID = saved.view_state?.selected_revision_id ?? saved.active_revision_id ?? saved.revisions?.at(-1)?.id ?? ''
          const snapshot = saved.revisions?.find((revision) => revision.id === requestedRevisionID)?.snapshot ?? saved.revisions?.at(-1)?.snapshot
          if (!snapshot) throw new Error(t('Saved comparison evidence is unavailable.'))
          setResult(snapshot)
          setSelectedRevisionId(requestedRevisionID)
          const view = saved.view_state ?? {}
          setActiveView(view.active_view ?? 'evidence')
          setVisualCandidateId(view.visual_candidate_id ?? snapshot.cases[1]?.id ?? '')
          setSelectedField(view.selected_field ?? null)
          setFieldVisualizationEnabled(Boolean(view.field_visualization_enabled))
          setWireframe(Boolean(view.wireframe))
          setCameraSync(view.camera_sync as typeof cameraSync)
          setLinkedManifestSelection(view.manifest_selection ?? null)
          setParameterExpansions(view.parameter_expansions ?? {})
          setSelectedResultPath(view.selected_result_path ?? null)
          setVisualVisibility(view.visual_visibility ?? {})
          const latestAI = saved.ai_sessions?.filter((session) => session.evidence_revision_id === requestedRevisionID).at(-1)
          if (latestAI) {
            setAnalysis(latestAI.analysis)
            setAnalysisQuestion(latestAI.question ?? '')
            setAnalysisSessionId(latestAI.id)
          }
          const primaryProjectId = saved.participants[0]?.project_id
          if (primaryProjectId) {
            void Promise.all([api.projectInfo(primaryProjectId), api.projectItems(primaryProjectId)])
              .then(([info, items]) => {
                setProject(info.data)
                setCases(items.data.items.filter((item) => item.type === 'Case'))
              })
              .catch(() => undefined)
          }
          window.setTimeout(() => { workspaceHydrated.current = true }, 0)
        })
        .catch((cause) => setError(String(cause).replace('Error: ', '')))
        .finally(() => setLoading(false))
      return
    }
    workspaceHydrated.current = false
    void api.projects().then((projectsResponse) => {
      setProjectOptions(projectsResponse.data.records ?? projectsResponse.data.projects ?? [])
    }).catch(() => undefined)
    Promise.all([api.projectInfo(routeProjectId), api.projectItems(routeProjectId)])
      .then(([info, items]) => {
        setProject(info.data)
        setCases(items.data.items.filter((item) => item.type === 'Case'))
      })
      .catch((cause) => setError(String(cause).replace('Error: ', '')))
      .finally(() => setLoading(false))
  }, [compareId, routeProjectId, t])

  const persistedViewState = useMemo<CompareWorkspaceViewState>(() => ({
    active_view: activeView,
    visual_candidate_id: visualCandidateId,
    selected_field: selectedField,
    field_visualization_enabled: fieldVisualizationEnabled,
    wireframe,
    camera_sync: cameraSync,
    manifest_selection: linkedManifestSelection,
    parameter_expansions: parameterExpansions,
    selected_result_path: selectedResultPath,
    visual_visibility: visualVisibility,
    selected_revision_id: selectedRevisionId || undefined,
  }), [activeView, cameraSync, fieldVisualizationEnabled, linkedManifestSelection, parameterExpansions, selectedField, selectedResultPath, selectedRevisionId, visualCandidateId, visualVisibility, wireframe])

  useEffect(() => {
    if (!compareId || !workspaceHydrated.current) return
    setWorkspaceSaveState('saving')
    const timer = window.setTimeout(() => {
      void api.updateCompareWorkspaceViewState(compareId, persistedViewState)
        .then((saved) => {
          setWorkspace((current) => current ? { ...current, updated_at: saved.updated_at, view_state: saved.view_state } : current)
          setWorkspaceSaveState('saved')
        })
        .catch(() => setWorkspaceSaveState('error'))
    }, 800)
    return () => window.clearTimeout(timer)
  }, [compareId, persistedViewState])

  const allCaseOptions = useMemo<CompareCaseOption[]>(() => {
    const current = cases.map((item) => ({ ...item, projectId, projectName: project?.name ?? projectId }))
    return mergeCompareCaseOptions(current, externalCases)
  }, [cases, externalCases, project?.name, projectId])

  const loadExternalProject = async () => {
    const targetProjectID = externalProjectId.trim()
    if (!targetProjectID || targetProjectID === projectId) return
    setExternalProjectLoading(true)
    setError('')
    try {
      const [info, items] = await Promise.all([api.projectInfo(targetProjectID), api.projectItems(targetProjectID)])
      const additions = items.data.items.filter((item) => item.type === 'Case').map((item) => ({
        ...item, projectId: targetProjectID, projectName: info.data.name,
      }))
      setExternalCases((current) => [...current.filter((item) => item.projectId !== targetProjectID), ...additions])
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setExternalProjectLoading(false)
    }
  }

  const toggleCase = (id: string) => {
    const next = toggleCaseSelection(selectedIds, id)
    const params = new URLSearchParams(searchParams)
    if (next.length) params.set('cases', next.join(','))
    else params.delete('cases')
    setSearchParams(params, { replace: true })
    setResult(null)
    setAnalysis('')
    setSweep(null)
    setConfirmed(false)
  }

  const runCompare = async () => {
    setCompareLoading(true)
    setError('')
    try {
      const next = await api.compareCases(selectedIds)
      setResult(next)
      setVisualCandidateId(next.cases[1]?.id ?? '')
      setCameraSync(null)
      setLinkedManifestSelection(null)
      setManifestAction(null)
      setActiveView('evidence')
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setCompareLoading(false)
    }
  }

  const runAIAnalysis = async () => {
    setAnalysisLoading(true)
    setAnalysisError('')
    try {
      if (compareId && workspace && selectedRevisionId) {
        const response = await api.analyzeCompareWorkspaceRevision(compareId, {
          evidence_revision_id: selectedRevisionId,
          language,
          question: analysisQuestion.trim() || undefined,
        })
        const session = response.session
        setAnalysis(response.analysis)
        setWorkspace((current) => current ? { ...current, ai_sessions: [...(current.ai_sessions ?? []), session] } : current)
        setAnalysisSessionId(session.id)
      } else {
        const response = await api.analyzeCaseComparison(selectedIds, language, analysisQuestion.trim() || undefined)
        setAnalysis(response.analysis)
      }
    } catch (cause) {
      setAnalysisError(String(cause).replace('Error: ', ''))
    } finally {
      setAnalysisLoading(false)
    }
  }

  const selectEvidenceRevision = (revisionID: string) => {
    if (!workspace) return
    const revision = workspace.revisions?.find((item) => item.id === revisionID)
    if (!revision) return
    setSelectedRevisionId(revisionID)
    setResult(revision.snapshot)
    setVisualCandidateId(revision.snapshot.cases[1]?.id ?? '')
    const latestAI = workspace.ai_sessions?.filter((session) => session.evidence_revision_id === revisionID).at(-1)
    setAnalysis(latestAI?.analysis ?? '')
    setAnalysisQuestion(latestAI?.question ?? '')
    setAnalysisSessionId(latestAI?.id ?? '')
  }

  const refreshEvidence = async () => {
    if (!compareId) return
    setRefreshLoading(true)
    setError('')
    try {
      const refreshed = await api.refreshCompareWorkspaceEvidence(compareId)
      setWorkspace(refreshed)
      const revision = refreshed.revisions?.find((item) => item.id === refreshed.active_revision_id) ?? refreshed.revisions?.at(-1)
      if (revision) {
        setSelectedRevisionId(revision.id)
        setResult(revision.snapshot)
        setVisualCandidateId(revision.snapshot.cases[1]?.id ?? '')
        setAnalysis('')
        setAnalysisQuestion('')
        setAnalysisSessionId('')
      }
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setRefreshLoading(false)
    }
  }

  const saveParticipants = async () => {
    if (!compareId || participantDraft.length < 2) return
    setParticipantUpdateLoading(true)
    setError('')
    try {
      const updated = await api.replaceCompareWorkspaceParticipants(compareId, participantDraft)
      setWorkspace(updated)
      const revision = updated.revisions?.find((item) => item.id === updated.active_revision_id) ?? updated.revisions?.at(-1)
      if (revision) {
        setSelectedRevisionId(revision.id)
        setResult(revision.snapshot)
        setVisualCandidateId(revision.snapshot.cases[1]?.id ?? '')
      }
      setAnalysis('')
      setAnalysisSessionId('')
      setEditParticipantsOpen(false)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally { setParticipantUpdateLoading(false) }
  }

  const exportReport = () => {
    if (!workspace) return
    const report = buildCompareWorkspaceReport(workspace, selectedRevisionId)
    const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${workspace.name.replaceAll(/[^a-zA-Z0-9_-]+/g, '-') || 'case-comparison'}-revision.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  const previewCommonFile = async (path: string, compareCases: CaseComparison[]) => {
    setSelectedResultPath(path)
    const caseIds = compareCases.map((item) => item.id)
    setFilePreview({ path, caseIds, contents: {}, loading: true })
    try {
      const entries = await Promise.all(compareCases.map(async (item) => [item.id, await api.previewResult('Case', item.id, path)] as const))
      setFilePreview({ path, caseIds, contents: Object.fromEntries(entries), loading: false })
    } catch (cause) {
      setFilePreview({ path, caseIds, contents: {}, loading: false, error: String(cause).replace('Error: ', '') })
    }
  }

  const saveCompareWorkspace = async () => {
    if (!result || !saveName.trim()) return
    setSaveLoading(true)
    setError('')
    try {
      const saved = await api.createCompareWorkspace({
        name: saveName.trim(),
        participants: buildCompareParticipants(result, allCaseOptions, { id: projectId, name: project?.name }),
        view_state: persistedViewState,
      })
      setSaveOpen(false)
      navigate(`/compares/${encodeURIComponent(saved.id)}`)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setSaveLoading(false)
    }
  }

  const values = parseSweepValues(parameterValues)
  const baseline = cases.find((item) => item.id === selectedIds[0])
  const previewSweep = async (createPlans = false) => {
    if (!baseline) return
    setSweepLoading(true)
    setError('')
    try {
      setSweep(await api.sweep({
        baseline_case_id: baseline.id,
        baseline_name: baseline.name,
        project_id: projectId,
        project_name: project?.name,
        parameters: [{ name: parameterName.trim(), values }],
        create_plans: createPlans,
        confirmed: createPlans && confirmed,
      }))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setSweepLoading(false)
    }
  }

  const artifactMatrix = result ? buildArtifactMatrix(result.cases) : []
  const baselineResult = result?.cases[0]
  const visualCandidate = result?.cases.find((item) => item.id === visualCandidateId) ?? result?.cases[1]
  const views: Array<{ id: CompareView; label: string; icon: typeof GitCompare; count?: number }> = [
    { id: 'evidence', label: t('Evidence'), icon: BarChart3 },
    { id: 'visual', label: t('Visual compare'), icon: Box },
    { id: 'files', label: t('Result files'), icon: FileOutput, count: artifactMatrix.length },
    { id: 'parameters', label: t('Parameters'), icon: TableProperties, count: result?.diffs.length },
    { id: 'sweep', label: t('Parameter Sweep'), icon: SlidersHorizontal },
  ]
  const participantForCase = (caseId: string) => workspace?.participants.find((participant) => participant.case_id === caseId)
    ?? (() => {
      const option = allCaseOptions.find((item) => item.id === caseId)
      return option ? { project_id: option.projectId, project_name_snapshot: option.projectName, case_id: option.id, case_name_snapshot: option.name, role: 'candidate' as const, position: 0, availability: 'available' as const } : undefined
    })()
  const revisionSessions = workspace?.ai_sessions?.filter((session) => session.evidence_revision_id === selectedRevisionId) ?? []
  const selectedRevision = workspace?.revisions?.find((revision) => revision.id === selectedRevisionId)
  const previousRevision = workspace?.revisions?.find((revision) => revision.number === (selectedRevision?.number ?? 0) - 1)
  const revisionDelta = selectedRevision ? compareEvidenceRevisions(previousRevision?.snapshot, selectedRevision.snapshot) : null

  return (
    <div className="compare-page">
      <TopBar status={status} />
      <header className="compare-header">
        <div className="compare-header-inner">
          <Link to={workspace ? '/compares' : `/projects/${encodeURIComponent(projectId)}`}><ArrowLeft size={15} /> {workspace ? t('Saved comparisons') : t('Project')}</Link>
          <div>
            <p className="eyebrow">{t('CASE DECISION WORKSPACE')}</p>
            <h1><GitCompare size={24} /> {workspace?.name ?? t('Compare Cases')}</h1>
            <p>{workspace ? t('Saved comparison workspace') : project?.name ?? projectId} · {t('Compare setup, evidence, fields, and result artifacts before making a decision.')}</p>
          </div>
          <div className="compare-header-actions">
            <Link to="/compares"><LibraryBig size={14} />{t('Saved comparisons')}</Link>
            {result && !workspace && <button type="button" onClick={() => {
              setSaveName(`${result.cases[0]?.name ?? t('Baseline')} vs ${result.cases[1]?.name ?? t('Candidate')}`)
              setSaveOpen(true)
            }}><BookmarkPlus size={14} />{t('Save comparison')}</button>}
            {workspace && <button type="button" disabled={refreshLoading} onClick={() => void refreshEvidence()}>{refreshLoading ? <RefreshCw className="spin" size={14} /> : <RefreshCw size={14} />}{t('Refresh evidence')}</button>}
            {workspace && <button type="button" onClick={() => { setParticipantDraft(workspace.participants); setEditParticipantsOpen(true) }}><Pencil size={14} />{t('Edit comparison set')}</button>}
            {workspace && <button type="button" onClick={exportReport}><FileDown size={14} />{t('Export report')}</button>}
            {workspace && <span className={`compare-save-state ${workspaceSaveState}`}>{workspaceSaveState === 'saving' ? t('Saving…') : workspaceSaveState === 'error' ? t('Save failed') : t('Saved')}</span>}
          </div>
        </div>
      </header>

      {loading && <div className="project-load-state"><RefreshCw className="spin" /> {t('Loading Cases…')}</div>}
      {error && <div className="project-cache-warning"><AlertCircle size={14} />{error}</div>}

      {!loading && (
        <main className="compare-workbench">
          {!workspace && <section className="compare-picker">
            <div className="compare-picker-heading">
              <div><strong>{t('Select Cases')}</strong><span>{t('First selection is the baseline.')}</span></div>
              <span>{t('{count} selected').replace('{count}', String(selectedIds.length))}</span>
            </div>
            <div className="compare-project-picker">
              <label><span>{t('Add Cases from another Project')}</span><input list="compare-project-options" value={externalProjectId} onChange={(event) => setExternalProjectId(event.target.value)} placeholder={t('Project ID')} /></label>
              <datalist id="compare-project-options">{projectOptions.filter((item) => item.id !== projectId).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</datalist>
              <button type="button" disabled={!externalProjectId.trim() || externalProjectLoading} onClick={() => void loadExternalProject()}>{externalProjectLoading ? <RefreshCw className="spin" size={14} /> : <LibraryBig size={14} />}{t('Load Project Cases')}</button>
            </div>
            <div className="compare-case-list">
              {allCaseOptions.map((item) => (
                <label key={item.id} className={`compare-case-option ${selectedIds.includes(item.id) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleCase(item.id)} />
                  <span><strong>{item.name}</strong><small>{item.projectName} · {item.id}</small></span>
                  {selectedIds[0] === item.id && <em>{t('Baseline')}</em>}
                </label>
              ))}
              {!cases.length && <div className="detail-empty">{t('This Project has no Cases.')}</div>}
            </div>
            <button className="geometry-plan-action" disabled={selectedIds.length < 2 || compareLoading} onClick={runCompare}>
              {compareLoading ? <RefreshCw size={15} className="spin" /> : <GitCompare size={15} />}
              {t('Compare selected Cases')}
            </button>
          </section>}

          {workspace && workspace.participants.some((participant) => participant.availability !== 'available') && (
            <section className="compare-availability-banner" role="status">
              <AlertCircle size={16} />
              <div><strong>{t('Some original Cases are unavailable')}</strong><span>{t('Saved parameter, KPI, artifact, and AI evidence remains available. Live files and 3D assets are disabled for unavailable Cases.')}</span></div>
            </section>
          )}

          {workspace && (workspace.revisions?.length ?? 0) > 0 && (
            <section className="compare-history-bar">
              <label>{t('Evidence revision')}<select value={selectedRevisionId} onChange={(event) => selectEvidenceRevision(event.target.value)}>{[...(workspace.revisions ?? [])].reverse().map((revision) => <option value={revision.id} key={revision.id}>{t('Revision {number} · {date}').replace('{number}', String(revision.number)).replace('{date}', new Date(revision.created_at).toLocaleString())}</option>)}</select></label>
              <span>{selectedRevisionId === workspace.active_revision_id ? t('Latest evidence') : t('Historical evidence · AI analysis uses this revision')}</span>
            </section>
          )}
          {revisionDelta && <section className="compare-revision-delta"><strong>{t('Changes since previous revision')}</strong><span>{t('{count} status changes').replace('{count}', String(revisionDelta.statusChanges))}</span><span>{t('{count} KPI changes').replace('{count}', String(revisionDelta.kpiChanges))}</span><span>{t('{count} artifact changes').replace('{count}', String(revisionDelta.artifactChanges))}</span><span>{t('{count} parameter-difference change').replace('{count}', String(revisionDelta.parameterDiffChange))}</span></section>}

          {!result && (
            <section className="compare-empty">
              <GitCompare size={26} />
              <strong>{t('Select at least two Cases')}</strong>
              <p>{t('The baseline and candidates will be compared across convergence, KPIs, result files, visualization evidence, and SimulationParams.')}</p>
            </section>
          )}

          {result && (
            <>
              <nav className="compare-view-tabs" role="tablist" aria-label={t('Comparison evidence views')}>
                {views.map(({ id, label, icon: Icon, count }) => (
                  <button key={id} type="button" role="tab" aria-selected={activeView === id} className={activeView === id ? 'active' : ''} onClick={() => setActiveView(id)}>
                    <Icon size={14} /><span>{label}</span>{count !== undefined && <small>{count}</small>}
                  </button>
                ))}
              </nav>

              {activeView === 'evidence' && (
                <div className="compare-evidence-layout">
                  <section className="compare-evidence-panel">
                    <div className="compare-section-heading">
                      <div><p className="eyebrow">{t('DECISION EVIDENCE')}</p><h2>{t('Case evidence matrix')}</h2></div>
                      <span>{t('Completed is not the same as converged or credible.')}</span>
                    </div>
                    <div className="compare-case-evidence-grid" style={{ '--compare-columns': result.cases.length } as React.CSSProperties}>
                      {result.cases.map((item, index) => (
                        <article key={item.id}>
                          <header><span>{index === 0 ? t('BASELINE') : t('CANDIDATE')}</span><strong>{item.name}</strong><small>{item.status}</small></header>
                          <div className={`compare-convergence-state convergence-${item.convergence?.status ?? 'insufficient-data'}`}>
                            <BarChart3 size={15} /><span><strong>{t(item.convergence?.status ?? 'insufficient-data')}</strong><small>{t(item.convergence?.reason ?? 'No convergence evidence.')}</small></span>
                          </div>
                          <dl>
                            {(item.kpis ?? []).map((kpi) => <div key={kpi.name}><dt>{kpi.name}</dt><dd>{kpi.value.toPrecision(6)} {kpi.unit}</dd><small>{kpi.source}</small></div>)}
                            <div><dt>{t('Result artifacts')}</dt><dd>{item.artifacts?.length ?? 0}</dd><small>{[...new Set((item.artifacts ?? []).map((artifact) => artifact.category))].join(' · ') || t('None')}</small></div>
                            <div><dt>{t('Visualization evidence')}</dt><dd>{item.visualization?.available ? t('Available') : t('Unavailable')}</dd><small>{t('{count} configured outputs').replace('{count}', String(item.visualization?.output_count ?? 0))}</small></div>
                          </dl>
                          {participantForCase(item.id)?.availability === 'deleted' ? <span className="compare-case-unavailable">{t('Case deleted · saved evidence')}</span>
                            : participantForCase(item.id)?.availability === 'inaccessible' ? <span className="compare-case-unavailable">{t('Case inaccessible · saved evidence')}</span>
                              : participantForCase(item.id)?.availability === 'unavailable' ? <span className="compare-case-unavailable">{t('Case unavailable · saved evidence')}</span>
                              : <Link to={`/projects/${participantForCase(item.id)?.project_id ?? projectId}/resources/${item.id}`}><GitPullRequestDraft size={13} /> {t('Open Case')}</Link>}
                        </article>
                      ))}
                    </div>
                  </section>

                  <aside className="compare-ai-panel">
                    <div className="compare-ai-heading"><span><Sparkles size={16} /></span><div><strong>{t('AI difference analysis')}</strong><small>{t('Uses parameters and result evidence together')}</small></div></div>
                    {!analysis && <p>{t('Ask AI to connect setup changes with convergence, KPI, artifact, and visualization evidence. Unsupported causal claims must be identified as hypotheses.')}</p>}
                    {revisionSessions.length > 0 && <label className="compare-ai-history">{t('AI session')}<select value={analysisSessionId} onChange={(event) => {
                      const session = revisionSessions.find((item) => item.id === event.target.value)
                      setAnalysisSessionId(event.target.value)
                      setAnalysis(session?.analysis ?? '')
                      setAnalysisQuestion(session?.question ?? '')
                    }}><option value="">{t('New analysis')}</option>{revisionSessions.map((session, index) => <option value={session.id} key={session.id}>{t('Analysis {number} · {date}').replace('{number}', String(index + 1)).replace('{date}', new Date(session.created_at).toLocaleString())}</option>)}</select></label>}
                    {analysis && <div className="compare-ai-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown></div>}
                    <textarea value={analysisQuestion} onChange={(event) => setAnalysisQuestion(event.target.value)} placeholder={t('Optional: What decision are you trying to make?')} />
                    {analysisError && <div className="compare-ai-error"><AlertCircle size={13} />{analysisError}</div>}
                    <button type="button" disabled={analysisLoading} onClick={() => void runAIAnalysis()}>
                      {analysisLoading ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />}
                      {analysis ? t('Analyze again') : t('Analyze differences')}
                    </button>
                  </aside>
                </div>
              )}

              {activeView === 'visual' && baselineResult && visualCandidate && (
                <section className="compare-visual-panel">
                  <div className="compare-section-heading">
                    <div><p className="eyebrow">{t('FLOW-FIELD REVIEW')}</p><h2>{t('Side-by-side visual comparison')}</h2></div>
                    <label>{t('Candidate')}<select value={visualCandidate.id} onChange={(event) => setVisualCandidateId(event.target.value)}>{result.cases.slice(1).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
                  </div>
                  <div className="compare-visual-toolbar">
                    <span>{t('Drag, pan, zoom, fields, and wireframe are synchronized between both viewers.')}</span>
                    {(['fit', 'x', 'y', 'z', 'iso'] as const).map((command) => <button type="button" key={command} onClick={() => setCameraCommand({ type: command, nonce: Date.now() })}>{command.toUpperCase()}</button>)}
                  </div>
                  <div className="compare-viewport-grid">
                    {[baselineResult, visualCandidate].map((item) => <CompareViewport
                      key={item.id}
                      item={item}
                      projectId={participantForCase(item.id)?.project_id ?? projectId}
                      availability={participantForCase(item.id)?.availability}
                      selectedField={selectedField}
                      onSelectedFieldChange={setSelectedField}
                      fieldVisualizationEnabled={fieldVisualizationEnabled}
                      onFieldVisualizationChange={(enabled) => {
                        setFieldVisualizationEnabled(enabled)
                        if (!enabled) setSelectedField(null)
                      }}
                      wireframe={wireframe}
                      onWireframeChange={setWireframe}
                      cameraCommand={cameraCommand}
                      onCameraCommand={setCameraCommand}
                      cameraState={cameraSync?.sourceId === item.id ? null : cameraSync?.state ?? null}
                      onCameraStateChange={(state) => setCameraSync({ sourceId: item.id, state })}
                      linkedSelection={linkedManifestSelection}
                      onLinkedSelectionChange={(sourceId, selectedItem) => setLinkedManifestSelection({ sourceId, item: selectedItem })}
                      manifestAction={manifestAction}
                      onManifestAction={setManifestAction}
                      savedVisibility={visualVisibility[item.id]}
                      onVisibilityStateChange={(caseId, visibility) => setVisualVisibility((current) => ({ ...current, [caseId]: visibility }))}
                    />)}
                  </div>
                  <div className="compare-compatibility-note"><AlertCircle size={14} /><span><strong>{t('Numerical difference fields require compatibility checks.')}</strong>{t('Topology, coordinates, field definitions, normalization, and time alignment must match before subtraction. Until then, this view is an evidence-aligned side-by-side comparison.')}</span></div>
                </section>
              )}

              {activeView === 'files' && (
                <section className="compare-files-panel">
                  <div className="compare-section-heading"><div><p className="eyebrow">{t('RESULT INVENTORY')}</p><h2>{t('Result file coverage')}</h2></div><span>{t('Common files can be opened side by side; missing files remain visible as evidence gaps.')}</span></div>
                  <div className="compare-file-matrix" style={{ '--compare-columns': result.cases.length } as React.CSSProperties}>
                    <div className="compare-file-head"><strong>{t('Artifact')}</strong>{result.cases.map((item) => <strong key={item.id}>{item.name}</strong>)}</div>
                    {artifactMatrix.map((row) => {
                      const comparableCases = result.cases.filter((item) => row.byCase[item.id]?.previewable)
                      return <div className={`compare-file-row ${selectedResultPath === row.path ? 'is-selected' : ''}`} key={row.path}>
                        <div><strong title={row.path}>{row.path.split('/').pop()}</strong><small>{row.category}</small>{comparableCases.length >= 2 && <button type="button" onClick={() => void previewCommonFile(row.path, comparableCases)}>{t('Compare file')}</button>}</div>
                        {result.cases.map((item) => {
                          const artifact = row.byCase[item.id]
                          return <div key={item.id} className={artifact ? 'available' : 'missing'}>{artifact ? <><CheckCircle2 size={13} /><span>{formatBytes(artifact.size_bytes)}</span><button type="button" aria-label={t('Download result')} onClick={() => void api.downloadResult('Case', item.id, artifact.path)}><Download size={12} /></button></> : <span>{t('Missing')}</span>}</div>
                        })}
                      </div>
                    })}
                    {!artifactMatrix.length && <div className="detail-empty">{t('No result artifacts reported.')}</div>}
                  </div>
                </section>
              )}

              {activeView === 'parameters' && (
                <section className="compare-diffs">
                  <div className="compare-section-heading"><div><p className="eyebrow">{t('SETUP DELTA')}</p><h2>{t('SimulationParams differences')}</h2></div><span>{t('{count} semantic differences').replace('{count}', String(result.diffs.length))}</span></div>
                  <div className="compare-diff-head"><span>{t('Path')}</span><span>{t('Baseline value')}</span><span>{t('Candidate value')}</span></div>
                  {result.diffs.map((diff) => {
                    const key = `${diff.compared_to ?? 'candidate'}-${diff.path}`
                    return <CompareParameterDiffRow
                      diff={diff}
                      expansion={parameterExpansions[key] ?? {}}
                      onExpansionChange={(path, open) => setParameterExpansions((current) => ({
                        ...current,
                        [key]: { ...(current[key] ?? {}), [path]: open },
                      }))}
                      key={key}
                    />
                  })}
                  {!result.diffs.length && <p>{t('No semantic parameter differences found.')}</p>}
                </section>
              )}

              {activeView === 'sweep' && baseline && (
                <section className="sweep-builder">
                  <div><p className="eyebrow">{t('SWEEP VARIATIONS')}</p><h2>{t('Parameter Sweep')}</h2><p>{t('Builds one reviewable Draft for each parameter combination. No Case is executed until its Draft is individually approved.')}</p></div>
                  <label>{t('SimulationParams path')}<input value={parameterName} onChange={(event) => setParameterName(event.target.value)} /></label>
                  <label>{t('Values, comma separated')}<input value={parameterValues} onChange={(event) => setParameterValues(event.target.value)} /></label>
                  <button onClick={() => previewSweep(false)} disabled={!parameterName.trim() || !values.length || sweepLoading}>{sweepLoading ? <RefreshCw size={14} className="spin" /> : <BarChart3 size={14} />} {t('Preview sweep')}</button>
                  {sweep && <div className={`sweep-review ${sweep.plan.over_budget ? 'blocked' : ''}`}><strong>{t('{count} Sweep Drafts').replace('{count}', String(sweep.plan.total_cases))}</strong><span>{t('Recommended maximum: {count}').replace('{count}', String(sweep.plan.max_recommended))}</span>{(sweep.warnings ?? []).map((warning) => <p key={warning}><AlertCircle size={13} />{warning}</p>)}{(sweep.plans ?? []).length > 0 && <p><CheckCircle2 size={14} /> {t('{count} idempotent Sweep Drafts created.').replace('{count}', String((sweep.plans ?? []).length))}</p>}{!sweep.plan.over_budget && (sweep.plans ?? []).length === 0 && <><label className="sweep-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t('I confirm the combination count and want to create Sweep Drafts.')}</label><button className="geometry-plan-action" disabled={!confirmed || sweepLoading} onClick={() => previewSweep(true)}><GitPullRequestDraft size={14} /> {t('Create Sweep Drafts')}</button></>}</div>}
                </section>
              )}
            </>
          )}
          {filePreview && result && <ResultFileComparisonDialog
            path={filePreview.path}
            loading={filePreview.loading}
            error={filePreview.error}
            cases={filePreview.caseIds.map((caseId) => {
              const item = result.cases.find((candidate) => candidate.id === caseId)
              return { id: caseId, name: item?.name ?? caseId, content: filePreview.contents[caseId] }
            })}
            onClose={() => setFilePreview(null)}
          />}
          {saveOpen && (
            <div className="compare-save-overlay" role="presentation" onMouseDown={(event) => {
              if (event.target === event.currentTarget) setSaveOpen(false)
            }}>
              <section className="compare-save-dialog" role="dialog" aria-modal="true" aria-labelledby="compare-save-title">
                <div><p className="eyebrow">{t('PERSISTED DECISION CONTEXT')}</p><h2 id="compare-save-title">{t('Save comparison workspace')}</h2></div>
                <p>{t('Saves a lightweight evidence snapshot, view settings, and future AI analyses. Large result and visualization files remain referenced from their Cases.')}</p>
                <label>{t('Workspace name')}<input autoFocus value={saveName} maxLength={120} onChange={(event) => setSaveName(event.target.value)} /></label>
                <div className="compare-save-dialog-actions"><button type="button" onClick={() => setSaveOpen(false)}>{t('Cancel')}</button><button type="button" className="geometry-plan-action" disabled={!saveName.trim() || saveLoading} onClick={() => void saveCompareWorkspace()}>{saveLoading ? <RefreshCw className="spin" size={14} /> : <BookmarkPlus size={14} />}{t('Save workspace')}</button></div>
              </section>
            </div>
          )}
          {editParticipantsOpen && workspace && (
            <div className="compare-save-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditParticipantsOpen(false) }}>
              <section className="compare-save-dialog compare-participant-dialog" role="dialog" aria-modal="true" aria-labelledby="compare-participants-title">
                <div><p className="eyebrow">{t('IMMUTABLE COMPARISON HISTORY')}</p><h2 id="compare-participants-title">{t('Edit comparison set')}</h2></div>
                <p>{t('Changing the baseline or Cases creates a new evidence revision. Existing revisions remain unchanged.')}</p>
                <div className="compare-participant-editor">{participantDraft.map((participant, index) => <div key={participant.case_id}><button type="button" disabled={index === 0} onClick={() => setParticipantDraft([participant, ...participantDraft.filter((item) => item.case_id !== participant.case_id)])}>{index === 0 ? t('Baseline') : t('Make baseline')}</button><span><strong>{participant.case_name_snapshot || participant.case_id}</strong><small>{participant.project_name_snapshot || participant.project_id}</small></span><button type="button" disabled={participantDraft.length <= 2} onClick={() => setParticipantDraft(participantDraft.filter((item) => item.case_id !== participant.case_id))}>{t('Remove')}</button></div>)}</div>
                <div className="compare-participant-add"><label>{t('Project ID')}<input value={newParticipantProjectId} onChange={(event) => setNewParticipantProjectId(event.target.value)} /></label><label>{t('Case ID')}<input value={newParticipantCaseId} onChange={(event) => setNewParticipantCaseId(event.target.value)} /></label><button type="button" disabled={!newParticipantProjectId.trim() || !newParticipantCaseId.trim() || participantDraft.length >= 6 || participantDraft.some((item) => item.case_id === newParticipantCaseId.trim())} onClick={() => { setParticipantDraft([...participantDraft, { project_id: newParticipantProjectId.trim(), case_id: newParticipantCaseId.trim(), case_name_snapshot: newParticipantCaseId.trim(), role: 'candidate', position: participantDraft.length, availability: 'available' }]); setNewParticipantCaseId('') }}>{t('Add Case')}</button></div>
                <div className="compare-save-dialog-actions"><button type="button" onClick={() => setEditParticipantsOpen(false)}>{t('Cancel')}</button><button type="button" className="geometry-plan-action" disabled={participantDraft.length < 2 || participantUpdateLoading} onClick={() => void saveParticipants()}>{participantUpdateLoading ? <RefreshCw className="spin" size={14} /> : <CheckCircle2 size={14} />}{t('Save as new revision')}</button></div>
              </section>
            </div>
          )}
        </main>
      )}
    </div>
  )
}
