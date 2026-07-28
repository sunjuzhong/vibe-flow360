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

export type Flow360DataResponse<T> = {
  data: T
  source: 'live' | 'cache'
  cachedAt?: string
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
  status: 'draft' | 'approved' | 'running' | 'submitted' | 'failed' | 'reconciling'
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
  flow360Status: () => json<Flow360Status>('/api/flow360/status'),
  projects: (folderId?: string, cacheOnly = false) =>
    flow360JSON<ProjectListResponse>(`/api/flow360/projects${folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ''}${cacheOnly ? '?cache=only' : ''}`),
  folders: (cacheOnly = false) =>
    flow360JSON<FolderTreeResponse>(`/api/flow360/folders${cacheOnly ? '?cache=only' : ''}`),
  projectInfo: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectInfo>(`/api/flow360/projects/${encodeURIComponent(projectId)}${cacheOnly ? '?cache=only' : ''}`),
  projectTree: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectTreeResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/tree${cacheOnly ? '?cache=only' : ''}`),
  projectItems: (projectId: string, cacheOnly = false) =>
    flow360JSON<ProjectItemsResponse>(`/api/flow360/projects/${encodeURIComponent(projectId)}/items${cacheOnly ? '?cache=only' : ''}`),
  resourceDetail: (resourceType: string, resourceId: string, cacheOnly = false) =>
    flow360JSON<ResourceDetail>(
      `/api/flow360/resources/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}${cacheOnly ? '?cache=only' : ''}`,
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
}
