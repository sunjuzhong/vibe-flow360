import { Box, Layers3 } from 'lucide-react'
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
  ]
  return (
    <div className="surface-view-modes" role="group" aria-label="Surface mesh display mode">
      {modes.map(({ mode: candidate, label, icon: Icon }) => {
        const active = mode === candidate || (mode === 'quality' && candidate === 'boundaries')
        return (
          <button
            type="button"
            key={candidate}
            className={active ? 'active' : ''}
            aria-pressed={active}
            onClick={() => onChange(candidate)}
          >
            <Icon size={11} /> {label}
          </button>
        )
      })}
    </div>
  )
}
