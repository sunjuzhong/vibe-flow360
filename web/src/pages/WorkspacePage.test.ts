import { describe, expect, it } from 'vitest'
import { formatProjectCreatedAt } from './WorkspacePage'

describe('formatProjectCreatedAt', () => {
  it('formats a Flow360 creation timestamp for display', () => {
    const formatted = formatProjectCreatedAt('2026-08-03T12:52:09.687572841Z')

    expect(formatted).toContain('2026')
    expect(formatted).not.toBe('—')
  })

  it('uses a stable placeholder when creation time is unavailable', () => {
    expect(formatProjectCreatedAt()).toBe('—')
    expect(formatProjectCreatedAt('not-a-date')).toBe('—')
  })
})
