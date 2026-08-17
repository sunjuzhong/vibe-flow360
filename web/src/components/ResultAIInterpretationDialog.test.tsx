import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { APIError } from '../api/client'
import { ResultAIInterpretationDialog, ResultMarkdown, resultConversationMessages, resultInterpretationErrorMessage } from './ResultAIInterpretationDialog'

describe('ResultAIInterpretationDialog', () => {
  it('renders an accessible side panel while preparing the fingerprint', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider><ResultAIInterpretationDialog open input={null} onClose={() => undefined} /></I18nProvider>,
    )

    expect(markup).toContain('role="complementary"')
    expect(markup).toContain('result-ai-panel')
    expect(markup).not.toContain('result-ai-modal')
    expect(markup).toContain('Preparing data fingerprint…')
    expect(markup).toContain('Ask about fields, convergence, anomalies, or next checks…')
  })

  it('uses the API error message without leaking the APIError class name', () => {
    expect(resultInterpretationErrorMessage(new APIError('AI interpretation is temporarily unavailable')))
      .toBe('AI interpretation is temporarily unavailable')
  })

  it('renders headings, tables, lists, code, and safe links from Markdown', () => {
    const markup = renderToStaticMarkup(
      <ResultMarkdown>{`## Field dictionary

| Field | Meaning |
| --- | --- |
| \`0_cont\` | Continuity residual |

- Check decay

[Flow360](https://flow360.com)`}</ResultMarkdown>,
    )

    expect(markup).toContain('<h2>Field dictionary</h2>')
    expect(markup).toContain('<table>')
    expect(markup).toContain('<code>0_cont</code>')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noreferrer"')
  })

  it('shows a submitted question optimistically before the AI reply arrives', () => {
    const messages = resultConversationMessages(
      [{ role: 'assistant', content: 'Earlier answer' }],
      'Why did continuity plateau?',
    )

    expect(messages).toEqual([
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'Why did continuity plateau?' },
    ])
  })
})
