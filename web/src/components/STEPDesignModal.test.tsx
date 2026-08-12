import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import STEPDesignModal, { stepJobProgress } from './STEPDesignModal'

describe('STEPDesignModal', () => {
  it('uses the shared Project AI Create session structure', () => {
    const markup = renderToStaticMarkup(<I18nProvider><STEPDesignModal mode="new" folderId="stepfolder-1" onClose={() => undefined} onCompleted={() => undefined} /></I18nProvider>)
    expect(markup).toContain('ai-create-overlay')
    expect(markup).toContain('ai-create-modal')
    expect(markup).toContain('ai-create-intent-input')
    expect(markup).toContain('AI DESIGN')
    expect(markup).toContain('Describe the STEP geometry you want')
    expect(markup).not.toContain('step-library-ai')
  })

  it('adapts STEP jobs to the shared progress stages', () => {
    const progress = stepJobProgress({
      id: 'stepai-1', status: 'running', stage: 'generating', progress: 55,
      detail: 'Generating', request: { prompt: 'Create a wheel' },
      created_at: '2026-08-12T00:00:00Z', updated_at: '2026-08-12T00:00:01Z',
    })
    expect(progress.stage).toBe(2)
    expect(progress.stages).toEqual(['Understanding geometry', 'Designing exact CAD', 'Generating and validating STEP', 'Saving version'])
  })
})
