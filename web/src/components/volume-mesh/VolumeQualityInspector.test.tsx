import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { VolumeQualityInspector } from './VolumeQualityInspector'

describe('VolumeQualityInspector', () => {
  it('shows the field selector before a quality field is selected', () => {
    const html = renderToStaticMarkup(createElement(
      I18nProvider,
      null,
      createElement(VolumeQualityInspector, {
        fields: [
          { name: 'Aspect Ratio', kind: 'scalar', min: 1, max: 10 },
          { name: 'Equiangle Skewness', kind: 'scalar', min: 0, max: 1 },
        ],
        field: undefined,
        range: null,
        histogram: null,
        extrema: null,
        probe: null,
        entityNames: {},
        onFieldChange: () => undefined,
        onRangeChange: () => undefined,
        onLocateExtreme: () => undefined,
      }),
    ))

    expect(html).toContain('<select')
    expect(html).toContain('Aspect Ratio')
    expect(html).toContain('Equiangle Skewness')
    expect(html).not.toContain('No scalar cell-quality field is present')
  })
})
