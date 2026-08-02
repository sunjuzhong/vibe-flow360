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

  it('discovers quality fields without displaying one by default', () => {
    const next = reduceSurfaceMeshReviewState({
      ...initialSurfaceMeshReviewState,
      probe: { fieldName: 'old', value: 1, entityId: 'wing', position: [0, 0, 0] },
    }, {
      type: 'fields',
      fields: [{ name: 'skewness', kind: 'scalar', min: 0, max: 0.95 }],
    })

    expect(next.qualityFields).toEqual([{ name: 'skewness', kind: 'scalar', min: 0, max: 0.95 }])
    expect(next.selectedField).toBeNull()
    expect(next.range).toBeNull()
    expect(next.probe).toBeNull()
  })

  it('only enables field display after an explicit field selection', () => {
    const discovered = reduceSurfaceMeshReviewState(initialSurfaceMeshReviewState, {
      type: 'fields',
      fields: [{ name: 'skewness', kind: 'scalar', min: 0, max: 0.95 }],
    })
    const selected = reduceSurfaceMeshReviewState(discovered, {
      type: 'field',
      fieldName: 'skewness',
    })

    expect(selected.selectedField).toBe('skewness')
    expect(selected.range).toEqual([0, 0.95])
  })

  it('clears field display state when the manifest groups change', () => {
    const stateWithField = {
      ...initialSurfaceMeshReviewState,
      qualityFields: [{ name: 'area', kind: 'scalar' as const, min: 1e-8, max: 1e-4 }],
      selectedField: 'area',
      range: [1e-8, 1e-4] as [number, number],
    }
    const reset = reduceSurfaceMeshReviewState(stateWithField, {
      type: 'reset-groups',
      groups: [{ id: 'new-face', name: 'New face', visible: true }],
    })

    expect(reset.qualityFields).toEqual([])
    expect(reset.selectedField).toBeNull()
    expect(reset.range).toBeNull()
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
