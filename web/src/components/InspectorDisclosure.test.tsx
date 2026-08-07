import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import InspectorDisclosure from './InspectorDisclosure'

describe('InspectorDisclosure', () => {
  it('renders metadata collapsed by default with a semantic summary', () => {
    const markup = renderToStaticMarkup(
      <InspectorDisclosure label="Resource">
        <dl><div><dt>Name</dt><dd>Wing</dd></div></dl>
      </InspectorDisclosure>,
    )

    expect(markup).toContain('<details class="inspector-section inspector-disclosure">')
    expect(markup).not.toContain('<details open=""')
    expect(markup).toContain('<summary>')
    expect(markup).toContain('Resource')
    expect(markup).toContain('<dd>Wing</dd>')
  })
})
