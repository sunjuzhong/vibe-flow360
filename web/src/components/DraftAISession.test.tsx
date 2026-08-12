import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
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
})
