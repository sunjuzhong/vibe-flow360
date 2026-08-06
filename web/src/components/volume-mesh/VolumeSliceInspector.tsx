import { AlertCircle, Slice } from 'lucide-react'

export function VolumeSliceInspector({
  enabled,
  axis,
  position,
  bounds,
  available,
  onEnabled,
  onAxis,
  onPosition,
}: {
  enabled: boolean
  axis: 'x' | 'y' | 'z'
  position: number
  bounds: [number, number]
  available: boolean
  onEnabled: (enabled: boolean) => void
  onAxis: (axis: 'x' | 'y' | 'z') => void
  onPosition: (position: number) => void
}) {
  const step = (bounds[1] - bounds[0]) / 300 || 0.01
  return (
    <section className="volume-slice-inspector">
      <div className="geometry-section-title"><Slice size={13} /> Section diagnostic</div>
      {!available && (
        <div className="volume-slice-caveat"><AlertCircle size={13} /> A real VolumeMesh asset is required.</div>
      )}
      <label className="volume-slice-toggle">
        <input type="checkbox" checked={enabled && available} disabled={!available} onChange={(event) => onEnabled(event.target.checked)} />
        Clip the current render asset
      </label>
      <div className="volume-slice-axis" role="group" aria-label="Section plane normal">
        {(['x', 'y', 'z'] as const).map((candidate) => (
          <button type="button" className={axis === candidate ? 'active' : ''} key={candidate} onClick={() => onAxis(candidate)}>
            {candidate.toUpperCase()} normal
          </button>
        ))}
      </div>
      <label>Plane position · {position.toPrecision(5)}
        <input type="range" min={bounds[0]} max={bounds[1]} step={step} value={position} disabled={!available || !enabled} onChange={(event) => onPosition(Number(event.target.value))} />
      </label>
      <p>This is an interactive clipping section. It is not a Flow360-generated flat or crinkled mesh slice, so no unseen cell topology is inferred.</p>
    </section>
  )
}
