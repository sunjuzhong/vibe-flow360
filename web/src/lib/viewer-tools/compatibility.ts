import type {
  CoordinateFrame,
  JsonValue,
  ResourceRef,
  ViewerAnnotation,
} from './types'

export interface ViewerContextCompatibility {
  readonly projectId: string
  readonly resourceRef: ResourceRef
  readonly coordinateFrame: CoordinateFrame
}

function sameResource(left: ResourceRef, right: ResourceRef): boolean {
  return left.id === right.id && left.type === right.type && left.version === right.version
}

export function areCoordinateFramesCompatible(
  annotationFrame: CoordinateFrame,
  viewerFrame: CoordinateFrame,
): boolean {
  if (annotationFrame.kind === 'world' || viewerFrame.kind === 'world') {
    return annotationFrame.kind === viewerFrame.kind
  }
  return sameResource(annotationFrame.resourceRef, viewerFrame.resourceRef)
}

export function isAnnotationCompatible(
  annotation: ViewerAnnotation,
  viewer: ViewerContextCompatibility,
): boolean {
  if (annotation.projectId !== viewer.projectId) return false
  if (!sameResource(annotation.resourceRef, viewer.resourceRef)) return false
  return areCoordinateFramesCompatible(annotation.coordinateFrame, viewer.coordinateFrame)
}

export function resolveCompatibleAnnotations<TResult extends JsonValue>(
  annotations: readonly ViewerAnnotation<TResult>[],
  viewer: ViewerContextCompatibility,
): ViewerAnnotation<TResult>[] {
  return annotations.filter((annotation) => annotation.visible && isAnnotationCompatible(annotation, viewer))
}
