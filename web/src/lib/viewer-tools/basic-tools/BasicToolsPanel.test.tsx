import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ViewerToolsModel } from '../../../hooks/useViewerTools'
import { BASIC_TOOLS, BasicToolsPanel, computePolylineResult, polylineToolDefinition } from './index'
import type { PickResult, ViewerAnnotation } from '../types'

const resourceRef = { id: 'geometry-1', type: 'Geometry' } as const
const points: readonly PickResult[] = [0, 1, 2].map((x) => ({
  localPosition: [x, 0, 0],
  worldPosition: [x, 0, 0],
  projectId: 'project-1',
  resourceRef,
  coordinateFrame: { kind: 'asset-local', resourceRef },
  snap: { type: 'surface' },
}))
const result = computePolylineResult(points)
const saved: ViewerAnnotation<typeof result> = {
  schemaVersion: 1,
  id: 'polyline-1',
  projectId: 'project-1',
  resourceRef,
  coordinateFrame: { kind: 'asset-local', resourceRef },
  toolId: 'polyline',
  name: 'Route',
  points,
  result,
  style: {},
  visible: true,
  createdAt: '2026-08-03T00:00:00Z',
  updatedAt: '2026-08-03T00:00:00Z',
}

describe('BasicToolsPanel', () => {
  it('renders registration buttons, draft actions, and saved summaries', async () => {
    const model = {
      tools: BASIC_TOOLS,
      activeToolId: 'polyline',
      definition: polylineToolDefinition,
      session: { status: 'complete-draft', tool: polylineToolDefinition, points, hover: null, result },
      active: true,
      capturing: false,
      pointCount: 3,
      result,
      resultSummary: 'Polyline · 2 segments · 2.000000 model units',
      prompt: null,
      notice: null,
      error: null,
      savedAnnotations: [saved],
      toolInput: { onPick: vi.fn() },
      overlays: {},
      activate: vi.fn(),
      toggle: vi.fn(),
      finish: vi.fn(),
      undoLast: vi.fn(),
      cancel: vi.fn(),
      discard: vi.fn(),
      retry: vi.fn(),
      resumeDraft: vi.fn(),
      save: vi.fn(async () => true),
      onDoubleClick: vi.fn(),
    } satisfies ViewerToolsModel

    const html = renderToStaticMarkup(<BasicToolsPanel model={model} />)
    expect(html).toContain('Point Marker')
    expect(html).toContain('Polyline')
    expect(html).toContain('Save')
    expect(html).toContain('Discard')
    expect(html).toContain('Route: Polyline · 2 segments')
  })
})
