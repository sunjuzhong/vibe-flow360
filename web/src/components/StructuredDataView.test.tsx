import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { humanizeDataKey, StructuredDataView } from './StructuredDataView'

describe('StructuredDataView', () => {
  it('humanizes snake, kebab, and camel case keys', () => {
    expect(humanizeDataKey('private_attribute_input_cache')).toBe('Private Attribute Input Cache')
    expect(humanizeDataKey('thermalState')).toBe('Thermal State')
    expect(humanizeDataKey('reference-area')).toBe('Reference Area')
  })

  it('renders nested JSON as labeled structure instead of serialized text', () => {
    const html = renderToStaticMarkup(
      <StructuredDataView value={{
        private_attribute_input_cache: { model: 'Air', enabled: true },
        thermal_state: { temperature: { value: 288.15, units: 'K' } },
      }} />,
    )

    expect(html).toContain('Private Attribute Input Cache')
    expect(html).toContain('Thermal State')
    expect(html).toContain('Temperature')
    expect(html).toContain('288.15')
    expect(html).toContain('Yes')
    expect(html).not.toContain('&quot;thermal_state&quot;')
  })

  it('labels arrays and empty data clearly', () => {
    const list = renderToStaticMarkup(<StructuredDataView value={{ values: [1, 2] }} />)
    const empty = renderToStaticMarkup(<StructuredDataView value={{}} empty="No setup reported" />)
    expect(list).toContain('2 items')
    expect(list).toContain('Item 1')
    expect(empty).toContain('No setup reported')
  })
})
