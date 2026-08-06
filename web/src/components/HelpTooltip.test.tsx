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
})
