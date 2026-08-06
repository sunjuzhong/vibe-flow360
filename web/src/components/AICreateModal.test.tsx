import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AICreateModal, {
  AI_CREATE_INTENT_MAX_CHARACTERS,
  AICreateClarificationForm,
  AICreateProgressView,
  aiCreateIntentCharacterCount,
  aiCreateIntentLimit,
  aiCreateProgressStageState,
  errorMessage,
} from './AICreateModal'

describe('AICreateModal', () => {
  it('presents natural-language project creation and the approval boundary', () => {
    const markup = renderToStaticMarkup(
      <AICreateModal
        folder={{ id: 'folder-1', name: 'Experiments', subfolders: [] }}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    )
    expect(markup).toContain('AI CREATE')
    expect(markup).toContain('Describe the simulation you want')
    expect(markup).toContain('Destination · Experiments')
    expect(markup).toContain('Paid remote meshing and solving still require approval')
    expect(markup).toContain('builds the goal over multiple steps')
    expect(markup).toContain('collect missing dimensions and operating decisions step by step')
    expect(markup).toContain('0 / 4,000 characters')
    expect(markup).toContain('aria-describedby="ai-create-intent-limit"')
    expect(markup).toContain('role="dialog"')
    expect(markup).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('counts Unicode characters and reports near/over-limit states', () => {
    expect(aiCreateIntentCharacterCount('圆柱😀flow')).toBe(7)
    expect(aiCreateIntentLimit('a'.repeat(3_500))).toMatchObject({ characters: 3_500, remaining: 500, nearLimit: true, overLimit: false })
    expect(aiCreateIntentLimit('圆'.repeat(AI_CREATE_INTENT_MAX_CHARACTERS + 25))).toMatchObject({
      characters: 4_025,
      remaining: -25,
      nearLimit: false,
      overLimit: true,
    })
  })

  it('shows the actual browser network error without mangling its type name', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('Failed to fetch')
  })

  it('requires a destination folder', () => {
    const markup = renderToStaticMarkup(<AICreateModal folder={null} onClose={() => undefined} onCreated={() => undefined} />)
    expect(markup).toContain('Select a destination folder first')
    expect(markup).toContain('disabled=""')
  })

  it('renders agent clarification fields as an engineering form', () => {
    const markup = renderToStaticMarkup(
      <AICreateClarificationForm
        round={2}
        busy={false}
        fields={[
          { id: 'diameter', label: 'Cylinder diameter', description: 'Reference diameter', type: 'number', required: true, unit: 'm', min: 0.001, max: 100 },
          { id: 'domain', label: 'Domain model', type: 'select', required: true, options: [{ value: 'periodic', label: 'Thin periodic' }, { value: 'finite', label: 'Finite span' }] },
          { id: 'wind_tunnel', label: 'Use a wind tunnel?', type: 'boolean', required: false },
          { id: 'objective', label: 'Study objective', type: 'text', required: true },
        ]}
        values={{ diameter: 1, domain: 'periodic', wind_tunnel: false, objective: 'Vortex shedding' }}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(markup).toContain('Clarification round 2')
    expect(markup).toContain('Cylinder diameter')
    expect(markup).toContain('m</b>')
    expect(markup).toContain('Thin periodic')
    expect(markup).toContain('Use a wind tunnel?')
    expect(markup).toContain('Continue with answers')
  })

  it('renders backend-reported stages without synthesizing progress', () => {
    const progress = {
      request_id: 'aip-test-request-1234',
      status: 'running' as const,
      stage: 2,
      stages: ['Design CAD', 'Validate STEP', 'Process Flow360 Project', 'Create Draft'],
      detail: 'Flow360 is processing the uploaded Geometry.',
      project_id: 'prj-12345678',
      resource_id: 'geo-12345678',
      started_at: '2026-08-05T00:00:00Z',
      updated_at: '2026-08-05T00:00:01Z',
    }
    expect(progress.stages.map((_, index) => aiCreateProgressStageState(progress, index))).toEqual([
      'complete', 'complete', 'active', 'pending',
    ])

    const markup = renderToStaticMarkup(<AICreateProgressView progress={progress} />)
    expect(markup).toContain('Live backend status')
    expect(markup).toContain('Flow360 is processing the uploaded Geometry.')
    expect(markup).toContain('Project · <a class="id-link"')
    expect(markup).toContain('workbench/prj-12345678?id=geo-12345678&amp;type=Geometry')
    expect(markup).toContain('class="active"')
  })

  it('shows the current real stage as failed instead of completing later stages', () => {
    const progress = {
      request_id: 'aip-test-request-5678',
      status: 'failed' as const,
      stage: 1,
      stages: ['Design CAD', 'Validate STEP', 'Create Project'],
      detail: 'STEP round-trip validation failed.',
      started_at: '2026-08-05T00:00:00Z',
      updated_at: '2026-08-05T00:00:01Z',
    }
    expect(progress.stages.map((_, index) => aiCreateProgressStageState(progress, index))).toEqual([
      'complete', 'failed', 'pending',
    ])
  })

  it('pauses the real stage while a persisted backend request is recovering', () => {
    const progress = {
      request_id: 'aip-test-request-recovery',
      status: 'recovering' as const,
      stage: 4,
      stages: ['Design CAD', 'Validate STEP', 'Create Project', 'Load schemas', 'Create setup', 'Create Draft'],
      detail: 'The local backend restarted.',
      session_id: 'aic-recovery-session',
      started_at: '2026-08-05T00:00:00Z',
      updated_at: '2026-08-05T00:00:01Z',
    }
    expect(aiCreateProgressStageState(progress, 4)).toBe('paused')
  })
})
