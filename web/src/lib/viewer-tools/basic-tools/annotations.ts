import type { OverlayAnnotation } from '../overlays/types'
import type { JsonValue, ViewerAnnotation } from '../types'
import { BASIC_TOOL_DEFINITIONS } from './definitions'
import { isBasicToolResult, type BasicToolId, type BasicToolResult } from './geometry'

export function isBasicToolId(value: string): value is BasicToolId {
  return Object.hasOwn(BASIC_TOOL_DEFINITIONS, value)
}

export function asBasicToolAnnotation(
  annotation: ViewerAnnotation<JsonValue>,
): ViewerAnnotation<BasicToolResult> | null {
  return isBasicToolId(annotation.toolId) && isBasicToolResult(annotation.result)
    && annotation.result.kind === annotation.toolId
    ? annotation as ViewerAnnotation<BasicToolResult>
    : null
}

export function basicToolAnnotationOverlay(
  annotation: ViewerAnnotation<BasicToolResult>,
): OverlayAnnotation {
  const definition = BASIC_TOOL_DEFINITIONS[annotation.toolId as BasicToolId]
  return {
    annotationId: annotation.id,
    coordinateFrame: annotation.coordinateFrame,
    primitives: definition.createOverlays({
      points: annotation.points,
      hover: null,
      result: annotation.result,
    }),
    visible: annotation.visible,
    state: 'saved',
  }
}
