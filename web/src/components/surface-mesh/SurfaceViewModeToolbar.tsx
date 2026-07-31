import { Box, Layers3, Palette } from 'lucide-react'
import type { SurfaceViewMode } from '../../hooks/useSurfaceMeshReview'

export function SurfaceViewModeToolbar({
  mode,
  onChange,
}: {
  mode: SurfaceViewMode
  onChange: (mode: SurfaceViewMode) => void
}) {
  const modes = [
    { mode: 'plain' as const, label: 'Plain', icon: Box },
    { mode: 'boundaries' as const, label: 'Boundaries', icon: Layers3 },
    { mode: 'quality' as const, label: 'Mesh Quality', icon: Palette },
  ]
  return (
    <div className="surface-view-modes" role="group" aria-label="Surface mesh display mode">
      {modes.map(({ mode: candidate, label, icon: Icon }) => (
        <button
          type="button"
          key={candidate}
          className={mode === candidate ? 'active' : ''}
          aria-pressed={mode === candidate}
          onClick={() => onChange(candidate)}
        >
          <Icon size={11} /> {label}
        </button>
      ))}
    </div>
  )
}
