import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { SurfaceBoundaryRow } from '../../lib/surfaceMeshReview'
import {
  SurfaceBoundaryInspector,
  filterSurfaceBoundaries,
} from './SurfaceBoundaryInspector'

const inventory: SurfaceBoundaryRow[] = Array.from({ length: 12 }, (_, index) => ({
  id: `face-${index + 1}`,
  name: index === 10 ? 'farfield' : `wing-${index + 1}`,
  triangles: (index + 1) * 100,
  status: index === 10 ? 'unassigned' : index === 11 ? 'conflict' : 'assigned',
  assignments: index === 10 ? [] : [{
    modelName: index === 11 ? 'Overlapping walls' : 'No-slip wall',
    modelType: index === 11 ? 'SlipWall' : 'Wall',
  }],
}))

describe('SurfaceBoundaryInspector', () => {
  it('searches by face, model, and model type while respecting status', () => {
    expect(filterSurfaceBoundaries(inventory, 'farfield', 'all').map((row) => row.id)).toEqual(['face-11'])
    expect(filterSurfaceBoundaries(inventory, 'No-slip', 'assigned')).toHaveLength(10)
    expect(filterSurfaceBoundaries(inventory, 'SlipWall', 'conflict').map((row) => row.id)).toEqual(['face-12'])
    expect(filterSurfaceBoundaries(inventory, '', 'unassigned').map((row) => row.id)).toEqual(['face-11'])
  })

  it('renders faces beyond the previous eight-row limit and exposes viewer actions', () => {
    const markup = renderToStaticMarkup(
      <SurfaceBoundaryInspector
        inventory={inventory}
        selectedId="face-9"
        selectedBoundary={inventory[8]}
        conflictCount={1}
        visibility={{ 'face-2': false }}
        onSelect={vi.fn()}
        onIsolate={vi.fn()}
        onToggleVisibility={vi.fn()}
        onShowAll={vi.fn()}
      />,
    )

    expect(markup).toContain('Search SurfaceMesh boundaries')
    expect(markup).toContain('Filter SurfaceMesh boundaries by assignment status')
    expect(markup).toContain('wing-9')
    expect(markup).toContain('farfield')
    expect(markup).toContain('Show wing-2')
    expect(markup).toContain('Isolate wing-9')
    expect(markup).toContain('12 of 12 matching faces')
  })
})
