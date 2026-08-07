import { describe, expect, it } from 'vitest'
import { formatJSON, jsonSyntaxIssue } from './JsonEditor'

describe('JSON editor helpers', () => {
  it('formats valid JSON without changing its value', () => {
    expect(formatJSON('{"meshing":{"enabled":true}}')).toBe(`{\n  "meshing": {\n    "enabled": true\n  }\n}`)
  })

  it('reports invalid JSON and accepts valid JSON', () => {
    expect(jsonSyntaxIssue('{"a":1}')).toBe('')
    expect(jsonSyntaxIssue('{"a":}')).not.toBe('')
  })
})
