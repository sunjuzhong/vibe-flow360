import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  annotationsApi,
  type CreateAnnotationInput,
  type PatchAnnotationInput,
} from '../api/annotations'
import type { JsonValue, ViewerAnnotation } from '../lib/viewer-tools/types'

const CREATE_SAVING_KEY = '$create'

export interface ProjectAnnotationsApi<TResult extends JsonValue = JsonValue> {
  list(projectId: string, options?: { signal?: AbortSignal }): Promise<ViewerAnnotation<TResult>[]>
  create(projectId: string, input: CreateAnnotationInput<TResult>): Promise<ViewerAnnotation<TResult>>
  patch(
    projectId: string,
    annotationId: string,
    input: PatchAnnotationInput,
  ): Promise<ViewerAnnotation<TResult>>
  delete(projectId: string, annotationId: string): Promise<void>
}

export interface ProjectAnnotationsSnapshot<TResult extends JsonValue = JsonValue> {
  readonly projectId: string
  readonly queryKey: readonly ['project-annotations', string]
  readonly annotations: readonly ViewerAnnotation<TResult>[]
  readonly activeDraft: ViewerAnnotation<TResult> | null
  readonly loading: boolean
  readonly error: string | null
  readonly savingIds: readonly string[]
}

export interface ProjectAnnotationsModel<TResult extends JsonValue = JsonValue>
  extends ProjectAnnotationsSnapshot<TResult> {
  readonly saving: boolean
  readonly retry: () => Promise<void>
  readonly create: (input: CreateAnnotationInput<TResult>) => Promise<ViewerAnnotation<TResult> | null>
  readonly update: (annotationId: string, input: PatchAnnotationInput) => Promise<boolean>
  readonly rename: (annotationId: string, name: string) => Promise<boolean>
  readonly setVisible: (annotationId: string, visible: boolean) => Promise<boolean>
  readonly remove: (annotationId: string) => Promise<boolean>
  readonly setActiveDraft: (draft: ViewerAnnotation<TResult> | null) => void
}

const defaultApi: ProjectAnnotationsApi = {
  list: (projectId, options) => annotationsApi.list(projectId, options),
  create: (projectId, input) => annotationsApi.create(projectId, input),
  patch: (projectId, annotationId, input) => annotationsApi.patch(projectId, annotationId, input),
  delete: (projectId, annotationId) => annotationsApi.delete(projectId, annotationId),
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function aborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export class ProjectAnnotationsController<TResult extends JsonValue = JsonValue> {
  private readonly listeners = new Set<() => void>()
  private readonly cache = new Map<string, readonly ViewerAnnotation<TResult>[]>()
  private readonly mutationTokens = new Map<string, symbol>()
  private request: AbortController | null = null
  private generation = 0
  private snapshot: ProjectAnnotationsSnapshot<TResult>

  constructor(private readonly api: ProjectAnnotationsApi<TResult> = defaultApi as ProjectAnnotationsApi<TResult>) {
    this.snapshot = this.emptySnapshot('')
  }

  private emptySnapshot(projectId: string): ProjectAnnotationsSnapshot<TResult> {
    return {
      projectId,
      queryKey: ['project-annotations', projectId],
      annotations: [],
      activeDraft: null,
      loading: false,
      error: null,
      savingIds: [],
    }
  }

  getSnapshot = (): ProjectAnnotationsSnapshot<TResult> => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(next: ProjectAnnotationsSnapshot<TResult>): void {
    this.snapshot = next
    this.listeners.forEach((listener) => listener())
  }

  private update(patch: Partial<ProjectAnnotationsSnapshot<TResult>>): void {
    this.publish({ ...this.snapshot, ...patch })
  }

  private isCurrent(projectId: string, generation: number): boolean {
    return this.snapshot.projectId === projectId && this.generation === generation
  }

  async setProject(projectId: string): Promise<void> {
    const requestInFlight = this.request !== null && !this.request.signal.aborted
    if (projectId === this.snapshot.projectId
      && (this.snapshot.annotations.length > 0 || (this.snapshot.loading && requestInFlight))) {
      return
    }
    this.request?.abort()
    this.mutationTokens.clear()
    const generation = ++this.generation
    this.publish({ ...this.emptySnapshot(projectId), loading: Boolean(projectId) })
    if (!projectId) return
    await this.fetchProject(projectId, generation)
  }

  async retry(): Promise<void> {
    const projectId = this.snapshot.projectId
    if (!projectId) return
    this.request?.abort()
    const generation = ++this.generation
    this.update({ annotations: [], activeDraft: null, loading: true, error: null })
    await this.fetchProject(projectId, generation)
  }

  private async fetchProject(projectId: string, generation: number): Promise<void> {
    const request = new AbortController()
    this.request = request
    try {
      const annotations = await withAbort(
        this.api.list(projectId, { signal: request.signal }),
        request.signal,
      )
      if (!this.isCurrent(projectId, generation)) return
      const scoped = annotations.filter((annotation) => annotation.projectId === projectId)
      this.cache.set(projectId, scoped)
      this.update({ annotations: scoped, loading: false, error: null })
    } catch (error) {
      if (aborted(error) || !this.isCurrent(projectId, generation)) return
      this.update({ annotations: [], loading: false, error: messageFrom(error) })
    } finally {
      if (this.request === request) this.request = null
    }
  }

  getCached(projectId: string): readonly ViewerAnnotation<TResult>[] {
    return this.cache.get(projectId) ?? []
  }

  setActiveDraft(draft: ViewerAnnotation<TResult> | null): void {
    if (draft !== null && draft.projectId !== this.snapshot.projectId) return
    this.update({ activeDraft: draft })
  }

  private setSaving(key: string, saving: boolean): void {
    const ids = new Set(this.snapshot.savingIds)
    if (saving) ids.add(key)
    else ids.delete(key)
    this.update({ savingIds: [...ids] })
  }

  async create(input: CreateAnnotationInput<TResult>): Promise<ViewerAnnotation<TResult> | null> {
    const projectId = this.snapshot.projectId
    if (!projectId) return null
    this.setSaving(CREATE_SAVING_KEY, true)
    this.update({ error: null })
    try {
      const created = await this.api.create(projectId, input)
      if (this.snapshot.projectId !== projectId || created.projectId !== projectId) return null
      const annotations = [...this.snapshot.annotations, created]
      this.cache.set(projectId, annotations)
      this.update({ annotations, activeDraft: null })
      return created
    } catch (error) {
      if (this.snapshot.projectId === projectId) this.update({ error: messageFrom(error) })
      return null
    } finally {
      if (this.snapshot.projectId === projectId) this.setSaving(CREATE_SAVING_KEY, false)
    }
  }

  async updateAnnotation(annotationId: string, input: PatchAnnotationInput): Promise<boolean> {
    const projectId = this.snapshot.projectId
    const previous = this.snapshot.annotations.find((annotation) => annotation.id === annotationId)
    if (!projectId || !previous) return false
    const token = Symbol(annotationId)
    this.mutationTokens.set(annotationId, token)
    this.setSaving(annotationId, true)
    this.update({
      error: null,
      annotations: this.snapshot.annotations.map((annotation) => annotation.id === annotationId
        ? { ...annotation, ...input }
        : annotation),
    })
    try {
      const saved = await this.api.patch(projectId, annotationId, input)
      if (this.snapshot.projectId !== projectId || this.mutationTokens.get(annotationId) !== token) return false
      if (saved.projectId !== projectId) throw new Error('Annotation response belongs to another project')
      const annotations = this.snapshot.annotations.map((annotation) => annotation.id === annotationId
        ? saved
        : annotation)
      this.cache.set(projectId, annotations)
      this.update({ annotations })
      return true
    } catch (error) {
      if (this.snapshot.projectId === projectId && this.mutationTokens.get(annotationId) === token) {
        const annotations = this.snapshot.annotations.map((annotation) => annotation.id === annotationId
          ? previous
          : annotation)
        this.cache.set(projectId, annotations)
        this.update({ annotations, error: messageFrom(error) })
      }
      return false
    } finally {
      if (this.snapshot.projectId === projectId && this.mutationTokens.get(annotationId) === token) {
        this.mutationTokens.delete(annotationId)
        this.setSaving(annotationId, false)
      }
    }
  }

  async remove(annotationId: string): Promise<boolean> {
    const projectId = this.snapshot.projectId
    const index = this.snapshot.annotations.findIndex((annotation) => annotation.id === annotationId)
    if (!projectId || index < 0) return false
    const previous = this.snapshot.annotations[index]
    const token = Symbol(annotationId)
    this.mutationTokens.set(annotationId, token)
    this.setSaving(annotationId, true)
    this.update({
      error: null,
      annotations: this.snapshot.annotations.filter((annotation) => annotation.id !== annotationId),
    })
    try {
      await this.api.delete(projectId, annotationId)
      if (this.snapshot.projectId !== projectId || this.mutationTokens.get(annotationId) !== token) return false
      this.cache.set(projectId, this.snapshot.annotations)
      return true
    } catch (error) {
      if (this.snapshot.projectId === projectId && this.mutationTokens.get(annotationId) === token) {
        const annotations = [...this.snapshot.annotations]
        annotations.splice(index, 0, previous)
        this.cache.set(projectId, annotations)
        this.update({ annotations, error: messageFrom(error) })
      }
      return false
    } finally {
      if (this.snapshot.projectId === projectId && this.mutationTokens.get(annotationId) === token) {
        this.mutationTokens.delete(annotationId)
        this.setSaving(annotationId, false)
      }
    }
  }

  dispose(): void {
    this.request?.abort()
    this.generation += 1
    this.listeners.clear()
  }
}

export function useProjectAnnotations<TResult extends JsonValue = JsonValue>(
  projectId: string,
): ProjectAnnotationsModel<TResult> {
  const controller = useMemo(() => new ProjectAnnotationsController<TResult>(), [])
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)

  useEffect(() => {
    void controller.setProject(projectId)
  }, [controller, projectId])
  useEffect(() => () => controller.dispose(), [controller])

  const retry = useCallback(() => controller.retry(), [controller])
  const create = useCallback((input: CreateAnnotationInput<TResult>) => controller.create(input), [controller])
  const update = useCallback(
    (annotationId: string, input: PatchAnnotationInput) => controller.updateAnnotation(annotationId, input),
    [controller],
  )
  const rename = useCallback(
    (annotationId: string, name: string) => controller.updateAnnotation(annotationId, { name }),
    [controller],
  )
  const setVisible = useCallback(
    (annotationId: string, visible: boolean) => controller.updateAnnotation(annotationId, { visible }),
    [controller],
  )
  const remove = useCallback((annotationId: string) => controller.remove(annotationId), [controller])
  const setActiveDraft = useCallback(
    (draft: ViewerAnnotation<TResult> | null) => controller.setActiveDraft(draft),
    [controller],
  )

  const visibleSnapshot: ProjectAnnotationsSnapshot<TResult> = snapshot.projectId === projectId
    ? snapshot
    : {
        projectId,
        queryKey: ['project-annotations', projectId],
        annotations: [],
        activeDraft: null,
        loading: Boolean(projectId),
        error: null,
        savingIds: [],
      }

  return {
    ...visibleSnapshot,
    saving: visibleSnapshot.savingIds.length > 0,
    retry,
    create,
    update,
    rename,
    setVisible,
    remove,
    setActiveDraft,
  }
}
