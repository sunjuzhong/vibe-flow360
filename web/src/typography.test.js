import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const geometryStyles = readFileSync(
  new URL('./components/GeometryWorkspace.css', import.meta.url),
  'utf8',
)

describe('Web typography tokens', () => {
  it('defines the shared readable type scale and font roles', () => {
    for (const token of [
      '--font-sans',
      '--font-mono',
      '--text-xs: 11px',
      '--text-sm: 12px',
      '--text-md: 14px',
      '--text-lg: 16px',
      '--text-xl: 20px',
      '--leading-compact',
      '--leading-body',
      '--weight-regular',
      '--weight-semibold',
    ]) {
      expect(styles).toContain(token)
    }
  })

  it('keeps advanced diagnostics readable and its help content unclipped', () => {
    expect(geometryStyles).toContain('.geometry-advanced-diagnostics')
    expect(geometryStyles).toContain('font-size: var(--text-md)')
    expect(geometryStyles).toContain('overflow: visible')
    expect(styles).toContain('.help-tooltip--guide .help-tooltip__content')
    expect(styles).toContain('width: min(520px, calc(100vw - 32px))')
    expect(styles).toContain('max-height: calc(100dvh - 48px)')
    expect(styles).toContain('overflow-y: auto')
  })
})
