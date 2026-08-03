import { describe, expect, it, vi } from 'vitest'
import type { PickResult } from '../types'
import { ViewerInputController } from './controller'

const resourceRef = { id: 'geometry-1', type: 'Geometry' } as const
const pick: PickResult = {
  localPosition: [0, 0, 0],
  worldPosition: [0, 0, 0],
  projectId: 'project-1',
  resourceRef,
  coordinateFrame: { kind: 'asset-local', resourceRef },
  entityId: 'face-1',
  entityType: 'face',
  snap: { type: 'surface' },
}

describe('ViewerInputController', () => {
  it('submits a click exactly once to an active tool and suppresses lower priorities', () => {
    const tool = vi.fn()
    const probe = vi.fn()
    const selection = vi.fn()
    const controller = new ViewerInputController({
      resolvePick: () => pick,
      activeTool: { onPick: tool },
      fieldProbe: { onPick: probe },
      selection: { onPick: selection },
    })

    controller.onPointerDown({ clientX: 10, clientY: 10, pointerId: 1 })
    expect(controller.onPointerUp({ clientX: 12, clientY: 11, pointerId: 1 })).toBe('tool')
    expect(tool).toHaveBeenCalledOnce()
    expect(tool).toHaveBeenCalledWith(pick, expect.objectContaining({ pointerId: 1 }))
    expect(probe).not.toHaveBeenCalled()
    expect(selection).not.toHaveBeenCalled()
    expect(controller.onPointerUp({ clientX: 12, clientY: 11, pointerId: 1 })).toBe('ignored')
  })

  it('does not submit after an OrbitControls-sized drag', () => {
    const tool = vi.fn()
    const resolvePick = vi.fn(() => pick)
    const controller = new ViewerInputController({
      resolvePick,
      activeTool: { onPick: tool },
      dragThreshold: 4,
    })
    controller.onPointerDown({ clientX: 0, clientY: 0 })
    expect(controller.onPointerUp({ clientX: 4, clientY: 1 })).toBe('drag')
    expect(resolvePick).not.toHaveBeenCalled()
    expect(tool).not.toHaveBeenCalled()
  })

  it('falls through tool, probe, and selection only when explicitly not consumed', () => {
    const order: string[] = []
    const controller = new ViewerInputController({
      resolvePick: () => pick,
      activeTool: { onPick: () => { order.push('tool'); return false } },
      fieldProbe: { onPick: () => { order.push('probe'); return false } },
      selection: { onPick: () => { order.push('selection') } },
    })
    controller.onPointerDown({ clientX: 0, clientY: 0 })
    expect(controller.onPointerUp({ clientX: 0, clientY: 0 })).toBe('selection')
    expect(order).toEqual(['tool', 'probe', 'selection'])
  })

  it('passes additive selection modifiers to the selected consumer', () => {
    const selection = vi.fn()
    const controller = new ViewerInputController({
      resolvePick: () => pick,
      selection: { onPick: selection },
    })
    controller.onPointerDown({ clientX: 0, clientY: 0, pointerId: 2 })
    controller.onPointerUp({
      clientX: 0,
      clientY: 0,
      pointerId: 2,
      metaKey: true,
      shiftKey: true,
    })
    expect(selection).toHaveBeenCalledWith(pick, expect.objectContaining({
      metaKey: true,
      shiftKey: true,
    }))
  })

  it('supports configurable miss dispatch and default miss ignore', () => {
    const tool = vi.fn()
    const selection = vi.fn()
    const controller = new ViewerInputController({
      resolvePick: () => null,
      activeTool: { isActive: () => false, onPick: tool },
      selection: { allowMiss: true, onPick: selection },
    })
    controller.onPointerDown({ clientX: 0, clientY: 0 })
    expect(controller.onPointerUp({ clientX: 0, clientY: 0 })).toBe('selection')
    expect(tool).not.toHaveBeenCalled()
    expect(selection).toHaveBeenCalledWith(null, expect.any(Object))
  })

  it('publishes hover candidates without committing and clears on leave', () => {
    const hover = vi.fn()
    const toolHover = vi.fn()
    const toolPick = vi.fn()
    const controller = new ViewerInputController({
      resolvePick: () => pick,
      onHover: hover,
      activeTool: { onPick: toolPick, onHover: toolHover },
    })
    expect(controller.onPointerMove({ clientX: 1, clientY: 2 })).toBe(pick)
    expect(hover).toHaveBeenCalledWith(pick)
    expect(toolHover).toHaveBeenCalledWith(pick)
    expect(toolPick).not.toHaveBeenCalled()
    controller.onPointerLeave()
    expect(hover).toHaveBeenLastCalledWith(null)
    expect(toolHover).toHaveBeenLastCalledWith(null)
  })
})
