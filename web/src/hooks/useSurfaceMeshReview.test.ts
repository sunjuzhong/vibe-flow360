import { describe, expect, it } from 'vitest'
import {
  initialSurfaceMeshReviewState,
  reduceSurfaceMeshReviewState,
} from './useSurfaceMeshReview'

describe('SurfaceMesh review store', () => {
  it('preserves a valid selection and resets visibility for a new manifest', () => {
    const selected = reduceSurfaceMeshReviewState(initialSurfaceMeshReviewState, {
      type: 'selection',
      groupId: 'wing',
    })
    const next = reduceSurfaceMeshReviewState(selected, {
      type: 'reset-groups',
      groups: [
        { id: 'wing', name: 'Wing', visible: true },
        { id: 'farfield', name: 'Farfield', visible: false },
      ],
    })

    expect(next.selection.groupId).toBe('wing')
    expect(next.visibility).toEqual({ wing: true, farfield: false })
  })

  it('selects the first quality field and resets its dependent inspection state', () => {
    const next = reduceSurfaceMeshReviewState({
      ...initialSurfaceMeshReviewState,
      probe: { fieldName: 'old', value: 1, entityId: 'wing', position: [0, 0, 0] },
    }, {
      type: 'fields',
      fields: [{ name: 'skewness', kind: 'scalar', min: 0, max: 0.95 }],
    })

    expect(next.selectedField).toBe('skewness')
    expect(next.range).toEqual([0, 0.95])
    expect(next.probe).toBeNull()
  })

  it('locates an extreme by synchronizing probe, selection and camera target', () => {
    const withExtrema = reduceSurfaceMeshReviewState(initialSurfaceMeshReviewState, {
      type: 'extrema',
      extrema: {
        field: { name: 'skewness', kind: 'scalar', min: 0, max: 1 },
        min: null,
        max: {
          fieldName: 'skewness',
          value: 0.98,
          entityId: 'tail',
          position: [1, 2, 3],
        },
      },
    })
    const located = reduceSurfaceMeshReviewState(withExtrema, {
      type: 'locate-extreme',
      direction: 'max',
    })

    expect(located.selection.groupId).toBe('tail')
    expect(located.probe?.value).toBe(0.98)
    expect(located.focusTarget).toEqual([1, 2, 3])
  })

  it('toggles one boundary without replacing other viewer visibility state', () => {
    const initial = {
      ...initialSurfaceMeshReviewState,
      visibility: { wing: true, farfield: false },
    }
    const hidden = reduceSurfaceMeshReviewState(initial, {
      type: 'toggle-visibility',
      groupId: 'wing',
    })
    const shown = reduceSurfaceMeshReviewState(hidden, {
      type: 'toggle-visibility',
      groupId: 'farfield',
    })

    expect(hidden.visibility).toEqual({ wing: false, farfield: false })
    expect(shown.visibility).toEqual({ wing: false, farfield: true })
  })
})
