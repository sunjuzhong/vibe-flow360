import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VIEWER_ANNOTATION_SCHEMA_VERSION, type ViewerAnnotation } from '../../lib/viewer-tools/types'
import { AnnotationPanel, annotationSummary, filterAnnotations } from './AnnotationPanel'

function annotation(): ViewerAnnotation<{ distance: number }> {
  const resourceRef = { id: 'mesh-1', type: 'surface-mesh' }
  return {
    schemaVersion: VIEWER_ANNOTATION_SCHEMA_VERSION,
    id: 'ann-1',
    projectId: 'project-1',
    resourceRef,
    coordinateFrame: { kind: 'asset-local', resourceRef },
    toolId: 'distance',
    name: 'Wing span',
    points: [],
    result: { distance: 12.5 },
    style: {},
    visible: true,
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T01:00:00Z',
  }
}

function model(overrides: Record<string, unknown> = {}) {
  return {
    annotations: [annotation()],
    loading: false,
    error: null,
    savingIds: [],
    retry: vi.fn(async () => undefined),
    rename: vi.fn(async () => true),
    setVisible: vi.fn(async () => true),
    remove: vi.fn(async () => true),
    ...overrides,
  }
}

describe('AnnotationPanel', () => {
  it('renders tool, name, source, summary, visibility, updated time and accessible actions', () => {
    const html = renderToStaticMarkup(<AnnotationPanel model={model()} onFocus={vi.fn()} />)

    expect(html).toContain('Wing span')
    expect(html).toContain('distance')
    expect(html).toContain('surface-mesh: mesh-1')
    expect(html).toContain('{&quot;distance&quot;:12.5}')
    expect(html).toContain('Visible')
    expect(html).toContain('dateTime="2026-08-03T01:00:00Z"')
    expect(html).toContain('aria-label="Focus Wing span"')
    expect(html).toContain('aria-label="Hide Wing span"')
    expect(html).toContain('aria-label="Rename Wing span"')
    expect(html).toContain('aria-label="Delete Wing span"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Annotation filters"')
    expect(html).toContain('All tools')
    expect(html).toContain('All resources')
  })

  it('renders loading, retryable error and empty states', () => {
    expect(renderToStaticMarkup(
      <AnnotationPanel model={model({ loading: true })} onFocus={vi.fn()} />,
    )).toContain('Loading annotations')

    const empty = renderToStaticMarkup(<AnnotationPanel
      model={model({ annotations: [], error: 'Request failed' })}
      onFocus={vi.fn()}
    />)
    expect(empty).toContain('role="alert"')
    expect(empty).toContain('aria-label="Retry loading project annotations"')
    expect(empty).toContain('No annotations in this project.')
  })

  it('keeps summaries compact', () => {
    expect(annotationSummary({ value: 'x'.repeat(200) }).length).toBeLessThanOrEqual(120)
  })

  it('combines visibility, tool and resource filters', () => {
    const distance = annotation()
    const point: ViewerAnnotation<{ distance: number }> = {
      ...annotation(),
      id: 'ann-2',
      toolId: 'point-marker',
      visible: false,
      resourceRef: { id: 'case-1', type: 'case' },
    }
    const annotations = [distance, point]

    expect(filterAnnotations(annotations, 'visible', '', '')).toEqual([distance])
    expect(filterAnnotations(annotations, 'hidden', 'point-marker', '')).toEqual([point])
    expect(filterAnnotations(
      annotations,
      'all',
      '',
      JSON.stringify(['case', 'case-1']),
    )).toEqual([point])
    expect(filterAnnotations(
      annotations,
      'visible',
      'point-marker',
      JSON.stringify(['case', 'case-1']),
    )).toEqual([])
  })

  it('renders an explicit no-match state when a non-empty filtered set is empty', () => {
    expect(filterAnnotations([annotation()], 'hidden', '', '')).toEqual([])
  })
})
