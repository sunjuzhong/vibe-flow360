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

  it('accepts shared expansion overrides by JSON path', () => {
    const value = { nested: { answer: 42 } }
    const collapsedRoot = renderToStaticMarkup(<JsonPreview value={value} expansion={{ $: false }} />)
    const collapsedNested = renderToStaticMarkup(<JsonPreview value={value} expansion={{ $: true, '$/nested': false }} />)
    const expandedNested = renderToStaticMarkup(<JsonPreview value={value} expansion={{ $: true, '$/nested': true }} />)

    expect(collapsedRoot).not.toContain('nested')
    expect(collapsedNested).toContain('nested')
    expect(collapsedNested).not.toContain('answer')
    expect(expandedNested).toContain('answer')
  })
})
