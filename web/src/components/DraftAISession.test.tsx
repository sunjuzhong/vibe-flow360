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
        mode="edit"
        loading={false}
        onPromptChange={() => undefined}
        onQuickPrompt={() => undefined}
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
        mode="edit"
        loading={false}
        onPromptChange={() => undefined}
        onQuickPrompt={() => undefined}
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

  it('renders GFM Markdown without rendering raw HTML', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider><DraftAISession
        messages={[{
          id: 'markdown', role: 'assistant', content: '# Update\n\n- first\n- second with `inline`\n\n```ts\nconst cfl = 3\n```\n\n[Flow360](https://www.flow360.com) [unsafe](javascript:alert(1)) <img src=x onerror=alert(1)>',
        }]}
        prompt=""
        mode="edit"
        loading={false}
        onPromptChange={() => undefined}
        onQuickPrompt={() => undefined}
        onSubmit={() => undefined}
        onClose={() => undefined}
      /></I18nProvider>,
    )

    expect(markup).toContain('<h1>Update</h1>')
    expect(markup).toContain('<ul>')
    expect(markup).toContain('<code>inline</code>')
    expect(markup).toContain('<pre><code class="language-ts">const cfl = 3')
    expect(markup).toContain('<a href="https://www.flow360.com">Flow360</a>')
    expect(markup).not.toContain('javascript:')
    expect(markup).not.toContain('<img')
  })

  it('renders the validation repair quick prompt without parameter edit or explanation shortcuts', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider><DraftAISession
        messages={[]}
        prompt=""
        mode="repair"
        loading={false}
        onPromptChange={() => undefined}
        onQuickPrompt={() => undefined}
        onSubmit={() => undefined}
        onClose={() => undefined}
      /></I18nProvider>,
    )

    expect(markup).toContain('aria-label="Quick prompts"')
    expect(markup).toContain('Fix validation')
    expect(markup).not.toContain('Modify parameters')
    expect(markup).not.toContain('Explain a parameter')
    expect(markup).toContain('aria-pressed="true"')
  })
})
