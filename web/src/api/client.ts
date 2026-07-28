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
  mode: 'ai' | 'local-planner'
  model: string
  ready: boolean
  execution: boolean
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
  differences: PlanDifference[]
  validations: PlanValidation[]
  command_preview: string[]
  status: 'draft' | 'approved' | 'running' | 'submitted' | 'failed'
  approved_at?: string
  started_at?: string
  completed_at?: string
  result?: Record<string, unknown>
  error?: string
  created_at: string
  updated_at: string
}

export type ImportPlan = {
  id: string; name: string; source_type: string; unit: string; workflow: string
  files: string[]; size_bytes: number; status: string; command_preview: string[]
  error?: string; result?: Record<string, unknown>
}

async function json<T>(path: string): Promise<T> {
  const response = await fetch(path)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || response.statusText)
  return body as T
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

export const api = {
  flow360Status: () => json<Flow360Status>('/api/flow360/status'),
  projects: (folderId?: string) =>
    json<ProjectListResponse>(`/api/flow360/projects${folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ''}`),
  folders: () => json<FolderTreeResponse>('/api/flow360/folders'),
  projectInfo: (projectId: string) =>
    json<ProjectInfo>(`/api/flow360/projects/${encodeURIComponent(projectId)}`),
  projectTree: (projectId: string) =>
    json<ProjectTreeResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/tree`),
  projectItems: (projectId: string) =>
    json<ProjectItemsResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/items`),
  resourceDetail: (resourceType: string, resourceId: string) =>
    json<ResourceDetail>(
      `/api/flow360/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
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
  plans: (projectId: string, sourceId?: string) =>
    json<{ plans: SimulationPlan[] }>(
      `/api/plans?project_id=${encodeURIComponent(projectId)}${sourceId ? `&source_id=${encodeURIComponent(sourceId)}` : ''}`,
    ),
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
  approveImport: (id: string) => mutate<ImportPlan>(`/api/imports/${encodeURIComponent(id)}/approve`),
  runImport: (id: string) => mutate<ImportPlan>(`/api/imports/${encodeURIComponent(id)}/run`),
  agentState: () => json<AgentState>('/api/agent/state'),
}
