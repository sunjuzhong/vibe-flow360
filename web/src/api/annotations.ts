import {
  parseViewerAnnotation,
  type JsonValue,
  type ViewerAnnotation,
} from '../lib/viewer-tools'

export type CreateAnnotationInput<TResult extends JsonValue = JsonValue> = Pick<
  ViewerAnnotation<TResult>,
  | 'schemaVersion'
  | 'resourceRef'
  | 'coordinateFrame'
  | 'toolId'
  | 'points'
  | 'result'
  | 'style'
> & {
  readonly name?: string
  readonly visible?: boolean
}

export interface PatchAnnotationInput<TResult extends JsonValue = JsonValue> {
  readonly name?: string
  readonly style?: Readonly<Record<string, JsonValue>>
  readonly visible?: boolean
  readonly points?: ReadonlyArray<ViewerAnnotation<TResult>['points'][number]>
  readonly result?: TResult
}

export class AnnotationApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code = 'unknown_error') {
    super(message)
    this.name = 'AnnotationApiError'
    this.status = status
    this.code = code
  }
}

interface AnnotationErrorPayload {
  readonly error?: string
  readonly message?: string
  readonly code?: string
}

function projectPath(projectId: string): string {
  if (!projectId.trim()) throw new Error('projectId is required')
  return `/api/projects/${encodeURIComponent(projectId)}/annotations`
}

function annotationPath(projectId: string, annotationId: string): string {
  if (!annotationId.trim()) throw new Error('annotationId is required')
  return `${projectPath(projectId)}/${encodeURIComponent(annotationId)}`
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    if (!response.ok) return { error: text }
    throw new AnnotationApiError('Annotation API returned invalid JSON', response.status, 'invalid_response')
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, init)
  const payload = await parseResponseBody(response)
  if (!response.ok) {
    const error = (typeof payload === 'object' && payload !== null
      ? payload
      : {}) as AnnotationErrorPayload
    throw new AnnotationApiError(
      error.error || error.message || response.statusText || 'Annotation request failed',
      response.status,
      error.code,
    )
  }
  return payload
}

function jsonRequest(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export async function listAnnotations<TResult extends JsonValue = JsonValue>(
  projectId: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ViewerAnnotation<TResult>[]> {
  const payload = await request(projectPath(projectId), { signal: options.signal })
  if (typeof payload !== 'object' || payload === null ||
    !Array.isArray((payload as { annotations?: unknown }).annotations)) {
    throw new AnnotationApiError('Annotation list response is invalid', 200, 'invalid_response')
  }
  return (payload as { annotations: unknown[] }).annotations
    .map((value) => parseViewerAnnotation<TResult>(value))
}

export async function getAnnotation<TResult extends JsonValue = JsonValue>(
  projectId: string,
  annotationId: string,
): Promise<ViewerAnnotation<TResult>> {
  return parseViewerAnnotation<TResult>(await request(annotationPath(projectId, annotationId)))
}

export async function createAnnotation<TResult extends JsonValue = JsonValue>(
  projectId: string,
  input: CreateAnnotationInput<TResult>,
): Promise<ViewerAnnotation<TResult>> {
  return parseViewerAnnotation<TResult>(await request(
    projectPath(projectId),
    jsonRequest('POST', input),
  ))
}

export async function patchAnnotation<TResult extends JsonValue = JsonValue>(
  projectId: string,
  annotationId: string,
  input: PatchAnnotationInput<TResult>,
): Promise<ViewerAnnotation<TResult>> {
  return parseViewerAnnotation<TResult>(await request(
    annotationPath(projectId, annotationId),
    jsonRequest('PATCH', input),
  ))
}

export async function deleteAnnotation(projectId: string, annotationId: string): Promise<void> {
  await request(annotationPath(projectId, annotationId), { method: 'DELETE' })
}

export const annotationsApi = {
  list: listAnnotations,
  get: getAnnotation,
  create: createAnnotation,
  patch: patchAnnotation,
  delete: deleteAnnotation,
}
