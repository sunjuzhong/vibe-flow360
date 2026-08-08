import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HelpTooltip from './HelpTooltip'

describe('HelpTooltip', () => {
  it('associates accessible help text with a compact trigger', () => {
    const markup = renderToStaticMarkup(
      <HelpTooltip label="About Drafts">Drafts are editable configurations.</HelpTooltip>,
    )

    expect(markup).toContain('aria-label="About Drafts"')
    expect(markup).toMatch(/aria-describedby="[^"]+"/)
    expect(markup).toMatch(/id="[^"]+" role="tooltip"/)
    expect(markup).toContain('Drafts are editable configurations.')
  })

  it('supports structured wide help without flattening it into a paragraph', () => {
    const markup = renderToStaticMarkup(
      <HelpTooltip label="About diagnostics" width="wide">
        <div className="help-tooltip__rich">
          <header><strong>Method</strong><span>Summary</span></header>
          <dl><div><dt>Edges</dt><dd>Incidence counting</dd></div></dl>
        </div>
      </HelpTooltip>,
    )

    expect(markup).toContain('help-tooltip--wide')
    expect(markup).toContain('<dt>Edges</dt>')
    expect(markup).toContain('<dd>Incidence counting</dd>')
  })
})
