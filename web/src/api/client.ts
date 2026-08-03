import { annotationsApi } from './annotations'

export {
  AnnotationApiError,
  annotationsApi,
  type CreateAnnotationInput,
  type PatchAnnotationInput,
} from './annotations'

export type Flow360Status = {
  available: boolean
  binary?: string
  version?: string
  profile?: string
  environment?: string
  authentication?: 'environment' | 'stored-profile'
  error?: string
}

export type AgentState = {
  mode: 'ai' | 'codex' | 'local-planner' | 'configuration-error'
  provider: 'builtin' | 'codex' | string
  model: string
  ready: boolean
  execution: boolean
}

export type AgentProposalField = {
  key: string
  value: unknown
  provenance: 'provided' | 'derived' | 'inferred' | 'defaulted'
  description?: string
}

export type AgentProposal = {
  id: string
  project_id?: string
  project_name?: string
  source_id?: string
  source_type?: string
  source_name?: string
  action: string
  target: string
  name: string
  intent: string
  patch: Record<string, unknown>
  branch_preview: string
  fields: AgentProposalField[]
  validation_hints?: string[]
}

export type AgentAction = {
  version: string
  kind: 'create-plan' | 'request-missing-input'
  message: string
  proposals?: AgentProposal[]
  questions?: Array<{ field: string; message: string; urgency: string; reason?: string }>
  warnings?: string[]
  assumptions?: string[]
}

export type ActionPlanResultItem = {
  id: string
  plan?: SimulationPlan
  status?: string
  error?: string
}

export type ActionPlanResult = {
  message: string
  warnings?: string[]
  results: ActionPlanResultItem[]
  total: number
  created: number
  failed: number
}

export type FolderNode = {
  id: string
  name: string
  subfolders: FolderNode[]
}

export type FolderTreeResponse = {
  root: FolderNode
}

export type ProjectRecord = {
  id: string
  name: string
  description?: string
  root_item_type: 'Geometry' | 'SurfaceMesh' | 'VolumeMesh' | string
  solver_version: string
  created_at?: string
  tags?: string[]
  statistics?: Record<string, {
    count: number
    success_count: number
    error_count: number
    diverged_count: number
    running_count: number
  } | null>
}

export type ProjectListResponse = {
  records?: ProjectRecord[]
  projects?: ProjectRecord[]
  returned?: number
  total?: number
  warning?: string
}

export type ProjectInfo = {
  id: string
  name: string
  solver_version: string
  tags: string[]
  root_item: {
    id: string
    type: string
  }
}

export type ResourceNode = {
  id: string
  name: string
  type: string
  children: ResourceNode[]
}

export type ProjectTreeResponse = {
  root: ResourceNode
}

export type ProjectItem = {
  id: string
  name: string
  type: string
  parent_id: string | null
}

export type ProjectItemsResponse = {
  items: ProjectItem[]
}

export type ProjectSyncResource = {
  id: string
  type: string
  status: 'pending' | 'syncing' | 'completed' | 'failed'
  error?: string
  artifacts?: Record<string, {
    path: string
    local_path: string
    size_bytes: number
    status: string
    synced_at: string
  }>
  synced_at?: string
}

export type ProjectSyncManifest = {
  schema_version: number
  project_id: string
  namespace: string
  local_path: string
  artifact_policy: 'metadata-only' | 'metadata+geometry-visualization'
  status: 'syncing' | 'completed' | 'partial' | 'failed'
  total_resources: number
  synced_resources: number
  failed_resources: number
  current_resource?: string
  failures: Record<string, string>
  resources: Record<string, ProjectSyncResource>
  started_at: string
  updated_at: string
  completed_at?: string
}

export type ResourceDetail = {
  id: string
  type: string
  info?: Record<string, unknown>
  state?: Record<string, unknown>
  summary?: Record<string, unknown>
  simulation_params?: Record<string, unknown>
  results?: {
    records?: Array<{
      name?: string
      path?: string
      file_type?: string
      size_bytes?: number
      [key: string]: unknown
    }>
    [key: string]: unknown
  }
  errors?: Record<string, string>
}

export type GeometryDiagnosticCapability = {
  key: string
  status: 'available' | 'proxy' | 'unavailable'
  detail: string
}

export type GeometryDiagnosticEvidence = {
  key: string
  label: string
  value: unknown
  unit?: string
  provenance: 'provided' | 'computed' | 'inferred'
  method: string
}

export type GeometryDiagnosticFinding = {
  id: string
  kind: 'small-feature' | 'gap' | 'curvature' | 'proximity' | string
  severity: 'warning' | 'error' | 'unknown' | 'info'
  title: string
  detail: string
  entity_ids?: string[]
  evidence_keys?: string[]
  recommendation?: string
}

export type GeometryGroupingProposal = {
  id: string
  label: string
  basis: string
  entity_ids: string[]
  provenance: 'inferred'
}

export type GeometryDiagnosticReport = {
  schema_version: number
  geometry_id: string
  fingerprint: string
  settings: { small_surface_ratio: number; curvature_angle_deg: number }
  capabilities: GeometryDiagnosticCapability[]
  evidence: GeometryDiagnosticEvidence[]
  findings: GeometryDiagnosticFinding[]
  grouping_proposals: GeometryGroupingProposal[]
}

export type GeometryDiagnosticJob = {
  id: string
  geometry_id: string
  cache_key: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  stage: string
  settings: { small_surface_ratio: number; curvature_angle_deg: number }
  report?: GeometryDiagnosticReport
  error?: string
  created_at: string
  updated_at: string
  finished_at?: string
}

export type GeometryComparison = {
  schema_version: number
  baseline_id: string
  candidate_id: string
  metrics: Array<{
    key: string
    label: string
    baseline: number
    candidate: number
    delta: number
    unit?: string
  }>
  added_surfaces: string[]
  removed_surfaces: string[]
  provenance: string
}

export type Flow360DataResponse<T> = {
  data: T
  source: 'live' | 'cache'
  cachedAt?: string
  stale?: boolean
}

export type PlanValidation = {
  level: 'success' | 'warning' | 'error'
  field?: string
  message: string
}

export type PlanDifference = {
  path: string
  before?: unknown
  after?: unknown
  kind: 'added' | 'removed' | 'changed'
}

export type DynamicFormChoice = {
  value: string
  label: string
  model_type?: string
  entity_property?: string
  index?: number
  payload?: Record<string, unknown>
}

export type DynamicFormRecommendation = {
  title: string
  reason: string
  confidence: 'high' | 'medium' | 'low'
  evidence?: string[]
  provenance?: string
}

export type DynamicFormSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'quantity' | 'union' | 'entity_assignment' | 'json'
  title?: string
  description?: string
  default?: unknown
  path?: string
  required?: string[] | boolean
  nullable?: boolean
  properties?: Record<string, DynamicFormSchema>
  items?: DynamicFormSchema
  variants?: DynamicFormSchema[]
  options?: unknown[]
  unit?: string
  unit_options?: string[]
  value_schema?: DynamicFormSchema
  model_choices?: DynamicFormChoice[]
  entity_choices?: DynamicFormChoice[]
  default_model?: string
  default_entities?: string[]
  recommendation?: DynamicFormRecommendation
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
}

export type PlanPreflight = {
  schema_version: number
  validator_version?: string
  valid: boolean
  validated_revision: number
  issues: Array<{
    level: 'error' | 'warning'
    code: string
    path?: string
    message: string
    stages?: string[]
  }>
  form_schema: DynamicFormSchema
  validated_at: string
}

export type PlanFormSchemaResponse = {
  schema_version: number
  validator_version?: string
  source_type: string
  target: 'surface-mesh' | 'volume-mesh' | 'case'
  stages: Array<'SurfaceMesh' | 'VolumeMesh' | 'Case'>
  schemas: Partial<Record<'SurfaceMesh' | 'VolumeMesh' | 'Case', DynamicFormSchema>>
  baseline: Record<string, unknown>
}

export type PlanAssistResponse = {
  action: AgentAction
  proposal?: AgentProposal
  preflight?: Omit<PlanPreflight, 'validated_revision' | 'validated_at'>
}

export type SimulationPlan = {
  id: string
  project_id: string
  project_name?: string
  source_id: string
  source_type: string
  source_name?: string
  target: 'surface-mesh' | 'volume-mesh' | 'case'
  name: string
  intent: string
  patch: Record<string, unknown>
  revision: number
  preflight?: PlanPreflight
  differences: PlanDifference[]
  validations: PlanValidation[]
  evidence?: AgentProposalField[]
  validation_hints?: string[]
  command_preview: string[]
  status: 'draft' | 'approved' | 'running' | 'submitted' | 'failed' | 'reconciling' | 'completed'
  approved_at?: string
  started_at?: string
  completed_at?: string
  result?: Record<string, unknown>
  error?: string
  error_category?: string
  submission_id?: string
  remote_ids?: {
    project_id?: string
    draft_id?: string
    geometry_id?: string
    mesh_id?: string
    case_id?: string
    solver_version?: string
  }
  created_at: string
  updated_at: string
}

export type PlanExecutionSnapshot = {
  plan: SimulationPlan
  phase: string
  progress: number
  resource_type?: string
  resource_id?: string
  remote_state?: string
  state?: Record<string, unknown>
  terminal: boolean
  logs?: string
  logs_available: boolean
  state_error?: string
  logs_error?: string
  refreshed_at: string
}

export type ImportPlan = {
  id: string
  name: string
  source_type: string
  unit: string
  unit_confirmed: boolean
  workflow: string
  solver_version?: string
  folder_id?: string
  tags?: string[]
  files: ImportFileInfo[]
  size_bytes: number
  content_hash: string
  status: string
  command_preview: string[]
  error?: string
  result?: Record<string, unknown>
}

export type ImportFileInfo = {
  name: string
  size_bytes: number
  hash: string
  mime_type: string
}

export type CaseComparison = {
  id: string
  name: string
  status: string
  params: Record<string, unknown>
  convergence: {
    status: string
    reason: string
  }
  kpis: Array<{
    name: string
    value: number
    unit?: string
    converged: boolean
    source: string
  }>
}

export type CompareResult = {
  cases: CaseComparison[]
  diffs: Array<{ path: string; baseline: unknown; other: unknown; compared_to?: string }>
  ranking?: Array<{ id: string; name: string; score: number; reason: string }>
}

export type SweepParameter = {
  name: string
  values: number[]
}

export type InterventionEvidence = {
  type: string
  content: Record<string, unknown>
  source: string
  timestamp: string
}

export type InterventionDiagnosis = {
  root_cause: string
  category: string
  severity: string
  contributing_factors?: string[]
  recommended_actions?: string[]
}

export type InterventionValidation = {
  valid: boolean
  errors?: string[]
  warnings?: string[]
  preflight_id?: string
}

export type Intervention = {
  id: string
  project_id: string
  project_name?: string
  resource_id?: string
  resource_type?: string
  plan_id?: string
  plan_revision?: number
  target?: SimulationPlan['target']
  type: string
  state: string
  reason: string
  confidence: number
  impact?: string
  evidence?: InterventionEvidence[]
  diagnosis?: InterventionDiagnosis
  proposals?: AgentProposal[]
  selected_proposal?: AgentProposal
  user_feedback?: string
  requires_confirmation?: string[]
  current_patch?: Record<string, unknown>
  compiled_patch?: Record<string, unknown>
  validation?: InterventionValidation
  created_at: string
  updated_at: string
  resolved_at?: string
  closed_at?: string
}

export type CreateInterventionInput = {
  project_id: string
  project_name?: string
  resource_id?: string
  resource_type?: string
  plan_id?: string
  target?: SimulationPlan['target']
  type: string
  reason: string
  evidence?: InterventionEvidence[]
  current_patch?: Record<string, unknown>
}

export type SweepResult = {
  plan: {
    id: string
    baseline_case_id: string
    parameters: SweepParameter[]
    total_cases: number
    combinations: number[][]
    over_budget: boolean
    max_recommended: number
    metadata?: Record<string, string>
  }
  warnings: string[]
  plans: SimulationPlan[]
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || response.statusText)
  return body as T
}

async function flow360JSON<T>(path: string): Promise<Flow360DataResponse<T>> {
  const response = await fetch(path)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || response.statusText)
  const source = response.headers.get('X-VibeSim-Data-Source') === 'cache' ? 'cache' : 'live'
  return {
    data: body as T,
    source,
    cachedAt: response.headers.get('X-VibeSim-Cached-At') || undefined,
    stale: response.headers.get('X-VibeSim-Cache-Stale') === 'true',
  }
}

async function mutate<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || payload.message || response.statusText)
  return payload as T
}

async function remove<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'DELETE' })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || payload.message || response.statusText)
  return payload as T
}

async function responseError(response: Response): Promise<Error> {
  const body = await response.text()
  let message = body || response.statusText
  try {
    const payload = JSON.parse(body)
    message = payload.error || payload.message || message
  } catch { /* The response is plain text. */ }
  return new Error(message)
}

export const api = {
  annotations: annotationsApi,
  flow360Status: () => json<Flow360Status>('/api/flow360/status'),
  projects: (folderId?: string, cacheOnly = false) => {
    const params = new URLSearchParams()
    if (folderId) params.set('folder_id', folderId)
    if (cacheOnly) params.set('cache', 'only')
    return flow360JSON<ProjectListResponse>(`/api/flow360/projects${params.size ? `?${params}` : ''}`)
  },
  folders: (cacheOnly = false) =>
    flow360JSON<FolderTreeResponse>(`/api/flow360/folders${cacheOnly ? '?cache=only' : ''}`),
  projectInfo: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectInfo>(`/api/flow360/projects/${encodeURIComponent(projectId)}${cacheOnly ? '?cache=only' : ''}`),
  projectTree: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectTreeResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/tree${cacheOnly ? '?cache=only' : ''}`),
  projectItems: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectItemsResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/items${cacheOnly ? '?cache=only' : ''}`),
  startProjectSync: (projectId: string, force = false) =>
    mutate<ProjectSyncManifest>(
      `/api/flow360/projects/${encodeURIComponent(projectId)}/sync${force ? '?force=true' : ''}`,
    ),
  projectSyncStatus: (projectId: string) =>
    json<ProjectSyncManifest>(`/api/flow360/projects/${encodeURIComponent(projectId)}/sync`),
  resourceDetail: (resourceType: string, resourceId: string, cacheOnly = false) =>
    flow360JSON<ResourceDetail>(
      `/api/flow360/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}${cacheOnly ? '?cache=only' : ''}`,
    ),
  geometryDiagnostics: (resourceId: string, smallSurfaceRatio = 0.1, curvatureAngleDeg = 30) =>
    json<GeometryDiagnosticReport>(
      `/api/flow360/resources/Geometry/${encodeURIComponent(resourceId)}/diagnostics?small_surface_ratio=${encodeURIComponent(smallSurfaceRatio)}&curvature_angle_deg=${encodeURIComponent(curvatureAngleDeg)}`,
    ),
  startGeometryDiagnostics: (resourceId: string, smallSurfaceRatio = 0.1, curvatureAngleDeg = 30) =>
    mutate<GeometryDiagnosticJob>(
      `/api/flow360/resources/Geometry/${encodeURIComponent(resourceId)}/diagnostics/jobs`,
      { small_surface_ratio: smallSurfaceRatio, curvature_angle_deg: curvatureAngleDeg },
    ),
  geometryDiagnosticsJob: (resourceId: string, jobId: string) =>
    json<GeometryDiagnosticJob>(
      `/api/flow360/resources/Geometry/${encodeURIComponent(resourceId)}/diagnostics/jobs/${encodeURIComponent(jobId)}`,
    ),
  cancelGeometryDiagnostics: (resourceId: string, jobId: string) =>
    remove<GeometryDiagnosticJob>(
      `/api/flow360/resources/Geometry/${encodeURIComponent(resourceId)}/diagnostics/jobs/${encodeURIComponent(jobId)}`,
    ),
  compareGeometries: (resourceId: string, compareId: string) =>
    json<GeometryComparison>(
      `/api/flow360/resources/Geometry/${encodeURIComponent(resourceId)}/compare/${encodeURIComponent(compareId)}`,
    ),
  resourceLogs: async (resourceType: string, resourceId: string, tail = 200) => {
    const response = await fetch(
      `/api/flow360/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}/logs?tail=${tail}`,
    )
    const body = await response.text()
    if (!response.ok) {
      let message = body || response.statusText
      try {
        message = JSON.parse(body).error || message
      } catch { /* The response is plain text. */ }
      throw new Error(message)
    }
    return body
  },
  planExecution: (planId: string, tail = 120) =>
    json<PlanExecutionSnapshot>(`/api/plans/${encodeURIComponent(planId)}/execution?tail=${tail}`),
  downloadResult: async (resourceType: string, resourceId: string, resultPath: string) => {
    const response = await fetch(
      `/api/flow360/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}/download?path=${encodeURIComponent(resultPath)}`,
    )
    if (!response.ok) throw await responseError(response)
    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = resultPath.split('/').pop() || 'download'
    a.click()
    URL.revokeObjectURL(url)
  },
  previewResult: async (resourceType: string, resourceId: string, resultPath: string) => {
    const response = await fetch(
      `/api/flow360/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}/preview?path=${encodeURIComponent(resultPath)}`,
    )
    if (!response.ok) throw await responseError(response)
    return response.text()
  },
  compareCases: (caseIds: string[]) =>
    mutate<CompareResult>('/api/flow360/compare', { case_ids: caseIds, baseline: caseIds[0] }),
  sweep: (input: {
    baseline_case_id: string
    project_id: string
    project_name?: string
    baseline_name?: string
    parameters: SweepParameter[]
    create_plans?: boolean
    confirmed?: boolean
  }) => mutate<SweepResult>('/api/flow360/sweep', input),
  plans: (projectId: string, sourceId?: string) =>
    json<{ plans: SimulationPlan[] }>(
      `/api/plans?project_id=${encodeURIComponent(projectId)}${sourceId ? `&source_id=${encodeURIComponent(sourceId)}` : ''}`,
    ),
  plan: (planId: string) => json<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}`),
  createPlan: (input: {
    project_id: string
    project_name: string
    source_id: string
    source_type: string
    source_name: string
    target: string
    name: string
    intent: string
    patch: Record<string, unknown>
  }) => mutate<SimulationPlan>('/api/plans', input),
  planFormSchema: (input: {
    project_id: string
    project_name: string
    source_id: string
    source_type: string
    source_name: string
    target: string
    patch?: Record<string, unknown>
  }) => mutate<PlanFormSchemaResponse>('/api/plans/form-schema', input),
  assistPlanForm: (input: {
    project_id: string
    project_name: string
    source_id: string
    source_type: string
    source_name: string
    target: string
    intent: string
    prompt: string
    patch?: Record<string, unknown>
  }) => mutate<PlanAssistResponse>('/api/plans/assist', input),
  preflightPlan: (planId: string) =>
    mutate<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/preflight`),
  applyPlanInputs: (planId: string, revision: number, values: Record<string, unknown>) =>
    mutate<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/inputs`, { revision, values }),
  recoverPlan: (planId: string) =>
    mutate<Intervention>(`/api/plans/${encodeURIComponent(planId)}/recover`),
  approvePlan: (planId: string) =>
    mutate<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/approve`),
  runPlan: (planId: string) =>
    mutate<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/run`),
  stageImport: async (form: FormData) => {
    const response = await fetch('/api/imports', { method: 'POST', body: form })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || response.statusText)
    return body as ImportPlan
  },
  listImports: (folderId?: string) => {
    const params = new URLSearchParams()
    if (folderId) params.set('folder_id', folderId)
    return json<ImportPlan[]>(`/api/imports${params.toString() ? `?${params.toString()}` : ''}`)
  },
  approveImport: (id: string) => mutate<ImportPlan>(`/api/imports/${encodeURIComponent(id)}/approve`),
  runImport: (id: string) => mutate<ImportPlan>(`/api/imports/${encodeURIComponent(id)}/run`),
  abortImport: async (id: string) => {
    const response = await fetch(`/api/imports/${encodeURIComponent(id)}`, { method: 'DELETE' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || response.statusText)
    return body
  },
  agentState: () => json<AgentState>('/api/agent/state'),
  planFromAction: (action: AgentAction) =>
    mutate<ActionPlanResult>('/api/agent/plan-from-action', { action }),
  interventions: (projectId?: string, state?: string) => {
    const params = new URLSearchParams()
    if (projectId) params.set('project_id', projectId)
    if (state) params.set('state', state)
    return json<{ interventions: Intervention[] }>(`/api/interventions${params.toString() ? `?${params.toString()}` : ''}`)
  },
  intervention: (id: string) => json<Intervention>(`/api/interventions/${encodeURIComponent(id)}`),
  createIntervention: (input: CreateInterventionInput) =>
    mutate<Intervention>('/api/interventions', input),
  diagnoseIntervention: (id: string) =>
    mutate<Intervention>(`/api/interventions/${encodeURIComponent(id)}/diagnose`),
  generateInterventionProposals: (id: string) =>
    mutate<Intervention>(`/api/interventions/${encodeURIComponent(id)}/proposals`),
  selectInterventionProposal: (id: string, proposalId: string, feedback?: string) =>
    mutate<Intervention>(`/api/interventions/${encodeURIComponent(id)}/select`, { proposal_id: proposalId, feedback }),
  compileInterventionPatch: (id: string, feedback?: string) =>
    mutate<Intervention>(`/api/interventions/${encodeURIComponent(id)}/compile`, { feedback }),
  validateIntervention: (id: string) =>
    mutate<Intervention>(`/api/interventions/${encodeURIComponent(id)}/validate`),
  completeInterventionValidation: (id: string, valid: boolean, errors?: string[]) =>
    mutate<Intervention>(`/api/interventions/${encodeURIComponent(id)}/complete`, { valid, errors }),
  closeIntervention: (id: string) =>
    mutate<Intervention>(`/api/interventions/${encodeURIComponent(id)}/close`),
}
