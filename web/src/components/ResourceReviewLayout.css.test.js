import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const layoutStyles = readFileSync(new URL('./ResourceReviewLayout.css', import.meta.url), 'utf8')

describe('ResourceReviewLayout styles', () => {
  it('keeps VolumeMesh inventory rows at the compact shared height', () => {
    expect(layoutStyles).toMatch(
      /\.volume-review-workspace \.resource-review-inventory \.volume-zone-row\s*\{\s*min-height:\s*34px;/,
    )
    expect(layoutStyles).not.toMatch(
      /\.volume-review-workspace \.resource-review-inventory \.volume-zone-row\s*\{\s*min-height:\s*62px;/,
    )
  })
})
