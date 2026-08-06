import { describe, expect, it } from 'vitest'
import type { BoundaryLayerReview } from '../../lib/volumeMeshReview'
import { boundaryLayerTargetRows, filterBoundaryLayerTargets } from './BoundaryLayerInspector'

const review: BoundaryLayerReview = {
  defaults: { layerCountMode: 'automatic', firstLayerThickness: '0.00001 m', growthRate: '1.2' },
  configured: true,
  evidenceFields: [],
  targetCount: 3,
  matchedTargetCount: 2,
  unmatchedTargetCount: 1,
  rules: [
    {
      id: 'bl-1',
      name: 'Aero walls',
      kind: 'boundary-layer',
      behavior: 'grow',
      firstLayerThickness: '0.000005 m',
      targets: [
        { key: 'wing', name: 'Wing', matchedGroupId: 'wing', match: 'id' },
        { key: 'missing', name: 'Missing', match: 'unmatched' },
      ],
    },
    {
      id: 'ps-1',
      name: 'Farfield projection',
      kind: 'passive-spacing',
      behavior: 'projected',
      targets: [{ key: 'farfield', name: 'Farfield', matchedGroupId: 'farfield', match: 'name' }],
    },
  ],
}

describe('BoundaryLayerInspector target model', () => {
  it('flattens rules while preserving engineering intent', () => {
    const rows = boundaryLayerTargetRows(review)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ ruleName: 'Aero walls', behavior: 'grow', firstLayerThickness: '0.000005 m' })
  })

  it('searches rules and filters unresolved references', () => {
    const rows = boundaryLayerTargetRows(review)
    expect(filterBoundaryLayerTargets(rows, 'projection', 'all').map((row) => row.key)).toEqual(['farfield'])
    expect(filterBoundaryLayerTargets(rows, '', 'unmatched').map((row) => row.key)).toEqual(['missing'])
  })
})
