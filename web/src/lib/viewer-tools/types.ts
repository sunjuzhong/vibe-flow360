export const VIEWER_ANNOTATION_SCHEMA_VERSION = 1 as const

export type ViewerAnnotationSchemaVersion = typeof VIEWER_ANNOTATION_SCHEMA_VERSION

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]

export type Vector3Tuple = readonly [number, number, number]

export interface ResourceRef {
  readonly id: string
  readonly type: string
  readonly version?: string
}

export type CoordinateFrame =
  | { readonly kind: 'world' }
  | { readonly kind: 'asset-local'; readonly resourceRef: ResourceRef }

export type PickEntityType = 'mesh' | 'face' | 'edge' | 'vertex' | 'point' | 'unknown'

export type SnapType = 'none' | 'surface' | 'mesh-vertex' | 'cad-edge' | 'cad-vertex' | 'feature'

export interface PickResult {
  readonly localPosition: Vector3Tuple
  readonly worldPosition: Vector3Tuple
  readonly projectId: string
  readonly resourceRef: ResourceRef
  readonly coordinateFrame: CoordinateFrame
  readonly entityId?: string
  readonly entityType?: PickEntityType
  readonly triangleIndex?: number
  readonly vertexIndex?: number
  readonly normal?: Vector3Tuple
  readonly snap: {
    readonly type: SnapType
    readonly distance?: number
    readonly confidence?: number
  }
}

export type CompletionPolicy =
  | { readonly kind: 'fixed'; readonly pointCount: number }
  | { readonly kind: 'open'; readonly minPoints: number; readonly maxPoints?: number }

export interface PickPolicy {
  readonly targets: readonly ('surface' | 'line' | 'point')[]
  readonly allowMiss?: boolean
  readonly snapTypes?: readonly SnapType[]
}

export type OverlayPrimitive =
  | {
      readonly kind: 'point'
      readonly key: string
      readonly position: Vector3Tuple
      readonly color?: string
      readonly size?: number
    }
  | {
      readonly kind: 'polyline'
      readonly key: string
      readonly points: readonly Vector3Tuple[]
      readonly color?: string
      readonly width?: number
      readonly dashed?: boolean
    }
  | {
      readonly kind: 'sphere'
      readonly key: string
      readonly center: Vector3Tuple
      readonly radius: number
      readonly color?: string
      readonly opacity?: number
    }
  | {
      readonly kind: 'label'
      readonly key: string
      readonly position: Vector3Tuple
      readonly text: string
      readonly color?: string
    }

export interface InspectorField {
  readonly key: string
  readonly label: string
  readonly valuePath: string
  readonly format?: 'number' | 'distance' | 'vector' | 'text'
  readonly unit?: string
}

export interface InspectorDefinition {
  readonly title: string
  readonly fields: readonly InspectorField[]
}

export type ResultComputer<TResult extends JsonValue = JsonValue> = (
  points: readonly PickResult[],
) => TResult

export type OverlayFactory<TResult extends JsonValue = JsonValue> = (input: {
  readonly points: readonly PickResult[]
  readonly hover: PickResult | null
  readonly result: TResult | null
}) => readonly OverlayPrimitive[]

export interface ToolDefinition<TResult extends JsonValue = JsonValue> {
  readonly id: string
  readonly label: string
  readonly completion: CompletionPolicy
  readonly pickPolicy: PickPolicy
  readonly computeResult: ResultComputer<TResult>
  readonly createOverlays: OverlayFactory<TResult>
  readonly inspector: InspectorDefinition
}

interface ActiveSessionBase<TResult extends JsonValue> {
  readonly tool: ToolDefinition<TResult>
  readonly points: readonly PickResult[]
  readonly hover: PickResult | null
}

export interface IdleToolSession {
  readonly status: 'idle'
}

export interface ArmedToolSession<TResult extends JsonValue = JsonValue>
  extends ActiveSessionBase<TResult> {
  readonly status: 'armed'
  readonly points: readonly []
}

export interface CollectingToolSession<TResult extends JsonValue = JsonValue>
  extends ActiveSessionBase<TResult> {
  readonly status: 'collecting'
}

export interface CompleteDraftToolSession<TResult extends JsonValue = JsonValue>
  extends ActiveSessionBase<TResult> {
  readonly status: 'complete-draft'
  readonly hover: null
  readonly result: TResult
}

export interface SavingToolSession<TResult extends JsonValue = JsonValue>
  extends ActiveSessionBase<TResult> {
  readonly status: 'saving'
  readonly hover: null
  readonly result: TResult
}

export interface SavedToolSession<TResult extends JsonValue = JsonValue>
  extends ActiveSessionBase<TResult> {
  readonly status: 'saved'
  readonly hover: null
  readonly result: TResult
  readonly annotation: ViewerAnnotation<TResult>
}

export interface CancelledToolSession {
  readonly status: 'cancelled'
}

export interface ErrorToolSession<TResult extends JsonValue = JsonValue> {
  readonly status: 'error'
  readonly error: string
  readonly cause: 'compute' | 'save'
  readonly recoverableDraft?: CompleteDraftToolSession<TResult>
  readonly tool: ToolDefinition<TResult>
}

export type ToolSession<TResult extends JsonValue = JsonValue> =
  | IdleToolSession
  | ArmedToolSession<TResult>
  | CollectingToolSession<TResult>
  | CompleteDraftToolSession<TResult>
  | SavingToolSession<TResult>
  | SavedToolSession<TResult>
  | CancelledToolSession
  | ErrorToolSession<TResult>

export type ToolAction<TResult extends JsonValue = JsonValue> =
  | { readonly type: 'activate' }
  | { readonly type: 'pick'; readonly pick: PickResult }
  | { readonly type: 'replace-point'; readonly index: number; readonly pick: PickResult }
  | { readonly type: 'hover'; readonly pick: PickResult | null }
  | { readonly type: 'undo-last' }
  | { readonly type: 'finish' }
  | { readonly type: 'cancel' }
  | { readonly type: 'retry' }
  | { readonly type: 'save' }
  | { readonly type: 'save-success'; readonly annotation: ViewerAnnotation<TResult> }
  | { readonly type: 'save-failure'; readonly error: string }

export interface ViewerAnnotation<TResult extends JsonValue = JsonValue> {
  readonly schemaVersion: ViewerAnnotationSchemaVersion
  readonly id: string
  readonly projectId: string
  readonly resourceRef: ResourceRef
  readonly coordinateFrame: CoordinateFrame
  readonly toolId: string
  readonly name?: string
  readonly points: readonly PickResult[]
  readonly result: TResult
  readonly style: Readonly<Record<string, JsonValue>>
  readonly visible: boolean
  readonly createdAt: string
  readonly updatedAt: string
}
