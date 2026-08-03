import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { CreateAnnotationInput } from '../api/annotations'
import type { ViewerOverlayContent } from '../components/viewer/LazyViewer3D'
import type { ProjectAnnotationsModel } from './useProjectAnnotations'
import {
  areCoordinateFramesCompatible,
  resolveCompatibleAnnotations,
} from '../lib/viewer-tools/compatibility'
import {
  DISTANCE_TOOL_ID,
  distanceAnnotationOverlay,
  distanceToolDefinition,
  isDistanceResult,
  type DistanceResult,
} from '../lib/viewer-tools/distance'
import type { ToolInputConsumer } from '../lib/viewer-tools/picking/controller'
import { createToolRuntime } from '../lib/viewer-tools/reducer'
import type {
  CoordinateFrame,
  JsonValue,
  ResourceRef,
  ToolSession,
  ViewerAnnotation,
} from '../lib/viewer-tools/types'

const runtime = createToolRuntime(distanceToolDefinition)

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isCapturing(session: ToolSession<DistanceResult>): boolean {
  return session.status === 'armed' || session.status === 'collecting'
}

function resultWithUnit(result: DistanceResult, unit: string): DistanceResult {
  return result.unit === unit ? result : { ...result, unit }
}

function asDistanceAnnotation(
  annotation: ViewerAnnotation<JsonValue>,
): ViewerAnnotation<DistanceResult> | null {
  return annotation.toolId === DISTANCE_TOOL_ID && isDistanceResult(annotation.result)
    ? annotation as ViewerAnnotation<DistanceResult>
    : null
}

export type DistanceToolModel = {
  readonly session: ToolSession<DistanceResult>
  readonly active: boolean
  readonly capturing: boolean
  readonly pointCount: number
  readonly result: DistanceResult | null
  readonly error: string | null
  readonly toolInput: ToolInputConsumer
  readonly overlays: ViewerOverlayContent
  readonly activate: () => void
  readonly toggle: () => void
  readonly retry: () => void
  readonly discard: () => void
  readonly resumeDraft: () => void
  readonly save: () => Promise<boolean>
}

export function useDistanceTool({
  projectId,
  resourceRef,
  assetRef = resourceRef,
  coordinateFrame: suppliedCoordinateFrame,
  annotationsModel,
  unit = 'model units',
}: {
  projectId: string
  /** Project resource that owns a saved annotation. */
  resourceRef: ResourceRef
  /** Resource whose geometry is currently rendered and picked. */
  assetRef?: ResourceRef
  /** Explicit frame for fallback assets or other compatible views. */
  coordinateFrame?: CoordinateFrame
  annotationsModel: ProjectAnnotationsModel<JsonValue>
  unit?: string | null
}): DistanceToolModel {
  const [session, dispatch] = useReducer(runtime.reducer, runtime.initialState)
  const displayUnit = unit?.trim() || 'model units'
  const coordinateFrame = useMemo<CoordinateFrame>(
    () => suppliedCoordinateFrame ?? { kind: 'asset-local', resourceRef: assetRef },
    [assetRef.id, assetRef.type, assetRef.version, suppliedCoordinateFrame],
  )
  const contextKey = `${projectId}:${resourceRef.type}:${resourceRef.id}:${resourceRef.version ?? ''}`
    + `:${assetRef.type}:${assetRef.id}:${assetRef.version ?? ''}`
  const capturing = isCapturing(session)
  const active = capturing || session.status === 'complete-draft' || session.status === 'saving'
    || session.status === 'error'
  const result = session.status === 'complete-draft' || session.status === 'saving'
    || session.status === 'saved'
    ? resultWithUnit(session.result, displayUnit)
    : session.status === 'error' && session.recoverableDraft
      ? resultWithUnit(session.recoverableDraft.result, displayUnit)
      : null
  const points = 'points' in session
    ? session.points
    : session.status === 'error' && session.recoverableDraft
      ? session.recoverableDraft.points
      : []

  const activate = useCallback(() => dispatch({ type: 'activate' }), [])
  const discard = useCallback(() => dispatch({ type: 'cancel' }), [])
  const toggle = useCallback(() => {
    dispatch({ type: active ? 'cancel' : 'activate' })
  }, [active])
  const retry = useCallback(() => {
    // A save error first restores its recoverable draft; the second action clears it.
    if (session.status === 'error' && session.cause === 'save') dispatch({ type: 'retry' })
    dispatch({ type: 'retry' })
  }, [session.status])
  const resumeDraft = useCallback(() => dispatch({ type: 'retry' }), [])

  useEffect(() => {
    dispatch({ type: 'cancel' })
  }, [contextKey])

  useEffect(() => {
    dispatch({ type: 'cancel' })
  }, [projectId, resourceRef.id, resourceRef.type, resourceRef.version])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      dispatch({ type: 'cancel' })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active])

  const toolInput = useMemo<ToolInputConsumer>(() => ({
    isActive: () => capturing,
    onPick: (pick) => {
      if (!pick || pick.projectId !== projectId
        || pick.resourceRef.id !== assetRef.id
        || pick.resourceRef.type !== assetRef.type) return false
      dispatch({ type: 'pick', pick })
      return true
    },
    onHover: (pick) => dispatch({ type: 'hover', pick }),
  }), [assetRef.id, assetRef.type, capturing, projectId])

  const overlays = useMemo<ViewerOverlayContent>(() => {
    const usesExplicitAssetFrame = assetRef !== resourceRef || suppliedCoordinateFrame !== undefined
    const compatible = usesExplicitAssetFrame
      ? annotationsModel.annotations.filter((annotation) => annotation.visible
        && annotation.projectId === projectId
        && areCoordinateFramesCompatible(annotation.coordinateFrame, coordinateFrame))
      : resolveCompatibleAnnotations(annotationsModel.annotations, {
        projectId,
        resourceRef,
        coordinateFrame,
      })
    const saved = compatible.flatMap((annotation) => {
      const distance = asDistanceAnnotation(annotation)
      return distance ? [distanceAnnotationOverlay(distance)] : []
    })
    if (!('tool' in session) || points.length === 0 || session.status === 'saved') return { saved }
    const overlayResult = result
    const allPrimitives = distanceToolDefinition.createOverlays({
      points,
      hover: 'hover' in session ? session.hover : null,
      result: overlayResult,
    })
    const hoverPrimitives = allPrimitives.filter(({ key }) => key.startsWith('hover-'))
    const draftPrimitives = allPrimitives.filter(({ key }) => !key.startsWith('hover-'))
    return {
      saved,
      draft: draftPrimitives.length ? [{
        annotationId: 'distance-active-draft',
        coordinateFrame,
        primitives: draftPrimitives,
        state: 'draft',
      }] : [],
      hover: hoverPrimitives.length ? [{
        annotationId: 'distance-hover-preview',
        coordinateFrame,
        primitives: hoverPrimitives,
        state: 'hover',
      }] : [],
    }
  }, [annotationsModel.annotations, assetRef, coordinateFrame, points, projectId, resourceRef, result, session, suppliedCoordinateFrame])

  const save = useCallback(async (): Promise<boolean> => {
    if (session.status !== 'complete-draft') return false
    const persistedResult = resultWithUnit(session.result, displayUnit)
    const input: CreateAnnotationInput<DistanceResult> = {
      schemaVersion: 1,
      resourceRef,
      coordinateFrame: session.points[0]?.coordinateFrame ?? coordinateFrame,
      toolId: DISTANCE_TOOL_ID,
      name: 'Distance',
      points: session.points,
      result: persistedResult,
      style: { color: '#f59e0b' },
      visible: true,
    }
    dispatch({ type: 'save' })
    try {
      const annotation = await annotationsModel.create(input)
      if (!annotation) {
        dispatch({ type: 'save-failure', error: annotationsModel.error || 'Could not save distance annotation' })
        return false
      }
      dispatch({
        type: 'save-success',
        annotation: annotation as ViewerAnnotation<DistanceResult>,
      })
      return true
    } catch (error) {
      dispatch({ type: 'save-failure', error: messageFrom(error) })
      return false
    }
  }, [annotationsModel, coordinateFrame, displayUnit, resourceRef, session])

  return {
    session,
    active,
    capturing,
    pointCount: points.length,
    result,
    error: session.status === 'error' ? session.error : null,
    toolInput,
    overlays,
    activate,
    toggle,
    retry,
    discard,
    resumeDraft,
    save,
  }
}
