import { describe, expect, it, vi } from 'vitest'
import { VIEWER_ANNOTATION_SCHEMA_VERSION, type ViewerAnnotation } from '../lib/viewer-tools/types'
import {
  ProjectAnnotationsController,
  type ProjectAnnotationsApi,
} from './useProjectAnnotations'

type Result = { distance: number }

function annotation(projectId: string, id = `${projectId}-annotation`): ViewerAnnotation<Result> {
  const resourceRef = { id: `${projectId}-mesh`, type: 'surface-mesh' }
  return {
    schemaVersion: VIEWER_ANNOTATION_SCHEMA_VERSION,
    id,
    projectId,
    resourceRef,
    coordinateFrame: { kind: 'asset-local', resourceRef },
    toolId: 'distance',
    name: 'Distance',
    points: [],
    result: { distance: 2 },
    style: {},
    visible: true,
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function api(overrides: Partial<ProjectAnnotationsApi<Result>> = {}): ProjectAnnotationsApi<Result> {
  return {
    list: vi.fn(async (projectId) => [annotation(projectId)]),
    create: vi.fn(async (projectId) => annotation(projectId, 'created')),
    patch: vi.fn(async (projectId, annotationId, input) => ({
      ...annotation(projectId, annotationId),
      ...input,
    })),
    delete: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('ProjectAnnotationsController', () => {
  it('clears the old project immediately, aborts its request and ignores its late response', async () => {
    const first = deferred<ViewerAnnotation<Result>[]>()
    const second = deferred<ViewerAnnotation<Result>[]>()
    const signals: AbortSignal[] = []
    const mockApi = api({
      list: vi.fn((projectId, options) => {
        signals.push(options?.signal as AbortSignal)
        return projectId === 'project-a' ? first.promise : second.promise
      }),
    })
    const controller = new ProjectAnnotationsController(mockApi)

    const loadingA = controller.setProject('project-a')
    expect(controller.getSnapshot()).toMatchObject({ projectId: 'project-a', annotations: [], loading: true })
    const loadingB = controller.setProject('project-b')
    expect(signals[0].aborted).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      projectId: 'project-b',
      annotations: [],
      activeDraft: null,
      loading: true,
    })

    first.resolve([annotation('project-a')])
    second.resolve([annotation('project-b')])
    await Promise.all([loadingA, loadingB])
    expect(controller.getSnapshot().annotations.map(({ projectId }) => projectId)).toEqual(['project-b'])
  })

  it('does not admit a foreign-project annotation into the project-scoped cache', async () => {
    const controller = new ProjectAnnotationsController(api({
      list: vi.fn(async () => [annotation('project-a'), annotation('project-b')]),
    }))

    await controller.setProject('project-b')

    expect(controller.getSnapshot().queryKey).toEqual(['project-annotations', 'project-b'])
    expect(controller.getSnapshot().annotations.map(({ projectId }) => projectId)).toEqual(['project-b'])
    expect(controller.getCached('project-a')).toEqual([])
  })

  it('restarts an aborted same-project load during a StrictMode-style effect remount', async () => {
    const first = deferred<ViewerAnnotation<Result>[]>()
    const list = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce([annotation('project-a')])
    const controller = new ProjectAnnotationsController(api({ list }))

    const abandoned = controller.setProject('project-a')
    controller.dispose()
    await controller.setProject('project-a')
    await abandoned

    expect(list).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot()).toMatchObject({ loading: false, error: null })
    expect(controller.getSnapshot().annotations).toHaveLength(1)
  })

  it('supports an empty result and retries a failed query', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce([])
    const controller = new ProjectAnnotationsController(api({ list }))

    await controller.setProject('project-a')
    expect(controller.getSnapshot()).toMatchObject({
      annotations: [],
      loading: false,
      error: 'network unavailable',
    })

    await controller.retry()
    expect(controller.getSnapshot()).toMatchObject({ annotations: [], loading: false, error: null })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('rolls back optimistic visibility and rename patches when persistence fails', async () => {
    const patch = deferred<ViewerAnnotation<Result>>()
    const controller = new ProjectAnnotationsController(api({ patch: vi.fn(() => patch.promise) }))
    await controller.setProject('project-a')

    const saving = controller.updateAnnotation('project-a-annotation', {
      name: 'Renamed',
      visible: false,
    })
    expect(controller.getSnapshot().annotations[0]).toMatchObject({ name: 'Renamed', visible: false })
    expect(controller.getSnapshot().savingIds).toContain('project-a-annotation')
    patch.reject(new Error('save failed'))

    await expect(saving).resolves.toBe(false)
    expect(controller.getSnapshot().annotations[0]).toMatchObject({ name: 'Distance', visible: true })
    expect(controller.getSnapshot()).toMatchObject({ error: 'save failed', savingIds: [] })
  })

  it('rolls back an optimistic delete at its original position', async () => {
    const remove = deferred<void>()
    const controller = new ProjectAnnotationsController(api({
      list: vi.fn(async () => [annotation('project-a', 'first'), annotation('project-a', 'second')]),
      delete: vi.fn(() => remove.promise),
    }))
    await controller.setProject('project-a')

    const saving = controller.remove('first')
    expect(controller.getSnapshot().annotations.map(({ id }) => id)).toEqual(['second'])
    remove.reject(new Error('delete failed'))
    await saving

    expect(controller.getSnapshot().annotations.map(({ id }) => id)).toEqual(['first', 'second'])
  })

  it('creates an annotation and clears the active draft after persistence', async () => {
    const controller = new ProjectAnnotationsController(api({ list: vi.fn(async () => []) }))
    await controller.setProject('project-a')
    controller.setActiveDraft(annotation('project-a', 'draft'))

    const created = await controller.create({
      schemaVersion: VIEWER_ANNOTATION_SCHEMA_VERSION,
      resourceRef: { id: 'mesh', type: 'surface-mesh' },
      coordinateFrame: { kind: 'world' },
      toolId: 'distance',
      points: [],
      result: { distance: 2 },
      style: {},
    })

    expect(created?.id).toBe('created')
    expect(controller.getSnapshot().activeDraft).toBeNull()
    expect(controller.getSnapshot().annotations).toHaveLength(1)
  })
})
