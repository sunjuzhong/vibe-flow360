import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import AICreateModal, {
  AI_CREATE_INTENT_MAX_CHARACTERS,
  AICreateClarificationForm,
  AICreateProgressView,
  aiCreateIntentCharacterCount,
  aiCreateIntentLimit,
  aiCreateProgressStageState,
  appendSubmittedAICreateTurn,
  errorMessage,
  initialAICreateAnswers,
  serializedAICreateAnswers,
} from './AICreateModal'

function renderWithI18n(node: ReactNode) {
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>)
}

describe('AICreateModal', () => {
  it('presents natural-language project creation and the approval boundary', () => {
    const markup = renderWithI18n(
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
    expect(markup).toContain('checkpoints exact CAD')
    expect(markup).toContain('Minimize AI Create session')
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

  it('keeps submitted requirements and clarification answers in the session transcript', () => {
    const initial = appendSubmittedAICreateTurn([], 'Create a cylinder-flow simulation')
    const answered = appendSubmittedAICreateTurn(initial, 'ignored', 'Reynolds number: 3900')
    expect(answered).toEqual([
      { role: 'user', text: 'Create a cylinder-flow simulation' },
      { role: 'user', text: 'Reynolds number: 3900' },
    ])
    expect(appendSubmittedAICreateTurn(answered, 'ignored', 'Reynolds number: 3900')).toBe(answered)
  })

  it('requires a destination folder', () => {
    const markup = renderWithI18n(<AICreateModal folder={null} onClose={() => undefined} onCreated={() => undefined} />)
    expect(markup).toContain('Select a destination folder first')
    expect(markup).toContain('disabled=""')
  })

  it('restores saved history and explains the next action before resuming', () => {
    const markup = renderWithI18n(<AICreateModal
      folder={{ id: 'folder-1', name: 'Experiments', subfolders: [] }}
      initialSession={{
        id: 'aic-resume', intent: 'Create a drop-body case', original_request: 'Create a drop-body case',
        folder_id: 'folder-1', phase: 'needs_input', round: 2,
        messages: [{ role: 'user', content: 'Create a drop-body case', created_at: '2026-08-15T00:00:00Z' }],
        history: [{ round: 1, fields: [{ id: 'mach', label: 'Mach number', type: 'number', required: true }], answers: { mach: 0.8 } }],
        pending: [{ id: 'altitude', label: 'Flight altitude', type: 'number', unit: 'm', required: true }],
        checkpoints: { cad_validated: true, project_created: true, parameters_validated: false, draft_configured: false },
        created_at: '2026-08-15T00:00:00Z', updated_at: '2026-08-15T00:05:00Z',
      }}
      onClose={() => undefined}
      onCreated={() => undefined}
    />)
    expect(markup).toContain('Continue this simulation')
    expect(markup).toContain('Review the saved request, decisions, and checkpoints')
    expect(markup).toContain('Conversation history')
    expect(markup).toContain('Mach number')
    expect(markup).toContain('Flight altitude')
    expect(markup).toContain('Clarification round 2')
  })

  it('offers to reconstruct questions for a legacy needs-input session', () => {
    const markup = renderWithI18n(<AICreateModal
      folder={{ id: 'folder-1', name: 'Experiments', subfolders: [] }}
      initialSession={{
        id: 'aic-legacy', intent: 'Create a drop-body case', original_request: 'Create a drop-body case',
        folder_id: 'folder-1', phase: 'needs_input', round: 2, messages: [], history: [], pending: [],
        checkpoints: { cad_validated: false, project_created: false, parameters_validated: false, draft_configured: false },
        created_at: '2026-08-15T00:00:00Z', updated_at: '2026-08-15T00:05:00Z',
      }}
      onClose={() => undefined}
      onCreated={() => undefined}
    />)
    expect(markup).toContain('Pending questions need recovery')
    expect(markup).toContain('Restore pending questions')
  })

  it('renders agent clarification fields as an engineering form', () => {
    const markup = renderWithI18n(
      <AICreateClarificationForm
        round={2}
        busy={false}
        fields={[
          { id: 'diameter', label: 'Cylinder diameter', description: 'A practical external-flow baseline.', type: 'number', required: true, unit: 'm', default: 0.1, min: 0.001, max: 100 },
          { id: 'domain', label: 'Domain model', type: 'select', required: true, default: 'finite', options: [{ value: 'symmetry', label: 'Spanwise symmetry' }, { value: 'finite', label: 'Finite span' }] },
          { id: 'wind_tunnel', label: 'Use a wind tunnel?', type: 'boolean', required: false, default: false },
          { id: 'objective', label: 'Study objective', type: 'text', required: true, default: 'Vortex shedding' },
        ]}
        values={{ diameter: 0.1, domain: 'finite', wind_tunnel: false, objective: 'Vortex shedding' }}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(markup).toContain('Clarification round 2')
    expect(markup).toContain('Cylinder diameter')
    expect(markup).toContain('m</b>')
    expect(markup).toContain('Spanwise symmetry')
    expect(markup).toContain('Use a wind tunnel?')
    expect(markup).toContain('4 Agent recommendations prefilled')
    expect(markup).toContain('Agent recommendation')
    expect(markup).toContain('class="ai-create-field field-number recommended"')
    expect(markup).toContain('Confirm recommended values &amp; continue')
  })

  it('initializes and serializes shared Project and STEP clarification defaults', () => {
    const fields = [
      { id: 'diameter', label: 'Diameter', type: 'number' as const, required: true, default: 0.1 },
      { id: 'finite_span', label: 'Finite span', type: 'boolean' as const, required: true, default: false },
    ]
    expect(initialAICreateAnswers(fields)).toEqual({ diameter: 0.1, finite_span: false })
    expect(serializedAICreateAnswers(fields, { diameter: '0.25', finite_span: false })).toEqual({ diameter: 0.25, finite_span: false })
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

    const markup = renderWithI18n(<AICreateProgressView progress={progress} />)
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

  it('renders completed backend progress as an auditable checkpoint', () => {
    const progress = {
      request_id: 'aip-completed',
      status: 'completed' as const,
      stage: 2,
      stages: ['Design CAD', 'Create Project', 'Configure Draft'],
      detail: 'Project and existing Draft are ready for review.',
      started_at: '2026-08-05T00:00:00Z',
      updated_at: '2026-08-05T00:00:01Z',
    }
    const markup = renderWithI18n(<AICreateProgressView progress={progress} />)
    expect(markup).toContain('status-completed')
    expect(markup.match(/class="complete"/g)).toHaveLength(3)
    expect(markup).toContain('Project and existing Draft are ready for review.')
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
