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

export type ResultColumnSummary = {
  field: string
  kind: 'numeric' | 'text'
  count: number
  missing: number
  unique: number
  minimum?: number
  maximum?: number
  mean?: number
  first?: string
  last?: string
  sample_values?: string[]
}

export type ResultInterpretationRequest = {
  scope: string
  path: string
  fingerprint: string
  language: string
  total_rows: number
  delimiter: string
  columns: ResultColumnSummary[]
  sample_rows: Array<Record<string, string>>
  mode?: 'load' | 'regenerate' | 'ask' | 'clear'
  question?: string
}

export type ResultInterpretationResponse = {
  key: string
  interpretation: string
  messages: ChatMessage[]
  cached: boolean
  provider: string
  model: string
  prompt_version: string
  generated_at: string
  updated_at: string
}

export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatSession = {
  id?: string
  project_id: string
  resource_id?: string
  scope_type?: 'project' | 'resource' | 'draft'
  scope_id?: string
  messages: ChatMessage[]
  created_at?: string
  updated_at?: string
}

export type AICreateResult = {
  project_id: string
  draft_id?: string
  root_resource_id: string
  root_resource_type: string
  blueprint: {
    version: string
    decision: 'generate'
    project_name: string
    summary: string
    geometry: {
      name: string
      unit: 'm'
      representation: string
      format: string
      generator: string
      operations: Array<{ id: string; op: string; params: Record<string, unknown> }>
      result?: string
      results?: Array<{
        source: string
        name: string
        faces?: Array<{ name: string; selector: string }>
      }>
      validated: boolean
      validation: string
    }
    simulation_params: Record<string, unknown>
    assumptions: string[]
    target: string
  }
  simulation_params: Record<string, unknown>
  preflight?: AICreatePreflight
  stages: string[]
  warnings?: string[]
}

export type AICreatePreflight = {
  schema_version: number
  validator_version?: string
  valid: boolean
  issues: PlanPreflight['issues']
  form_schema: DynamicFormSchema
}

export type AICreateClarificationField = {
  id: string
  label: string
  description?: string
  type: 'text' | 'number' | 'select' | 'boolean'
  required: boolean
  unit?: string
  options?: Array<{ value: string; label: string }>
  default?: unknown
  min?: number
  max?: number
}

export type AICreateClarification = {
  status: 'needs_input'
  session_id: string
  message: string
  round: number
  fields: AICreateClarificationField[]
}

export type AICreateProgress = {
  request_id: string
  status: 'running' | 'recovering' | 'needs_input' | 'needs_attention' | 'completed' | 'failed'
  stage: number
  stages: string[]
  detail?: string
  project_id?: string
  resource_id?: string
  session_id?: string
  response?: AICreateResult | AICreateClarification
  started_at: string
  updated_at: string
}

export type STEPValidationReport = {
	 solid_count: number
	 face_count: number
	 volume: number
	 bounds?: number[]
	 kernel: string
	 length_unit?: 'mm' | 'cm' | 'm' | 'inch' | string
	 body_names?: string[]
	 face_names?: string[]
	 face_coverage_checked?: boolean
}

export type STEPVersion = {
	 id: string
	 asset_id: string
	 number: number
	 file_name: string
	 unit: 'm' | 'mm' | 'cm' | 'inch'
	 size: number
	 sha256: string
	 source: 'upload' | 'ai' | string
	 prompt?: string
	 parent_version_id?: string
	 validation: {
		 status: 'validating' | 'ready' | 'blocked'
		 report?: STEPValidationReport
		 error?: string
	 }
	 geometry?: Record<string, unknown>
	 created_at: string
}

export type STEPAsset = {
	 id: string
	 folder_id: string
	 name: string
	 description?: string
	 versions: STEPVersion[]
	 created_at: string
	 updated_at: string
}

export type STEPProjectResult = {
	 project_id: string
	 root_resource_id: string
	 root_resource_type?: string
	 step_asset_id: string
	 step_version_id: string
}

export type STEPAIJob = {
  id: string
  status: 'queued' | 'running' | 'recovering' | 'needs_input' | 'completed' | 'failed' | 'cancelled'
  stage: string
  progress: number
  detail?: string
  request: { prompt: string; name?: string; asset_id?: string; parent_version_id?: string; folder_id?: string }
  asset_id?: string
  version_id?: string
  fields?: AICreateClarificationField[]
  error?: string
  created_at: string
  updated_at: string
}

export type STEPPreviewManifest = import('../components/viewer/LazyViewer3D').ViewerManifest & {
  comparison?: { version_id: string; volume_delta: number; solid_count_delta: number; face_count_delta: number; bounds_delta: number[] }
}

export type AgentProposalField = {
  key: string
  value: unknown
  provenance: 'provided' | 'derived' | 'inferred' | 'defaulted'
  description?: string
}

export type AgentProposal = {
  id: string
  draft_id?: string
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
  kind: 'create-plan' | 'update-draft' | 'request-missing-input'
  message: string
  proposals?: AgentProposal[]
  questions?: AgentQuestion[]
  warnings?: string[]
  assumptions?: string[]
}

export type AgentQuestionOption = {
  value: string
  label: string
}

export type AgentQuestion = {
  field: string
  message: string
  urgency: 'required' | 'recommended' | 'optional' | string
  reason?: string
  type?: 'text' | 'number' | 'select' | 'boolean'
  unit?: string
  options?: AgentQuestionOption[]
  default?: unknown
  recommendation?: string
  min?: number
  max?: number
  placeholder?: string
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

export type ActionPlanContext = {
  project_id: string
  project_name?: string
  source_id?: string
  source_type?: string
  source_name?: string
}

export type FolderNode = {
  id: string
  name: string
  subfolders: FolderNode[]
}

export type FolderTreeResponse = {
  root: FolderNode
}

export type FolderMutationResult = {
  id: string
  name?: string
  parent_id?: string
  deleted?: boolean
  tags?: string[]
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

export type ProjectMutationResult = {
  id?: string
  name?: string
  deleted?: boolean
  message?: string
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

export type DraftRecord = {
  id: string
  name: string
  project_id?: string
  source_id?: string
  source_type?: string
  source_item_id?: string
  source_item_type?: string
  status?: string
  state?: string
  created_at?: string
  updated_at?: string
  case_id?: string
  [key: string]: unknown
}

export type ProjectDraftsResponse = {
  records?: DraftRecord[]
  drafts?: DraftRecord[]
  items?: DraftRecord[]
}

export type ConfiguredDraft = DraftRecord & {
  project_id: string
  source_id: string
  simulation_params: Record<string, unknown>
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

export type SlicePlayerSliceSummary = {
  name: string
  frame_count: number
  first_step?: number
  last_step?: number
  formats: string[]
  fields: string[]
}

export type SlicePlayerJob = {
  id: string
  case_id: string
  result_path: string
  source_size: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  stage: string
  error?: string
  report?: {
    index_version: number
    compressed_bytes: number
    uncompressed_bytes: number
    entry_count: number
    slices: SlicePlayerSliceSummary[]
    formats: string[]
    index_ready: boolean
    playback?: {
      ready: boolean
      frame_count: number
      cache_bytes: number
      topology_bytes: number
      field_bytes: number
      topology_count: number
      fields: string[]
      field_ranges: Record<string, [number, number]>
      bounds: [[number, number, number], [number, number, number]]
      frames: Array<{
        slice: string
        step?: number
        fields: string[]
        field_ranges?: Record<string, [number, number]>
        manifest_path: string
        preview_manifest_path?: string
        vertices: number
        triangles: number
        preview_vertices?: number
        preview_triangles?: number
        bounds: [[number, number, number], [number, number, number]]
      }>
    }
  }
  created_at: string
  updated_at: string
  finished_at?: string
}

export type DraftParameterSchemaResponse = {
  schema_version: number
  validator_version?: string
  source_type: string
  stages: Array<'SurfaceMesh' | 'VolumeMesh' | 'Case'>
  schema: DynamicFormSchema
  baseline: Record<string, unknown>
}

export type DraftParameterValidationResponse = {
  schema_version: number
  validator_version?: string
  valid: boolean
  issues: Array<{ level: string; code: string; path?: string; message: string; stages?: string[] }>
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

export type GeometryTopologyCheck = {
  key: 'free-edges' | 'non-manifold' | 'self-intersections' | 'components' | string
  status: 'ready' | 'warning' | 'blocked' | 'unknown'
  count?: number
  detail: string
  entity_ids?: string[]
}

export type GeometryTopologyReport = {
  status: 'available' | 'partial' | 'unavailable'
  algorithm_version: string
  source: string
  tolerance: number
  tolerance_basis: string
  triangle_count: number
  degenerate_triangle_count: number
  candidate_pair_count: number
  started_at: string
  completed_at: string
  duration_ms: number
  checks: GeometryTopologyCheck[]
  limitations: string[]
}

export type GeometryDiagnosticReport = {
  schema_version: number
  geometry_id: string
  fingerprint: string
  settings: { small_surface_ratio: number; curvature_angle_deg: number; topology_tolerance_ratio?: number }
  capabilities: GeometryDiagnosticCapability[]
  evidence: GeometryDiagnosticEvidence[]
  findings: GeometryDiagnosticFinding[]
  grouping_proposals: GeometryGroupingProposal[]
  topology?: GeometryTopologyReport
}

export type GeometryDiagnosticJob = {
  id: string
  geometry_id: string
  cache_key: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  stage: string
  settings: { small_surface_ratio: number; curvature_angle_deg: number; topology_tolerance_ratio?: number }
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
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'enum' | 'quantity' | 'expression' | 'union' | 'entity_assignment' | 'field_removal' | 'json'
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
  unit_aliases?: Record<string, string>
  value_schema?: DynamicFormSchema
  expected_unit?: string
  expected_dimension?: string
  allow_runtime?: boolean
  wire_discriminator?: { field: string; value: string }
  unit_suggestions?: string[]
  function_suggestions?: string[]
  example?: string
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
  repair_attempts?: number
  auto_repaired?: boolean
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
  progress?: number
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
  artifacts?: Array<{
    name?: string
    path: string
    file_type?: string
    size_bytes?: number
    category: 'residuals' | 'forces' | 'monitors' | 'flow-fields' | 'other' | string
    previewable: boolean
    visualization: boolean
  }>
  visualization: {
    available: boolean
    result_paths?: string[]
    output_count?: number
  }
}

export type CompareResult = {
  cases: CaseComparison[]
  diffs: Array<{ path: string; baseline: unknown; other: unknown; compared_to?: string }>
  ranking?: Array<{ id: string; name: string; score: number; reason: string }>
}

export type ComparisonAnalysis = {
  analysis: string
  provider: string
  model: string
}

export type CompareWorkspaceParticipant = {
  project_id: string
  project_name_snapshot?: string
  case_id: string
  case_name_snapshot: string
  role: 'baseline' | 'candidate'
  position: number
  availability: 'available' | 'deleted' | 'inaccessible' | 'unavailable'
}

export type CompareWorkspaceAISession = {
  id: string
  evidence_revision_id: string
  question?: string
  analysis: string
  provider?: string
  model?: string
  created_at: string
}

export type CompareWorkspaceViewState = {
  active_view?: 'evidence' | 'visual' | 'files' | 'parameters' | 'sweep'
  visual_candidate_id?: string
  selected_field?: string | null
  field_visualization_enabled?: boolean
  wireframe?: boolean
  camera_sync?: { sourceId: string; state: ViewerCameraStateJSON } | null
  manifest_selection?: { sourceId: string; item: { id: string; name: string; path?: string[] } | null } | null
  parameter_expansions?: Record<string, Record<string, boolean>>
  selected_result_path?: string | null
  visual_visibility?: Record<string, Record<string, boolean>>
  selected_revision_id?: string
}

export type ViewerCameraStateJSON = {
  position: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  zoom: number
}

export type CompareWorkspace = {
  schema_version?: number
  id: string
  name: string
  status: string
  participants: CompareWorkspaceParticipant[]
  active_revision_id?: string
  revisions?: Array<{ id: string; number: number; snapshot: CompareResult; participants?: CompareWorkspaceParticipant[]; created_at: string }>
  view_state?: CompareWorkspaceViewState
  ai_sessions?: CompareWorkspaceAISession[]
  created_at?: string
  updated_at: string
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

export type InterventionClarificationRecord = {
  answers: Record<string, unknown>
  summary: string
  created_at: string
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
  clarification_message?: string
  pending_questions?: AgentQuestion[]
  clarification_history?: InterventionClarificationRecord[]
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

async function replace<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || payload.message || response.statusText)
  return payload as T
}

async function partialUpdate<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export function importPlanRequestPath(form: FormData): string {
  const params = new URLSearchParams()
  for (const key of ['name', 'source_type', 'unit', 'workflow', 'solver_version', 'folder_id', 'tags']) {
    const value = form.get(key)
    if (typeof value === 'string' && value.trim()) params.set(key, value.trim())
  }
  return `/api/imports${params.size ? `?${params.toString()}` : ''}`
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
  createFolder: (input: { name: string; parent_folder_id: string; tags?: string[] }) =>
    mutate<FolderMutationResult>('/api/flow360/folders', input),
  renameFolder: (folderId: string, name: string) =>
    replace<FolderMutationResult>(`/api/flow360/folders/${encodeURIComponent(folderId)}/name`, { name }),
  moveFolder: (folderId: string, parentFolderId: string) =>
    replace<FolderMutationResult>(`/api/flow360/folders/${encodeURIComponent(folderId)}/parent`, {
      parent_folder_id: parentFolderId,
    }),
  deleteFolder: (folderId: string, confirmed: boolean) =>
    remove<FolderMutationResult>(
      `/api/flow360/folders/${encodeURIComponent(folderId)}?confirmed=${confirmed ? 'true' : 'false'}`,
    ),
  renameProject: (projectId: string, name: string) =>
    replace<ProjectMutationResult>(`/api/flow360/projects/${encodeURIComponent(projectId)}/name`, { name }),
  deleteProject: (projectId: string, confirmed: boolean) =>
    remove<ProjectMutationResult>(
      `/api/flow360/projects/${encodeURIComponent(projectId)}?confirmed=${confirmed ? 'true' : 'false'}`,
    ),
  projectInfo: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectInfo>(`/api/flow360/projects/${encodeURIComponent(projectId)}${cacheOnly ? '?cache=only' : ''}`),
  projectTree: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectTreeResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/tree${cacheOnly ? '?cache=only' : ''}`),
  projectItems: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectItemsResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/items${cacheOnly ? '?cache=only' : ''}`),
  projectDrafts: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectDraftsResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/drafts${cacheOnly ? '?cache=only' : ''}`),
  createConfiguredDraft: (projectId: string, input: {
    source_id: string
    name: string
    patch?: Record<string, unknown>
    simulation_params?: Record<string, unknown>
  }) =>
    mutate<ConfiguredDraft>(`/api/flow360/projects/${encodeURIComponent(projectId)}/drafts`, input),
  renameDraft: (draftId: string, name: string, projectId?: string) =>
    replace<DraftRecord>(`/api/flow360/drafts/${encodeURIComponent(draftId)}/name`, { name, project_id: projectId }),
  deleteDraft: (draftId: string, confirmed: boolean, projectId?: string) =>
    remove<DraftRecord>(`/api/flow360/drafts/${encodeURIComponent(draftId)}?confirmed=${confirmed ? 'true' : 'false'}${projectId ? `&project_id=${encodeURIComponent(projectId)}` : ''}`),
  draftParameterSchema: (draftId: string) =>
    json<DraftParameterSchemaResponse>(`/api/flow360/drafts/${encodeURIComponent(draftId)}/parameters/schema`),
  validateDraftParameters: (draftId: string, simulationParams: Record<string, unknown>, paths: string[] = []) =>
    mutate<DraftParameterValidationResponse>(
      `/api/flow360/drafts/${encodeURIComponent(draftId)}/parameters/validate`,
      { simulation_params: simulationParams, paths },
    ),
  updateDraftParameters: (draftId: string, simulationParams: Record<string, unknown>, projectId?: string) =>
    replace<{ simulation_params: Record<string, unknown> }>(
      `/api/flow360/drafts/${encodeURIComponent(draftId)}/parameters${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`,
      { simulation_params: simulationParams },
    ),
  patchDraftParameters: (draftId: string, patch: Record<string, unknown>, projectId?: string) =>
    partialUpdate<{ simulation_params: Record<string, unknown> }>(
      `/api/flow360/drafts/${encodeURIComponent(draftId)}/parameters${projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''}`,
      { patch },
    ),
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
  latestGeometryDiagnosticsJob: async (resourceId: string) => {
    const response = await fetch(
      `/api/flow360/resources/Geometry/${encodeURIComponent(resourceId)}/diagnostics/jobs/latest`,
    )
    if (response.status === 404) return null
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || response.statusText)
    return body as GeometryDiagnosticJob
  },
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
  startSlicePlayer: (caseId: string, resultPath: string, sizeBytes = 0) =>
    mutate<SlicePlayerJob>(
      `/api/flow360/resources/Case/${encodeURIComponent(caseId)}/slice-player/jobs`,
      { result_path: resultPath, size_bytes: sizeBytes },
    ),
  latestSlicePlayer: (caseId: string, resultPath?: string) =>
    json<SlicePlayerJob>(
      `/api/flow360/resources/Case/${encodeURIComponent(caseId)}/slice-player/jobs/latest${resultPath ? `?result_path=${encodeURIComponent(resultPath)}` : ''}`,
    ),
  slicePlayerJob: (caseId: string, jobId: string) =>
    json<SlicePlayerJob>(
      `/api/flow360/resources/Case/${encodeURIComponent(caseId)}/slice-player/jobs/${encodeURIComponent(jobId)}`,
    ),
  cancelSlicePlayer: (caseId: string, jobId: string) =>
    remove<SlicePlayerJob>(
      `/api/flow360/resources/Case/${encodeURIComponent(caseId)}/slice-player/jobs/${encodeURIComponent(jobId)}`,
    ),
  compareCases: (caseIds: string[]) =>
    mutate<CompareResult>('/api/flow360/compare', { case_ids: caseIds, baseline: caseIds[0] }),
  analyzeCaseComparison: (caseIds: string[], language: string, question?: string) =>
    mutate<ComparisonAnalysis>('/api/flow360/compare/analyze', {
      case_ids: caseIds,
      baseline: caseIds[0],
      language,
      question,
    }),
  compareWorkspaces: () => json<{ workspaces: CompareWorkspace[] }>('/api/compare-workspaces'),
  compareWorkspace: (compareId: string) => json<CompareWorkspace>(`/api/compare-workspaces/${encodeURIComponent(compareId)}`),
  createCompareWorkspace: (input: {
    name: string
    participants: Array<Pick<CompareWorkspaceParticipant, 'project_id' | 'project_name_snapshot' | 'case_id' | 'case_name_snapshot'>>
    view_state?: CompareWorkspaceViewState
  }) => mutate<CompareWorkspace>('/api/compare-workspaces', input),
  updateCompareWorkspaceViewState: (compareId: string, viewState: CompareWorkspaceViewState) =>
    replace<CompareWorkspace>(`/api/compare-workspaces/${encodeURIComponent(compareId)}/view-state`, { view_state: viewState }),
  appendCompareWorkspaceAISession: (compareId: string, input: Omit<CompareWorkspaceAISession, 'id' | 'created_at'>) =>
    mutate<CompareWorkspaceAISession>(`/api/compare-workspaces/${encodeURIComponent(compareId)}/ai-sessions`, input),
  analyzeCompareWorkspaceRevision: (compareId: string, input: { evidence_revision_id: string; language: string; question?: string }) =>
    mutate<ComparisonAnalysis & { session: CompareWorkspaceAISession }>(`/api/compare-workspaces/${encodeURIComponent(compareId)}/analyze`, input),
  refreshCompareWorkspaceEvidence: (compareId: string) =>
    mutate<CompareWorkspace>(`/api/compare-workspaces/${encodeURIComponent(compareId)}/refresh`, {}),
  replaceCompareWorkspaceParticipants: (compareId: string, participants: Array<Pick<CompareWorkspaceParticipant, 'project_id' | 'project_name_snapshot' | 'case_id' | 'case_name_snapshot'>>) =>
    replace<CompareWorkspace>(`/api/compare-workspaces/${encodeURIComponent(compareId)}/participants`, { participants }),
  updateCompareWorkspaceStatus: (compareId: string, status: 'active' | 'archived') =>
    replace<CompareWorkspace>(`/api/compare-workspaces/${encodeURIComponent(compareId)}/status`, { status }),
  duplicateCompareWorkspace: (compareId: string, name?: string) =>
    mutate<CompareWorkspace>(`/api/compare-workspaces/${encodeURIComponent(compareId)}/duplicate`, { name: name ?? '' }),
  deleteCompareWorkspace: (compareId: string) =>
    remove<void>(`/api/compare-workspaces/${encodeURIComponent(compareId)}`),
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
    draft_id?: string
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
    draft_id?: string
    target: string
    patch?: Record<string, unknown>
  }) => mutate<PlanFormSchemaResponse>('/api/plans/form-schema', input),
  assistPlanForm: (input: {
    project_id: string
    project_name: string
    source_id: string
    source_type: string
    source_name: string
    draft_id?: string
    target: string
    intent: string
    prompt: string
    patch?: Record<string, unknown>
    confirmed_inputs?: Record<string, unknown>
    autonomous?: boolean
  }) => mutate<PlanAssistResponse>('/api/plans/assist', input),
  preflightPlan: (planId: string) =>
    mutate<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/preflight`),
  updatePlanParameters: (planId: string, revision: number, values: Record<string, unknown>) =>
    replace<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/parameters`, { revision, values }),
  applyPlanInputs: (planId: string, revision: number, values: Record<string, unknown>) =>
    mutate<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/inputs`, { revision, values }),
  recoverPlan: (planId: string) =>
    mutate<Intervention>(`/api/plans/${encodeURIComponent(planId)}/recover`),
  approvePlan: (planId: string) =>
    mutate<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/approve`),
  runPlan: (planId: string) =>
    mutate<SimulationPlan>(`/api/plans/${encodeURIComponent(planId)}/run`),
  stageImport: async (form: FormData) => {
    const response = await fetch(importPlanRequestPath(form), { method: 'POST', body: form })
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
  runImport: (id: string, sync = false) => mutate<ImportPlan>(`/api/imports/${encodeURIComponent(id)}/run${sync ? '?sync=true' : ''}`),
  stepAssets: () => json<{ assets: STEPAsset[]; folder_root: FolderNode }>('/api/step-assets'),
  createSTEPFolder: (name: string, parentId: string) => mutate<FolderMutationResult>('/api/step-assets/folders', { name, parent_id: parentId }),
  renameSTEPFolder: (folderId: string, name: string) => partialUpdate<FolderMutationResult>(`/api/step-assets/folders/${encodeURIComponent(folderId)}`, { name }),
  moveSTEPFolder: (folderId: string, parentId: string) => partialUpdate<FolderMutationResult>(`/api/step-assets/folders/${encodeURIComponent(folderId)}`, { parent_id: parentId }),
  deleteSTEPFolder: async (folderId: string) => {
    const response = await fetch(`/api/step-assets/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || response.statusText)
    return body as { deleted: boolean }
  },
  moveSTEPAsset: (assetId: string, folderId: string) => partialUpdate<STEPAsset>(`/api/step-assets/${encodeURIComponent(assetId)}/folder`, { folder_id: folderId }),
  uploadSTEPAsset: async (form: FormData, assetId?: string) => {
    const path = assetId
      ? `/api/step-assets/${encodeURIComponent(assetId)}/versions`
      : '/api/step-assets'
    const response = await fetch(path, { method: 'POST', body: form })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || response.statusText)
    return body as { asset: STEPAsset; version: STEPVersion }
  },
  aiDesignSTEPAsset: (input: { prompt: string; name?: string; asset_id?: string; parent_version_id?: string; folder_id?: string }) =>
    mutate<STEPAIJob>('/api/step-assets/ai-design', input),
  stepAIJob: (jobId: string) => json<STEPAIJob>(`/api/step-assets/ai-jobs/${encodeURIComponent(jobId)}`),
  cancelStepAIJob: async (jobId: string) => {
    const response = await fetch(`/api/step-assets/ai-jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || response.statusText)
    return body as STEPAIJob
  },
  validateSTEPVersion: (assetId: string, versionId: string) =>
    mutate<STEPVersion>(`/api/step-assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/validate`),
  stepVersionDownloadURL: (assetId: string, versionId: string) =>
    `/api/step-assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/download`,
  stepVersionThumbnailURL: (assetId: string, versionId: string) =>
    `/api/step-assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/thumbnail.svg`,
  stepVersionPreview: (assetId: string, versionId: string, compareVersionId?: string) => {
    const params = compareVersionId ? `?compare_version_id=${encodeURIComponent(compareVersionId)}` : ''
    return json<STEPPreviewManifest>(`/api/step-assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/preview${params}`)
  },
  createProjectFromSTEP: (assetId: string, versionId: string, folderId: string, name?: string) =>
    mutate<STEPProjectResult>(
      `/api/step-assets/${encodeURIComponent(assetId)}/versions/${encodeURIComponent(versionId)}/create-project`,
      { folder_id: folderId, name },
    ),
  aiCreate: async (intent: string, folderId: string, sessionId?: string, answers?: Record<string, unknown>, requestId?: string, stepSource?: { asset_id: string; version_id: string }) => {
    const response = await fetch('/api/ai-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent, folder_id: folderId, session_id: sessionId, answers, request_id: requestId, step_asset_id: stepSource?.asset_id, step_version_id: stepSource?.version_id }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const questions = Array.isArray(body.questions) ? body.questions.join(' ') : ''
      throw new Error([body.error || response.statusText, questions].filter(Boolean).join(' '))
    }
    return body as AICreateResult | AICreateClarification
  },
  aiCreateProgress: (requestId: string) =>
    json<AICreateProgress>(`/api/ai-create/progress/${encodeURIComponent(requestId)}`),
  abortImport: async (id: string) => {
    const response = await fetch(`/api/imports/${encodeURIComponent(id)}`, { method: 'DELETE' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error || response.statusText)
    return body
  },
  agentState: () => json<AgentState>('/api/agent/state'),
  interpretResult: (input: ResultInterpretationRequest) =>
    mutate<ResultInterpretationResponse>('/api/agent/interpret-result', input),
  agentChatSession: (projectId: string, scopeType: 'project' | 'resource' | 'draft', scopeId?: string, resourceId?: string) => {
    const params = new URLSearchParams({ project_id: projectId })
    params.set('scope_type', scopeType)
    if (scopeId) params.set('scope_id', scopeId)
    if (resourceId) params.set('resource_id', resourceId)
    return json<ChatSession>(`/api/agent/chat/session?${params.toString()}`)
  },
  planFromAction: (action: AgentAction, context?: ActionPlanContext) =>
    mutate<ActionPlanResult>('/api/agent/plan-from-action', { action, ...context }),
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
  answerInterventionQuestions: (id: string, answers: Record<string, unknown>) =>
    mutate<Intervention>(`/api/interventions/${encodeURIComponent(id)}/answers`, { answers }),
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
