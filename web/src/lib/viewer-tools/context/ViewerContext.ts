import type {
  CoordinateFrame,
  JsonValue,
  ResourceRef,
  ViewerAnnotation,
} from '../types'

export type ViewerAssetSource = 'primary' | 'fallback'

export type ViewerCapability =
  | 'distance'
  | 'surface-picking'
  | 'field-probe'

export interface ViewerContext {
  readonly projectId: string
  /** The Project resource whose workspace is open. */
  readonly resourceRef: ResourceRef
  /** The asset currently rendered and used as the coordinate basis. */
  readonly assetRef: ResourceRef
  readonly assetSource: ViewerAssetSource
  readonly coordinateFrameId: string
  readonly coordinateFrame: CoordinateFrame
  readonly unit: string
  readonly capabilities: readonly ViewerCapability[]
}

export interface CreateViewerContextInput {
  readonly projectId: string
  readonly resourceRef: ResourceRef
  readonly fallbackAssetRef?: ResourceRef | null
  readonly assetSource?: ViewerAssetSource | null
  readonly unit?: string | null
  readonly capabilities?: readonly ViewerCapability[]
}

function normalizedRef(ref: ResourceRef): ResourceRef {
  return ref.version
    ? { id: ref.id, type: ref.type, version: ref.version }
    : { id: ref.id, type: ref.type }
}

function refPart(value: string | undefined): string {
  return encodeURIComponent(value || '-')
}

export function coordinateFrameIdForAsset(assetRef: ResourceRef): string {
  return `asset-local:${refPart(assetRef.type)}:${refPart(assetRef.id)}:${refPart(assetRef.version)}`
}

export function createViewerContext(input: CreateViewerContextInput): ViewerContext {
  const fallbackActive = input.assetSource === 'fallback' && Boolean(input.fallbackAssetRef)
  const assetRef = normalizedRef(
    fallbackActive ? input.fallbackAssetRef as ResourceRef : input.resourceRef,
  )
  const capabilities: readonly ViewerCapability[] = input.capabilities
    ?? ['distance', 'surface-picking']
  return {
    projectId: input.projectId,
    resourceRef: normalizedRef(input.resourceRef),
    assetRef,
    assetSource: fallbackActive ? 'fallback' : 'primary',
    coordinateFrameId: coordinateFrameIdForAsset(assetRef),
    coordinateFrame: { kind: 'asset-local', resourceRef: assetRef },
    unit: input.unit?.trim() || 'model units',
    capabilities: [...new Set<ViewerCapability>(capabilities)],
  }
}

function sameRef(left: ResourceRef, right: ResourceRef): boolean {
  return left.id === right.id && left.type === right.type && left.version === right.version
}

export function isAnnotationAvailableInContext(
  annotation: ViewerAnnotation,
  context: ViewerContext,
): boolean {
  if (!annotation.visible || annotation.projectId !== context.projectId) return false
  if (annotation.coordinateFrame.kind === 'world') {
    return context.coordinateFrame.kind === 'world'
  }
  return context.coordinateFrame.kind === 'asset-local'
    && sameRef(annotation.coordinateFrame.resourceRef, context.assetRef)
}

export function resolveContextAnnotations<TResult extends JsonValue>(
  annotations: readonly ViewerAnnotation<TResult>[],
  context: ViewerContext,
): ViewerAnnotation<TResult>[] {
  return annotations.filter((annotation) => isAnnotationAvailableInContext(annotation, context))
}

export function hasViewerCapability(
  context: ViewerContext,
  capability: ViewerCapability,
): boolean {
  return context.capabilities.includes(capability)
}

export function findLengthUnit(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const unit = findLengthUnit(item)
      if (unit) return unit
    }
    return null
  }
  for (const [key, child] of Object.entries(value)) {
    if (['length_unit', 'length_units', 'mesh_unit', 'mesh_units'].includes(key.toLowerCase())
      && typeof child === 'string' && child.trim()) {
      return child.trim()
    }
    const nested = findLengthUnit(child)
    if (nested) return nested
  }
  return null
}
