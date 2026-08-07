import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import JsonPreview from './JsonPreview'

describe('JSON preview', () => {
  it('renders a typed, collapsible JSON tree', () => {
    const markup = renderToStaticMarkup(<JsonPreview value={{ steps: 10, enabled: true, name: 'case', missing: null }} />)
    expect(markup).toContain('JSON Preview')
    expect(markup).toContain('steps')
    expect(markup).toContain('json-token number')
    expect(markup).toContain('json-token boolean')
    expect(markup).toContain('json-token string')
    expect(markup).toContain('json-token null')
  })

  it('renders an explicit empty state', () => {
    expect(renderToStaticMarkup(<JsonPreview value={{}} empty="No parameters" />)).toContain('No parameters')
  })
})
