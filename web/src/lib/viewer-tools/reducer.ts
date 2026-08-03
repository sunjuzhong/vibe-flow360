import type {
  CompleteDraftToolSession,
  JsonValue,
  PickResult,
  ToolAction,
  ToolDefinition,
  ToolSession,
} from './types'

export interface ToolRuntime<TResult extends JsonValue> {
  readonly initialState: ToolSession<TResult>
  readonly reducer: (state: ToolSession<TResult>, action: ToolAction<TResult>) => ToolSession<TResult>
}

function draftFrom<TResult extends JsonValue>(
  tool: ToolDefinition<TResult>,
  points: readonly PickResult[],
): CompleteDraftToolSession<TResult> | ToolSession<TResult> {
  try {
    return {
      status: 'complete-draft',
      tool,
      points,
      hover: null,
      result: tool.computeResult(points),
    }
  } catch (error) {
    return {
      status: 'error',
      cause: 'compute',
      error: error instanceof Error ? error.message : String(error),
      tool,
    }
  }
}

function armed<TResult extends JsonValue>(tool: ToolDefinition<TResult>): ToolSession<TResult> {
  return { status: 'armed', tool, points: [], hover: null }
}

function canCapture<TResult extends JsonValue>(
  state: ToolSession<TResult>,
): state is Extract<ToolSession<TResult>, { status: 'armed' | 'collecting' }> {
  return state.status === 'armed' || state.status === 'collecting'
}

export function reduceToolSession<TResult extends JsonValue>(
  tool: ToolDefinition<TResult>,
  state: ToolSession<TResult>,
  action: ToolAction<TResult>,
): ToolSession<TResult> {
  if (action.type === 'activate') {
    return state.status === 'idle' || state.status === 'cancelled' || state.status === 'saved'
      ? armed(tool)
      : state
  }

  if (action.type === 'cancel') {
    return state.status === 'idle' || state.status === 'cancelled'
      ? state
      : { status: 'cancelled' }
  }

  if (action.type === 'pick') {
    if (!canCapture(state)) return state
    if (tool.completion.kind === 'open' && tool.completion.maxPoints !== undefined
      && state.points.length >= tool.completion.maxPoints) return state

    const points = [...state.points, action.pick]
    if (tool.completion.kind === 'fixed' && points.length === tool.completion.pointCount) {
      return draftFrom(tool, points)
    }
    if (tool.completion.kind === 'fixed' && points.length > tool.completion.pointCount) return state
    return { status: 'collecting', tool, points, hover: null }
  }

  if (action.type === 'hover') {
    return canCapture(state) ? { ...state, hover: action.pick } : state
  }

  if (action.type === 'finish') {
    if (state.status !== 'collecting' || tool.completion.kind !== 'open') return state
    return state.points.length >= tool.completion.minPoints ? draftFrom(tool, state.points) : state
  }

  if (action.type === 'undo-last') {
    if (state.status !== 'collecting' && state.status !== 'complete-draft') return state
    const points = state.points.slice(0, -1)
    return points.length === 0
      ? armed(tool)
      : { status: 'collecting', tool, points, hover: null }
  }

  if (action.type === 'retry') {
    if (state.status === 'error' && state.cause === 'save' && state.recoverableDraft) {
      return state.recoverableDraft
    }
    return state.status === 'complete-draft' || state.status === 'saved'
      || (state.status === 'error' && state.cause === 'compute')
      ? armed(tool)
      : state
  }

  if (action.type === 'save') {
    return state.status === 'complete-draft'
      ? { ...state, status: 'saving' }
      : state
  }

  if (action.type === 'save-success') {
    return state.status === 'saving'
      ? { ...state, status: 'saved', annotation: action.annotation }
      : state
  }

  if (action.type === 'save-failure') {
    if (state.status !== 'saving') return state
    const recoverableDraft: CompleteDraftToolSession<TResult> = {
      ...state,
      status: 'complete-draft',
    }
    return {
      status: 'error',
      cause: 'save',
      error: action.error,
      tool,
      recoverableDraft,
    }
  }

  return state
}

export function createToolRuntime<TResult extends JsonValue>(
  tool: ToolDefinition<TResult>,
): ToolRuntime<TResult> {
  return {
    initialState: { status: 'idle' },
    reducer: (state, action) => reduceToolSession(tool, state, action),
  }
}
