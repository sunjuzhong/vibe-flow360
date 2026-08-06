import { describe, expect, it } from 'vitest'
import {
  initialVolumeMeshReviewState,
  reduceVolumeMeshReviewState,
} from './useVolumeMeshReview'

describe('VolumeMesh review store', () => {
  it('discovers only volume-quality fields and waits for explicit selection', () => {
    const next = reduceVolumeMeshReviewState(initialVolumeMeshReviewState, {
      type: 'fields',
      fields: [
        { name: 'aspect_ratio', kind: 'scalar', min: 1, max: 80 },
        { name: 'pressure', kind: 'scalar', min: -1, max: 1 },
      ],
    })
    expect(next.qualityFields.map((field) => field.name)).toEqual(['aspect_ratio'])
    expect(next.allFields.map((field) => field.name)).toEqual(['aspect_ratio', 'pressure'])
    expect(next.selectedField).toBeNull()
  })

  it('enables clipping only in section mode', () => {
    const section = reduceVolumeMeshReviewState(initialVolumeMeshReviewState, { type: 'mode', mode: 'slices' })
    const zones = reduceVolumeMeshReviewState(section, { type: 'mode', mode: 'zones' })
    expect(section.clipEnabled).toBe(true)
    expect(zones.clipEnabled).toBe(false)
  })

  it('locates the risky extreme and synchronizes entity selection', () => {
    const withExtrema = reduceVolumeMeshReviewState(initialVolumeMeshReviewState, {
      type: 'extrema',
      extrema: {
        field: { name: 'cell_volume', kind: 'scalar', min: 0.001, max: 2 },
        min: { fieldName: 'cell_volume', value: 0.001, entityId: 'wake', position: [1, 2, 3] },
        max: null,
      },
    })
    const located = reduceVolumeMeshReviewState(withExtrema, { type: 'locate-extreme', direction: 'min' })
    expect(located.selection.groupId).toBe('wake')
    expect(located.focusTarget).toEqual([1, 2, 3])
  })

  it('preserves a stable zone selection when groups refresh', () => {
    const selected = reduceVolumeMeshReviewState(initialVolumeMeshReviewState, { type: 'selection', groupId: 'fluid' })
    const refreshed = reduceVolumeMeshReviewState(selected, {
      type: 'reset-groups',
      groups: [
        { id: 'fluid', name: 'Fluid', color: '#aaa', visible: true },
        { id: 'solid', name: 'Solid', color: '#bbb', visible: false },
      ],
    })
    expect(refreshed.selection.groupId).toBe('fluid')
    expect(refreshed.visibility).toEqual({ fluid: true, solid: false })
  })

  it('keeps boundary-layer evidence separate from general quality fields', () => {
    const discovered = reduceVolumeMeshReviewState(initialVolumeMeshReviewState, {
      type: 'fields',
      fields: [
        { name: 'aspect_ratio', kind: 'scalar', min: 1, max: 60 },
        { name: 'prism_layer_count', kind: 'scalar', min: 0, max: 20 },
      ],
    })
    expect(discovered.qualityFields.map((field) => field.name)).toEqual(['aspect_ratio'])
    expect(discovered.boundaryLayerFields.map((field) => field.name)).toEqual(['prism_layer_count'])

    const layerMode = reduceVolumeMeshReviewState(discovered, { type: 'mode', mode: 'boundary-layer' })
    const selected = reduceVolumeMeshReviewState(layerMode, { type: 'field', fieldName: 'prism_layer_count' })
    expect(selected.selectedField).toBe('prism_layer_count')
    expect(selected.range).toEqual([0, 20])
  })

  it('defaults generated slice pairs to flat and switches visibility atomically', () => {
    const groups = [
      { id: 'flat', name: 'Worst-quality x-normal slice (flat)', color: '#aaa', visible: true },
      { id: 'crinkled', name: 'Worst-quality x-normal slice (crinkled)', color: '#bbb', visible: true },
      { id: 'fluid', name: 'Fluid', color: '#ccc', visible: false },
    ]
    const loaded = reduceVolumeMeshReviewState(initialVolumeMeshReviewState, { type: 'reset-groups', groups })
    expect(loaded.sliceVariant).toBe('flat')
    expect(loaded.visibility).toEqual({ flat: true, crinkled: false, fluid: false })

    const switched = reduceVolumeMeshReviewState(loaded, { type: 'slice-variant', variant: 'crinkled', groups })
    expect(switched.sliceVariant).toBe('crinkled')
    expect(switched.visibility).toEqual({ flat: false, crinkled: true, fluid: false })
  })
})
