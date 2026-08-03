import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CreateAnnotationInput } from '../api/annotations'
import type { ViewerOverlayContent } from '../components/viewer/LazyViewer3D'
import {
  BASIC_TOOL_DEFINITIONS,
  BASIC_TOOLS,
  asBasicToolAnnotation,
  basicToolAnnotationOverlay,
  basicToolResultSummary,
  isBasicToolId,
  openToolKeyboardCommand,
  type BasicToolId,
  type BasicToolResult,
} from '../lib/viewer-tools/basic-tools'
import { resolveCompatibleAnnotations } from '../lib/viewer-tools/compatibility'
import { areCoordinateFramesCompatible } from '../lib/viewer-tools/compatibility'
import type { ToolInputConsumer } from '../lib/viewer-tools/picking/controller'
import { reduceToolSession } from '../lib/viewer-tools/reducer'
import type {
  CoordinateFrame,
  JsonValue,
  ResourceRef,
  ToolAction,
  ToolDefinition,
  ToolSession,
  ViewerAnnotation,
} from '../lib/viewer-tools/types'
import type { ProjectAnnotationsModel } from './useProjectAnnotations'

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isCapturing(session: ToolSession<BasicToolResult>): boolean {
  return session.status === 'armed' || session.status === 'collecting'
}

function sessionPoints(session: ToolSession<BasicToolResult>) {
  if ('points' in session) return session.points
  if (session.status === 'error' && session.recoverableDraft) return session.recoverableDraft.points
  return []
}

function sessionResult(session: ToolSession<BasicToolResult>): BasicToolResult | null {
  if (session.status === 'complete-draft' || session.status === 'saving' || session.status === 'saved') {
    return session.result
  }
  return session.status === 'error' && session.recoverableDraft
    ? session.recoverableDraft.result
    : null
}

function promptFor(
  definition: ToolDefinition<BasicToolResult>,
  session: ToolSession<BasicToolResult>,
): string | null {
  if (session.status === 'armed') return `Select the first point for ${definition.label}.`
  if (session.status !== 'collecting') return null
  if (definition.completion.kind === 'open') {
    return session.points.length < definition.completion.minPoints
      ? `Select at least ${definition.completion.minPoints} points. Backspace removes the last point; Esc cancels.`
      : 'Select another point, or press Enter / double-click to finish. Backspace removes the last point.'
  }
  return `Select point ${session.points.length + 1} of ${definition.completion.pointCount}.`
}

export interface ViewerToolsModel {
  readonly tools: readonly ToolDefinition<BasicToolResult>[]
  readonly activeToolId: BasicToolId
  readonly definition: ToolDefinition<BasicToolResult>
  readonly session: ToolSession<BasicToolResult>
  readonly active: boolean
  readonly capturing: boolean
  readonly pointCount: number
  readonly result: BasicToolResult | null
  readonly resultSummary: string | null
  readonly prompt: string | null
  readonly notice: string | null
  readonly error: string | null
  readonly savedAnnotations: readonly ViewerAnnotation<BasicToolResult>[]
  readonly toolInput: ToolInputConsumer
  readonly overlays: ViewerOverlayContent
  readonly activate: (toolId: BasicToolId) => void
  readonly toggle: (toolId: BasicToolId) => void
  readonly finish: () => boolean
  readonly undoLast: () => void
  readonly cancel: () => void
  readonly discard: () => void
  readonly retry: () => void
  readonly resumeDraft: () => void
  readonly save: () => Promise<boolean>
  readonly onDoubleClick: (event: { preventDefault(): void }) => void
}

export function useViewerTools({
  projectId,
  resourceRef,
  assetRef = resourceRef,
  coordinateFrame: suppliedCoordinateFrame,
  annotationsModel,
}: {
  projectId: string
  /** Project resource that owns the saved annotation. */
  resourceRef: ResourceRef
  /** Resource whose geometry is rendered and picked. */
  assetRef?: ResourceRef
  coordinateFrame?: CoordinateFrame
  annotationsModel: ProjectAnnotationsModel<JsonValue>
}): ViewerToolsModel {
  const [definition, setDefinition] = useState<ToolDefinition<BasicToolResult>>(
    BASIC_TOOL_DEFINITIONS.point,
  )
  const [session, setSession] = useState<ToolSession<BasicToolResult>>({ status: 'idle' })
  const [notice, setNotice] = useState<string | null>(null)
  const coordinateFrame = useMemo<CoordinateFrame>(
    () => suppliedCoordinateFrame ?? { kind: 'asset-local', resourceRef: assetRef },
    [assetRef.id, assetRef.type, assetRef.version, suppliedCoordinateFrame],
  )

  const apply = useCallback((action: ToolAction<BasicToolResult>) => {
    setSession((state) => reduceToolSession(definition, state, action))
  }, [definition])

  const activate = useCallback((toolId: BasicToolId) => {
    const nextDefinition = BASIC_TOOL_DEFINITIONS[toolId]
    setDefinition(nextDefinition)
    setNotice(null)
    setSession(reduceToolSession(nextDefinition, { status: 'idle' }, { type: 'activate' }))
  }, [])

  const cancel = useCallback(() => {
    setNotice(null)
    apply({ type: 'cancel' })
  }, [apply])
  const retry = useCallback(() => {
    setNotice(null)
    setSession((state) => {
      const once = reduceToolSession(definition, state, { type: 'retry' })
      return state.status === 'error' && state.cause === 'save'
        ? reduceToolSession(definition, once, { type: 'retry' })
        : once
    })
  }, [definition])
  const resumeDraft = useCallback(() => {
    setNotice(null)
    apply({ type: 'retry' })
  }, [apply])
  const undoLast = useCallback(() => {
    setNotice(null)
    apply({ type: 'undo-last' })
  }, [apply])

  const finish = useCallback((): boolean => {
    if (definition.completion.kind !== 'open' || session.status !== 'collecting') return false
    if (session.points.length < definition.completion.minPoints) {
      setNotice(`Select at least ${definition.completion.minPoints} points before finishing.`)
      return false
    }
    setNotice(null)
    apply({ type: 'finish' })
    return true
  }, [apply, definition.completion, session])

  const toggle = useCallback((toolId: BasicToolId) => {
    if (definition.id === toolId && (isCapturing(session) || session.status === 'complete-draft'
      || session.status === 'saving' || session.status === 'error')) {
      cancel()
      return
    }
    activate(toolId)
  }, [activate, cancel, definition.id, session])

  useEffect(() => {
    setNotice(null)
    setSession({ status: 'idle' })
  }, [assetRef.id, assetRef.type, assetRef.version, projectId, resourceRef.id, resourceRef.type, resourceRef.version])

  useEffect(() => {
    if (!isCapturing(session)) return
    const onKeyDown = (event: KeyboardEvent) => {
      const command = openToolKeyboardCommand(event)
      if (!command) return
      if (command === 'cancel') {
        event.preventDefault()
        cancel()
        return
      }
      if (definition.completion.kind !== 'open') return
      event.preventDefault()
      if (command === 'finish') finish()
      else undoLast()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancel, definition.completion.kind, finish, session, undoLast])

  const capturing = isCapturing(session)
  const active = capturing || session.status === 'complete-draft' || session.status === 'saving'
    || session.status === 'error'
  const points = sessionPoints(session)
  const result = sessionResult(session)

  const toolInput = useMemo<ToolInputConsumer>(() => ({
    pickPolicy: definition.pickPolicy,
    isActive: () => capturing,
    onPick: (pick) => {
      if (!pick || pick.projectId !== projectId || pick.resourceRef.id !== assetRef.id
        || pick.resourceRef.type !== assetRef.type) return false
      setNotice(null)
      apply({ type: 'pick', pick })
      return true
    },
    onHover: (pick) => apply({ type: 'hover', pick }),
    controlPoints: session.status === 'complete-draft' || session.status === 'saved' ? points : undefined,
    onControlPointChange: (index, pick) => apply({ type: 'replace-point', index, pick }),
    onControlPointCommit: (index, pick) => {
      apply({ type: 'replace-point', index, pick })
      if (session.status !== 'saved') return
      const nextPoints = session.points.map((point, pointIndex) => pointIndex === index ? pick : point)
      const nextResult = definition.computeResult(nextPoints)
      void annotationsModel.update(session.annotation.id, { points: nextPoints, result: nextResult })
    },
  }), [annotationsModel, apply, assetRef.id, assetRef.type, capturing, definition, points, projectId, session])

  const compatibleAnnotations = useMemo(() => {
    const usesExplicitAssetFrame = assetRef !== resourceRef || suppliedCoordinateFrame !== undefined
    return usesExplicitAssetFrame
      ? annotationsModel.annotations.filter((annotation) => annotation.visible
        && annotation.projectId === projectId
        && areCoordinateFramesCompatible(annotation.coordinateFrame, coordinateFrame))
      : resolveCompatibleAnnotations(
        annotationsModel.annotations,
        { projectId, resourceRef, coordinateFrame },
      )
  }, [annotationsModel.annotations, assetRef, coordinateFrame, projectId, resourceRef, suppliedCoordinateFrame])
  const savedAnnotations = useMemo(() => compatibleAnnotations.flatMap((annotation) => {
    const basic = asBasicToolAnnotation(annotation)
    return basic ? [basic] : []
  }), [compatibleAnnotations])

  const overlays = useMemo<ViewerOverlayContent>(() => {
    const saved = savedAnnotations.map(basicToolAnnotationOverlay)
    if (!('tool' in session) || session.status === 'saved') return { saved }
    const primitives = definition.createOverlays({
      points,
      hover: 'hover' in session ? session.hover : null,
      result,
    })
    const hover = primitives.filter(({ key }) => key.startsWith('hover-'))
    const draft = primitives.filter(({ key }) => !key.startsWith('hover-'))
    return {
      saved,
      draft: draft.length ? [{
        annotationId: `${definition.id}-active-draft`, coordinateFrame, primitives: draft, state: 'draft',
      }] : [],
      hover: hover.length ? [{
        annotationId: `${definition.id}-hover-preview`, coordinateFrame, primitives: hover, state: 'hover',
      }] : [],
    }
  }, [coordinateFrame, definition, points, result, savedAnnotations, session])

  const save = useCallback(async (): Promise<boolean> => {
    if (session.status !== 'complete-draft' || !isBasicToolId(definition.id)) return false
    const input: CreateAnnotationInput<BasicToolResult> = {
      schemaVersion: 1,
      resourceRef,
      coordinateFrame: session.points[0]?.coordinateFrame ?? coordinateFrame,
      toolId: definition.id,
      name: definition.label,
      points: session.points,
      result: session.result,
      style: {},
      visible: true,
    }
    apply({ type: 'save' })
    try {
      const annotation = await annotationsModel.create(input)
      if (!annotation) {
        apply({ type: 'save-failure', error: annotationsModel.error || `Could not save ${definition.label}` })
        return false
      }
      apply({ type: 'save-success', annotation: annotation as ViewerAnnotation<BasicToolResult> })
      return true
    } catch (error) {
      apply({ type: 'save-failure', error: messageFrom(error) })
      return false
    }
  }, [annotationsModel, apply, coordinateFrame, definition, resourceRef, session])

  const onDoubleClick = useCallback((event: { preventDefault(): void }) => {
    if (definition.completion.kind !== 'open' || !capturing) return
    event.preventDefault()
    finish()
  }, [capturing, definition.completion.kind, finish])

  return {
    tools: BASIC_TOOLS,
    activeToolId: definition.id as BasicToolId,
    definition,
    session,
    active,
    capturing,
    pointCount: points.length,
    result,
    resultSummary: result ? basicToolResultSummary(result) : null,
    prompt: promptFor(definition, session),
    notice,
    error: session.status === 'error' ? session.error : null,
    savedAnnotations,
    toolInput,
    overlays,
    activate,
    toggle,
    finish,
    undoLast,
    cancel,
    discard: cancel,
    retry,
    resumeDraft,
    save,
    onDoubleClick,
  }
}
