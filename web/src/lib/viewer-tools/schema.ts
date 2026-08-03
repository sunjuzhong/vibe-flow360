import {
  VIEWER_ANNOTATION_SCHEMA_VERSION,
  type JsonValue,
  type ViewerAnnotation,
} from './types'

export function isSupportedAnnotationSchemaVersion(
  version: unknown,
): version is typeof VIEWER_ANNOTATION_SCHEMA_VERSION {
  return version === VIEWER_ANNOTATION_SCHEMA_VERSION
}

export function assertSupportedAnnotationSchemaVersion(
  version: unknown,
): asserts version is typeof VIEWER_ANNOTATION_SCHEMA_VERSION {
  if (!isSupportedAnnotationSchemaVersion(version)) {
    throw new Error(`Unsupported viewer annotation schema version: ${String(version)}`)
  }
}

export function parseViewerAnnotation<TResult extends JsonValue = JsonValue>(
  value: unknown,
): ViewerAnnotation<TResult> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Viewer annotation must be an object')
  }
  const candidate = value as Partial<ViewerAnnotation<TResult>>
  assertSupportedAnnotationSchemaVersion(candidate.schemaVersion)
  if (!candidate.id || !candidate.projectId || !candidate.toolId) {
    throw new Error('Viewer annotation is missing a required identifier')
  }
  if (!candidate.resourceRef?.id || !candidate.resourceRef.type) {
    throw new Error('Viewer annotation has an invalid resourceRef')
  }
  if (!candidate.coordinateFrame || !Array.isArray(candidate.points)
    || candidate.result === undefined || candidate.style === undefined
    || typeof candidate.visible !== 'boolean' || !candidate.createdAt || !candidate.updatedAt) {
    throw new Error('Viewer annotation is missing required data')
  }
  return candidate as ViewerAnnotation<TResult>
}
