import { describe, expect, it, vi } from 'vitest'
import { adaptiveViewerPixelRatio, createViewerRenderScheduler } from './viewerRenderScheduler'

describe('viewer render scheduler', () => {
  it('coalesces invalidations and sleeps after rendering', () => {
    const callbacks: FrameRequestCallback[] = []
    const render = vi.fn()
    const scheduler = createViewerRenderScheduler(
      render,
      (callback) => callbacks.push(callback),
      vi.fn(),
    )

    scheduler.invalidate()
    scheduler.invalidate()
    scheduler.invalidate()
    expect(callbacks).toHaveLength(1)
    expect(scheduler.isScheduled()).toBe(true)

    callbacks.shift()!(0)
    expect(render).toHaveBeenCalledTimes(1)
    expect(scheduler.isScheduled()).toBe(false)
  })

  it('allows animation and damping to invalidate the next frame while rendering', () => {
    const callbacks: FrameRequestCallback[] = []
    let scheduler: ReturnType<typeof createViewerRenderScheduler>
    const render = vi.fn(() => scheduler.invalidate())
    scheduler = createViewerRenderScheduler(render, (callback) => callbacks.push(callback), vi.fn())

    scheduler.invalidate()
    callbacks.shift()!(0)

    expect(render).toHaveBeenCalledTimes(1)
    expect(callbacks).toHaveLength(1)
    expect(scheduler.isScheduled()).toBe(true)
  })

  it('cancels a pending frame and ignores later invalidations after disposal', () => {
    const cancel = vi.fn()
    const scheduler = createViewerRenderScheduler(vi.fn(), () => 42, cancel)

    scheduler.invalidate()
    scheduler.dispose()
    scheduler.invalidate()

    expect(cancel).toHaveBeenCalledWith(42)
    expect(scheduler.isScheduled()).toBe(false)
  })

  it('adapts DPR to device capability', () => {
    expect(adaptiveViewerPixelRatio(3, 12, 16)).toBe(2)
    expect(adaptiveViewerPixelRatio(2, 4, 8)).toBe(1.5)
    expect(adaptiveViewerPixelRatio(2, 8, 2)).toBe(1.25)
    expect(adaptiveViewerPixelRatio(0, 8, 8)).toBe(1)
  })
})
