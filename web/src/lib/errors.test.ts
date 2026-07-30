import { describe, expect, it } from 'vitest'
import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('uses native error messages without corrupting their type name', () => {
    expect(errorMessage(new Error('request failed'))).toBe('request failed')
    expect(errorMessage(new SyntaxError('Expected property name'))).toBe('Expected property name')
  })

  it('only removes an Error prefix at the start of non-Error values', () => {
    expect(errorMessage('Error: request failed')).toBe('request failed')
    expect(errorMessage('SyntaxError: Expected property name')).toBe('SyntaxError: Expected property name')
  })
})
