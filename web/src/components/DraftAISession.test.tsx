import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AgentAction } from '../api/client'
import { I18nProvider } from '../i18n'
import { draftAIClarificationMessage } from './DraftParameterEditor'
import DraftAISession from './DraftAISession'

describe('DraftAISession', () => {
  it('renders an accessible empty Draft session and composer', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider><DraftAISession
        messages={[]}
        prompt=""
        loading={false}
        onPromptChange={() => undefined}
        onSubmit={() => undefined}
        onClose={() => undefined}
      /></I18nProvider>,
    )

    expect(markup).toContain('aria-label="AI Draft session"')
    expect(markup).toContain('No AI changes yet')
    expect(markup).toContain('aria-label="Describe the Draft change"')
    expect(markup).toContain('aria-label="Close AI Draft session"')
    expect(markup).toContain('lower CFL to 3')
  })

  it('keeps user, AI, errors, and parameter diffs in the transcript', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider><DraftAISession
        messages={[
          { id: '1', role: 'user', content: 'Set alpha to 5 degrees.' },
          { id: '2', role: 'assistant', content: 'Updated alpha.', changes: [{ path: 'alpha', before: 0, after: 5, kind: 'changed' }] },
          { id: '3', role: 'error', content: 'Provider unavailable.' },
        ]}
        prompt=""
        loading={false}
        onPromptChange={() => undefined}
        onSubmit={() => undefined}
        onClose={() => undefined}
      /></I18nProvider>,
    )

    expect(markup).toContain('Set alpha to 5 degrees.')
    expect(markup).toContain('Updated alpha.')
    expect(markup).toContain('1 parameter changes')
    expect(markup).toContain('Provider unavailable.')
    expect(markup).toContain('AI change failed')
  })

  it('renders a missing-input response without mislabeling it as a failure', () => {
    const action: AgentAction = {
      version: 'v1',
      kind: 'request-missing-input',
      message: 'Unable to determine which plan form fields to edit.',
      questions: [{
        field: 'operating_condition.velocity_magnitude',
        message: 'Please specify the field and value.',
        urgency: 'required',
        reason: 'Several active stages contain plausible settings.',
      }],
    }
    const markup = renderToStaticMarkup(
      <I18nProvider><DraftAISession
        messages={[{ id: 'clarification', role: 'assistant', content: draftAIClarificationMessage(action) }]}
        prompt=""
        loading={false}
        onPromptChange={() => undefined}
        onSubmit={() => undefined}
        onClose={() => undefined}
      /></I18nProvider>,
    )

    expect(markup).toContain('Unable to determine which plan form fields to edit.')
    expect(markup).toContain('operating_condition.velocity_magnitude')
    expect(markup).toContain('Several active stages contain plausible settings.')
    expect(markup).not.toContain('AI change failed')
  })
})
