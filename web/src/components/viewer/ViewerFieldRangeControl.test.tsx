import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import {
  normalizeViewerFieldRange,
  resolveViewerFieldDomain,
  ViewerFieldRangeControl,
  viewerFieldRangeGradient,
  viewerFieldRangeSliderPosition,
  viewerFieldRangeSliderValue,
} from './ViewerFieldRangeControl'

describe('ViewerFieldRangeControl', () => {
  it('maps linear and logarithmic field values to slider positions and back', () => {
    expect(viewerFieldRangeSliderPosition(0, 100, 25, 'linear')).toBe(250)
    expect(viewerFieldRangeSliderValue(0, 100, 250, 'linear')).toBe(25)
    expect(viewerFieldRangeSliderPosition(1e-6, 1, 1e-3, 'log')).toBe(500)
    expect(viewerFieldRangeSliderValue(1e-6, 1, 500, 'log')).toBeCloseTo(1e-3)
  })

  it('normalizes reversed and invalid input ranges against the field bounds', () => {
    expect(normalizeViewerFieldRange([8, 2], 0, 10)).toEqual([2, 8])
    expect(normalizeViewerFieldRange([-5, 20], 0, 10)).toEqual([0, 10])
    expect(normalizeViewerFieldRange([5, 5], 0, 10)).toEqual([0, 10])
  })

  it('keeps an explicit cross-frame domain outside the current frame extrema', () => {
    expect(resolveViewerFieldDomain([-10, 20], 0, 1)).toEqual([-10, 20])
    expect(resolveViewerFieldDomain([20, -10], 0, 1)).toEqual([-10, 20])
    expect(resolveViewerFieldDomain(null, 0, 1)).toEqual([0, 1])
  })

  it('keeps logarithmic values finite at the field endpoints', () => {
    expect(viewerFieldRangeSliderValue(1e-12, 1, 0, 'log')).toBeCloseTo(1e-12)
    expect(viewerFieldRangeSliderValue(1e-12, 1, 1000, 'log')).toBeCloseTo(1)
  })

  it('renders two accessible handles over an endpoint-clamped gradient', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ViewerFieldRangeControl
          fieldName="Cf"
          min={1e-6}
          max={1}
          range={[1e-4, 1e-1]}
          scale="log"
          colormap="turbo"
          onChange={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(html).toContain('role="group"')
    expect(html).toContain('aria-label="Minimum color range · Cf"')
    expect(html).toContain('aria-label="Maximum color range · Cf"')
    expect(html.match(/type="range"/g)).toHaveLength(2)
    expect(viewerFieldRangeGradient('turbo', 200, 800)).toContain(' 20%')
    expect(viewerFieldRangeGradient('turbo', 200, 800)).toContain(' 80%')
  })
})
