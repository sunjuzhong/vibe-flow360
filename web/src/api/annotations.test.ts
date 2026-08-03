import { afterEach, describe, expect, it, vi } from 'vitest'
import { VIEWER_ANNOTATION_SCHEMA_VERSION, type ViewerAnnotation } from '../lib/viewer-tools'
import {
  AnnotationApiError,
  createAnnotation,
  deleteAnnotation,
  getAnnotation,
  listAnnotations,
  patchAnnotation,
} from './annotations'

type DistanceResult = { readonly distance: number }

function annotation(projectId = 'project/a'): ViewerAnnotation<DistanceResult> {
  const resourceRef = { id: 'geo-1', type: 'Geometry' }
  const coordinateFrame = { kind: 'asset-local' as const, resourceRef }
  const point = {
    localPosition: [0, 0, 0] as const,
    worldPosition: [10, 0, 0] as const,
    projectId,
    resourceRef,
    coordinateFrame,
    snap: { type: 'surface' as const },
  }
  return {
    schemaVersion: VIEWER_ANNOTATION_SCHEMA_VERSION,
    id: 'ann/1',
    projectId,
    resourceRef,
    coordinateFrame,
    toolId: 'distance',
    name: 'Clearance',
    points: [point],
    result: { distance: 2 },
    style: { color: '#fff' },
    visible: true,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('annotation API client', () => {
  it('lists and gets annotations with encoded project and annotation IDs', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ annotations: [annotation()] }))
      .mockResolvedValueOnce(jsonResponse(annotation()))
    vi.stubGlobal('fetch', fetchMock)

    await expect(listAnnotations<DistanceResult>('project/a')).resolves.toEqual([annotation()])
    await expect(getAnnotation<DistanceResult>('project/a', 'ann/1')).resolves.toEqual(annotation())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects/project%2Fa/annotations')
    expect(fetchMock.mock.calls[1][0]).toBe('/api/projects/project%2Fa/annotations/ann%2F1')
  })

  it('passes an AbortSignal through list requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ annotations: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await listAnnotations('project-a', { signal: controller.signal })

    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-a/annotations', {
      signal: controller.signal,
    })
  })

  it('creates and patches with typed JSON requests', async () => {
    const created = annotation('project-a')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(created, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ ...created, visible: false }))
    vi.stubGlobal('fetch', fetchMock)

    await createAnnotation<DistanceResult>('project-a', {
      schemaVersion: created.schemaVersion,
      resourceRef: created.resourceRef,
      coordinateFrame: created.coordinateFrame,
      toolId: created.toolId,
      points: created.points,
      result: created.result,
      style: created.style,
      visible: true,
    })
    await patchAnnotation('project-a', created.id, { visible: false })

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ visible: false })
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
  })

  it('accepts a successful empty DELETE response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteAnnotation('project-a', 'ann-1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project-a/annotations/ann-1', {
      method: 'DELETE',
    })
  })

  it('preserves structured server errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(
      { error: 'annotation not found', code: 'not_found' },
      { status: 404, statusText: 'Not Found' },
    )))

    const error = await getAnnotation('project-a', 'missing').catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(AnnotationApiError)
    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'annotation not found' })
  })

  it('rejects malformed successful responses and invalid local IDs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ annotations: {} })))
    await expect(listAnnotations('project-a')).rejects.toMatchObject({ code: 'invalid_response' })
    await expect(getAnnotation('', 'ann-1')).rejects.toThrow('projectId is required')
    await expect(getAnnotation('project-a', '')).rejects.toThrow('annotationId is required')
  })
})
