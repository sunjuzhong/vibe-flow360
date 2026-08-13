export interface ViewerRenderScheduler {
  invalidate: () => void
  dispose: () => void
  isScheduled: () => boolean
}

/** Coalesces any number of scene invalidations into one animation frame. */
export function createViewerRenderScheduler(
  render: () => void,
  requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (handle: number) => void = cancelAnimationFrame,
): ViewerRenderScheduler {
  let frame: number | null = null
  let disposed = false

  const invalidate = () => {
    if (disposed || frame !== null) return
    frame = requestFrame(() => {
      frame = null
      if (!disposed) render()
    })
  }

  return {
    invalidate,
    dispose: () => {
      disposed = true
      if (frame !== null) cancelFrame(frame)
      frame = null
    },
    isScheduled: () => frame !== null,
  }
}

/** Keeps high-DPI detail on capable devices without forcing every viewer to DPR 2. */
export function adaptiveViewerPixelRatio(
  devicePixelRatio: number,
  hardwareConcurrency?: number,
  deviceMemory?: number,
): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  let cap = 2
  if ((hardwareConcurrency ?? Infinity) <= 4 || (deviceMemory ?? Infinity) <= 4) cap = 1.5
  if ((hardwareConcurrency ?? Infinity) <= 2 || (deviceMemory ?? Infinity) <= 2) cap = 1.25
  return Math.max(1, Math.min(ratio, cap))
}
