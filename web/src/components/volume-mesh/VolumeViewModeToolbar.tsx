import { Box, Boxes, Layers3, Palette, PanelTop, Slice } from 'lucide-react'
import type { VolumeViewMode } from '../../lib/volumeMeshReview'

export function VolumeViewModeToolbar({
  mode,
  onChange,
}: {
  mode: VolumeViewMode
  onChange: (mode: VolumeViewMode) => void
}) {
  const modes = [
    { mode: 'overview' as const, label: 'Overview', icon: Box },
    { mode: 'zones' as const, label: 'Zones', icon: Layers3 },
    { mode: 'quality' as const, label: 'Quality', icon: Palette },
    { mode: 'boundary-layer' as const, label: 'Layers', icon: PanelTop },
    { mode: 'refinements' as const, label: 'Refine', icon: Boxes },
    { mode: 'slices' as const, label: 'Section', icon: Slice },
  ]
  return (
    <div className="volume-view-modes" role="group" aria-label="Volume mesh display mode">
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
