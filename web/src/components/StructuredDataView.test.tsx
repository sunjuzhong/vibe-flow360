import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { humanizeDataKey, semanticDataValue, StructuredDataView } from './StructuredDataView'

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
    expect(html).not.toContain('Object')
    expect(html).not.toContain('properties')
  })

  it('compacts value and units objects into one semantic quantity', () => {
    const html = renderToStaticMarkup(
      <StructuredDataView value={{
        alpha: { value: 0, units: 'degree' },
        velocity_magnitude: { value: 40, unit: 'meter/second' },
        enabled: { value: false },
      }} />,
    )

    expect(html).toContain('0</span><span class="structured-data-unit">degree')
    expect(html).toContain('40</span><span class="structured-data-unit">meter/second')
    expect(html).toContain('structured-data-boolean false')
    expect(html).not.toContain('2 properties')
    expect(html).not.toContain('<dt>Units</dt>')
  })

  it('keeps records with extra metadata in the generic tree without an object summary', () => {
    const value = { value: 288.15, units: 'K', source: 'freestream' }
    const html = renderToStaticMarkup(<StructuredDataView value={{ temperature: value }} />)

    expect(semanticDataValue(value)).toBeNull()
    expect(html).toContain('<dt>Value</dt>')
    expect(html).toContain('<dt>Units</dt>')
    expect(html).toContain('<dt>Source</dt>')
    expect(html).not.toContain('Object')
    expect(html).not.toContain('properties')
  })

  it('labels arrays and empty data clearly', () => {
    const list = renderToStaticMarkup(<StructuredDataView value={{ values: [1, 2] }} />)
    const empty = renderToStaticMarkup(<StructuredDataView value={{}} empty="No setup reported" />)
    expect(list).toContain('2 items')
    expect(list).toContain('Item 1')
    expect(empty).toContain('No setup reported')
  })
})
