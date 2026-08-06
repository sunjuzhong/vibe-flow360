import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  qualityRangeSliderPosition,
  qualityRangeSliderValue,
  SurfaceQualityFilterPanel,
} from './SurfaceQualityFilterPanel'

describe('SurfaceQualityFilterPanel', () => {
  it('renders compound rules, operator, persistence state, and match count', () => {
    const markup = renderToStaticMarkup(
      <SurfaceQualityFilterPanel
        fields={[
          { name: 'area', kind: 'scalar', min: 1e-8, max: 1e-4 },
          { name: 'skewness', kind: 'scalar', min: 0, max: 1 },
        ]}
        filter={{
          enabled: true,
          operator: 'and',
          rules: [
            { id: 'area-rule', fieldName: 'area', min: 1e-8, max: 1e-6 },
            { id: 'skew-rule', fieldName: 'skewness', min: 0.8, max: 1 },
          ],
        }}
        matchCount={42}
        onAddRule={vi.fn()}
        onRemoveRule={vi.fn()}
        onUpdateRule={vi.fn()}
        onEnabledChange={vi.fn()}
        onOperatorChange={vi.fn()}
        onReset={vi.fn()}
      />,
    )

    expect(markup).toContain('Triangle range filter')
    expect(markup).toContain('ALL rules (AND)')
    expect(markup).toContain('AND Rule 2')
    expect(markup).toContain('area')
    expect(markup).toContain('skewness')
    expect(markup).toContain('42 matched')
    expect(markup).toContain('aria-label="Rule 1 minimum area"')
    expect(markup).toContain('aria-label="Rule 2 maximum skewness"')
  })

  it('maps ordinary ranges linearly and small dynamic ranges logarithmically', () => {
    const skewness = { name: 'skewness', kind: 'scalar' as const, min: 0, max: 1 }
    const area = { name: 'area', kind: 'scalar' as const, min: 1e-8, max: 1e-4 }

    expect(qualityRangeSliderPosition(skewness, 0.25)).toBe(250)
    expect(qualityRangeSliderValue(skewness, 750)).toBeCloseTo(0.75)
    expect(qualityRangeSliderPosition(area, 1e-6)).toBe(500)
    expect(qualityRangeSliderValue(area, 500)).toBeCloseTo(1e-6)
  })
})
