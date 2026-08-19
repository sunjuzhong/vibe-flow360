import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HelpTooltip, { placeTooltip } from './HelpTooltip'

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

  it('keeps a long tooltip inside the viewport and flips when needed', () => {
    expect(placeTooltip(
      { left: 650, right: 672, top: 210, bottom: 232, width: 22, height: 22 },
      { width: 340, height: 190 },
      { width: 700, height: 400 },
      'bottom',
      'start',
    )).toEqual({ left: 348, top: 13 })
  })
})
