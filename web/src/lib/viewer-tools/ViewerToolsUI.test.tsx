import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceViewerToolsModel } from '../../hooks/useWorkspaceViewerTools'
import { BASIC_TOOLS, polylineToolDefinition } from './basic-tools'
import { positionViewerToolsMenu, shouldDismissViewerToolsMenu, ViewerToolPanel, ViewerToolsDock } from './ViewerToolsUI'

function model(overrides: Partial<WorkspaceViewerToolsModel> = {}): WorkspaceViewerToolsModel {
  const idleDistance = {
    session: { status: 'idle' }, pointCount: 0, result: null, error: null,
    activate: vi.fn(), retry: vi.fn(), discard: vi.fn(), resumeDraft: vi.fn(), save: vi.fn(),
  }
  const armedBasic = {
    tools: BASIC_TOOLS,
    activeToolId: 'polyline',
    definition: polylineToolDefinition,
    session: { status: 'armed', tool: polylineToolDefinition, points: [], hover: null },
    active: true,
    pointCount: 0,
    prompt: 'Select the first point for Polyline.',
    notice: null,
    error: null,
    resultSummary: null,
    activate: vi.fn(), retry: vi.fn(), discard: vi.fn(), resumeDraft: vi.fn(), save: vi.fn(),
  }
  return {
    distance: idleDistance,
    basic: armedBasic,
    activeToolId: 'polyline',
    panelOpen: true,
    activateDistance: vi.fn(),
    activateBasic: vi.fn(),
    closeActive: vi.fn(),
    ...overrides,
  } as unknown as WorkspaceViewerToolsModel
}

describe('ViewerToolsUI', () => {
  it('dismisses only for targets outside the launcher and portaled menu', () => {
    const launcherTarget = {} as Node
    const menuTarget = {} as Node
    const outsideTarget = {} as Node
    const launcher = { contains: (target: Node) => target === launcherTarget }
    const menu = { contains: (target: Node) => target === menuTarget }

    expect(shouldDismissViewerToolsMenu(launcherTarget, launcher, menu)).toBe(false)
    expect(shouldDismissViewerToolsMenu(menuTarget, launcher, menu)).toBe(false)
    expect(shouldDismissViewerToolsMenu(outsideTarget, launcher, menu)).toBe(true)
  })

  it('keeps the portaled menu inside the viewport and right-aligns it to the launcher', () => {
    expect(positionViewerToolsMenu(
      { top: 700, right: 590 },
      { width: 800, height: 900 },
    )).toEqual({ left: 240, bottom: 210, width: 350 })
    expect(positionViewerToolsMenu(
      { top: 300, right: 120 },
      { width: 320, height: 600 },
    )).toEqual({ left: 10, bottom: 310, width: 300 })
  })

  it('opens one compact launcher containing every registered tool', () => {
    const html = renderToStaticMarkup(<ViewerToolsDock model={model()} initiallyOpen />)
    expect(html).toContain('aria-expanded="true"')
    for (const label of [
      'Tools', 'Distance', 'Point Marker', 'Line', 'Sphere', 'Polyline', 'Angle', 'Circle', 'Area', 'Box',
    ]) {
      expect(html).toContain(label)
    }
  })

  it('renders active tool guidance in the floating interaction panel', () => {
    const html = renderToStaticMarkup(<ViewerToolPanel model={model()} />)
    expect(html).toContain('ACTIVE TOOL')
    expect(html).toContain('Polyline')
    expect(html).toContain('Select the first point for Polyline.')
    expect(html).toContain('Close Polyline tool')
  })

  it('keeps distance result and persistence actions in the floating panel', () => {
    const distance = {
      session: {
        status: 'complete-draft',
        points: [],
        result: { length: 2, deltaXYZ: [1, 1, 0], endpoints: [], unit: 'm' },
      },
      pointCount: 2,
      result: { length: 2, deltaXYZ: [1, 1, 0], endpoints: [], unit: 'm' },
      error: null,
      activate: vi.fn(), retry: vi.fn(), discard: vi.fn(), resumeDraft: vi.fn(), save: vi.fn(),
    }
    const html = renderToStaticMarkup(<ViewerToolPanel model={model({
      activeToolId: 'distance',
      distance: distance as never,
    })} />)
    expect(html).toContain('Distance')
    expect(html).toContain('2.000000')
    expect(html).toContain('Save')
    expect(html).toContain('Discard')
  })
})
