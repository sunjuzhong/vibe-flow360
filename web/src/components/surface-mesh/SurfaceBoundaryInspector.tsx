import { Focus, RotateCcw } from 'lucide-react'
import type { SurfaceBoundaryRow } from '../../lib/surfaceMeshReview'

export function SurfaceBoundaryInspector({
  inventory,
  selectedId,
  selectedBoundary,
  conflictCount,
  onSelect,
  onIsolate,
  onShowAll,
}: {
  inventory: SurfaceBoundaryRow[]
  selectedId: string | null
  selectedBoundary?: SurfaceBoundaryRow
  conflictCount: number
  onSelect: (groupId: string) => void
  onIsolate: (groupId: string) => void
  onShowAll: () => void
}) {
  return (
    <>
      <div className="surface-boundary-list">
        {inventory.length > 0 ? inventory.slice(0, 8).map((row) => (
          <div
            key={row.id}
            className={`surface-boundary-row ${row.status} ${selectedId === row.id ? 'selected' : ''}`}
          >
            <button
              type="button"
              className="surface-boundary-select"
              onClick={() => onSelect(row.id)}
            >
              <span>{row.name}</span>
              <small>
                {row.assignments.length > 0
                  ? row.assignments.map((assignment) => assignment.modelName).join(', ')
                  : 'Unassigned'}
              </small>
            </button>
            <button
              type="button"
              className="surface-boundary-isolate"
              aria-label={`Isolate ${row.name}`}
              title={`Isolate ${row.name}`}
              onClick={() => onIsolate(row.id)}
            >
              <Focus size={11} />
            </button>
          </div>
        )) : <p>No Face entities are present in the current render asset.</p>}
      </div>
      {selectedBoundary && (
        <p className="surface-selected-detail">
          Selected: {selectedBoundary.name} · {selectedBoundary.triangles?.toLocaleString() ?? '—'} triangles
        </p>
      )}
      {conflictCount > 0 && (
        <p className="surface-review-warning">{conflictCount} face group(s) have multiple model assignments.</p>
      )}
      {inventory.length > 0 && (
        <button type="button" className="surface-show-all" onClick={onShowAll}>
          <RotateCcw size={10} /> Show all faces
        </button>
      )}
    </>
  )
}
