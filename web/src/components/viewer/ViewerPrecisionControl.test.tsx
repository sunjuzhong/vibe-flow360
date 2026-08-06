import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { commonPrecisionLevels, precisionLevelLabel, ViewerPrecisionControl } from './ViewerPrecisionControl'

describe('ViewerPrecisionControl', () => {
  it('renders Auto and every available precision level', () => {
    const markup = renderToStaticMarkup(
      <ViewerPrecisionControl
        levels={4}
        currentLevel={1}
        selection="default"
        onChange={() => undefined}
      />,
    )

    expect(markup).toContain('Manifest default · L1')
    expect(markup).toContain('Highest detail · L0')
    expect(markup).toContain('Detail level 3 · L2')
    expect(markup).toContain('Lowest detail · L3')
  })

  it('stays hidden for a single-level asset', () => {
    expect(renderToStaticMarkup(
      <ViewerPrecisionControl levels={1} currentLevel={0} selection="default" onChange={() => undefined} />,
    )).toBe('')
    expect(precisionLevelLabel(0, 2)).toContain('Highest')
  })

  it('only exposes levels supported by every multi-level entity', () => {
    expect(commonPrecisionLevels({
      wing: { levels: 4 },
      fuselage: { levels: 3 },
      reference: { levels: 1 },
    })).toBe(3)
  })

  it('marks a failed precision level unavailable for the active asset', () => {
    const markup = renderToStaticMarkup(
      <ViewerPrecisionControl
        levels={2}
        currentLevel={1}
        selection="default"
        unavailableLevels={new Set([0])}
        onChange={() => undefined}
      />,
    )

    expect(markup).toContain('Highest detail · L0 · unavailable')
    expect(markup).toContain('value="0" disabled=""')
  })
})
