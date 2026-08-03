import type {
  InspectorDefinition,
  JsonValue,
  OverlayFactory,
  PickPolicy,
  ResultComputer,
  ToolDefinition,
} from './types'

interface ToolFactoryOptions<TResult extends JsonValue> {
  readonly id: string
  readonly label: string
  readonly pickPolicy: PickPolicy
  readonly computeResult: ResultComputer<TResult>
  readonly createOverlays: OverlayFactory<TResult>
  readonly inspector: InspectorDefinition
}

export interface FixedPointToolOptions<TResult extends JsonValue> extends ToolFactoryOptions<TResult> {
  readonly pointCount: number
}

export interface OpenPointToolOptions<TResult extends JsonValue> extends ToolFactoryOptions<TResult> {
  readonly minPoints: number
  readonly maxPoints?: number
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
}

export function createFixedPointTool<TResult extends JsonValue>(
  options: FixedPointToolOptions<TResult>,
): ToolDefinition<TResult> {
  requirePositiveInteger(options.pointCount, 'pointCount')
  return {
    ...options,
    completion: { kind: 'fixed', pointCount: options.pointCount },
  }
}

export function createOpenPointTool<TResult extends JsonValue>(
  options: OpenPointToolOptions<TResult>,
): ToolDefinition<TResult> {
  requirePositiveInteger(options.minPoints, 'minPoints')
  if (options.maxPoints !== undefined) {
    requirePositiveInteger(options.maxPoints, 'maxPoints')
    if (options.maxPoints < options.minPoints) {
      throw new Error('maxPoints must be greater than or equal to minPoints')
    }
  }
  return {
    ...options,
    completion: {
      kind: 'open',
      minPoints: options.minPoints,
      ...(options.maxPoints === undefined ? {} : { maxPoints: options.maxPoints }),
    },
  }
}
