import type { PickPolicy, PickResult } from '../types'

export interface ViewerPointerEvent {
  readonly clientX: number
  readonly clientY: number
  readonly pointerId?: number
  readonly ctrlKey?: boolean
  readonly metaKey?: boolean
  readonly shiftKey?: boolean
  readonly altKey?: boolean
}

export interface InputConsumer {
  readonly isActive?: () => boolean
  readonly allowMiss?: boolean
  /** Return false to explicitly pass the click to the next consumer. */
  readonly onPick: (pick: PickResult | null, event: ViewerPointerEvent) => boolean | void
}

export interface ToolInputConsumer extends InputConsumer {
  readonly onHover?: (pick: PickResult | null) => void
  readonly pickPolicy?: PickPolicy
}

export interface ViewerInputControllerOptions {
  readonly resolvePick: (event: ViewerPointerEvent) => PickResult | null
  readonly activeTool?: ToolInputConsumer
  readonly fieldProbe?: InputConsumer
  readonly selection?: InputConsumer
  readonly dragThreshold?: number
  readonly onHover?: (pick: PickResult | null) => void
}

export type PointerUpResult = 'ignored' | 'drag' | 'tool' | 'field-probe' | 'selection'

interface PointerDownState {
  readonly pointerId: number | undefined
  readonly x: number
  readonly y: number
}

/** DOM-independent pointer arbitration used by Viewer3D's React event adapters. */
export class ViewerInputController {
  private readonly options: ViewerInputControllerOptions
  private readonly dragThresholdSquared: number
  private pointerDown: PointerDownState | null = null

  constructor(options: ViewerInputControllerOptions) {
    if ((options.dragThreshold ?? 4) < 0) throw new Error('dragThreshold cannot be negative')
    this.options = options
    this.dragThresholdSquared = (options.dragThreshold ?? 4) ** 2
  }

  onPointerDown(event: ViewerPointerEvent): void {
    this.pointerDown = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }

  onPointerUp(event: ViewerPointerEvent): PointerUpResult {
    const start = this.pointerDown
    this.pointerDown = null
    if (!start || (start.pointerId !== undefined && event.pointerId !== start.pointerId)) return 'ignored'
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (dx * dx + dy * dy > this.dragThresholdSquared) return 'drag'

    const pick = this.options.resolvePick(event)
    if (consume(this.options.activeTool, pick, event)) return 'tool'
    if (consume(this.options.fieldProbe, pick, event)) return 'field-probe'
    if (consume(this.options.selection, pick, event)) return 'selection'
    return 'ignored'
  }

  onPointerMove(event: ViewerPointerEvent): PickResult | null {
    const pick = this.options.resolvePick(event)
    this.options.onHover?.(pick)
    if (isActive(this.options.activeTool)) this.options.activeTool?.onHover?.(pick)
    return pick
  }

  onPointerLeave(): void {
    this.options.onHover?.(null)
    if (isActive(this.options.activeTool)) this.options.activeTool?.onHover?.(null)
    this.pointerDown = null
  }

  cancelPointer(): void {
    this.pointerDown = null
  }
}

function isActive(consumer: InputConsumer | undefined): boolean {
  return Boolean(consumer) && (consumer?.isActive?.() ?? true)
}

function consume(
  consumer: InputConsumer | undefined,
  pick: PickResult | null,
  event: ViewerPointerEvent,
): boolean {
  if (!isActive(consumer) || (!pick && !consumer?.allowMiss)) return false
  return consumer?.onPick(pick, event) !== false
}
