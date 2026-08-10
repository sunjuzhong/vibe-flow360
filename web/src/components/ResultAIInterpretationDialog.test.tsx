import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { ResultAIInterpretationDialog, ResultMarkdown } from './ResultAIInterpretationDialog'

describe('ResultAIInterpretationDialog', () => {
  it('renders an accessible conversation dialog while preparing the fingerprint', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider><ResultAIInterpretationDialog open input={null} onClose={() => undefined} /></I18nProvider>,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('Preparing data fingerprint…')
    expect(markup).toContain('Ask about fields, convergence, anomalies, or next checks…')
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
})
