import { AlertCircle, Slice } from 'lucide-react'
import type { VolumeSliceVariant, VolumeSliceVariantReview } from '../../lib/volumeMeshReview'
import './VolumeSliceInspector.css'

export function VolumeSliceInspector({
  enabled,
  axis,
  position,
  bounds,
  available,
  variants,
  variant,
  onEnabled,
  onAxis,
  onPosition,
  onVariant,
}: {
  enabled: boolean
  axis: 'x' | 'y' | 'z'
  position: number
  bounds: [number, number]
  available: boolean
  variants: VolumeSliceVariantReview
  variant: VolumeSliceVariant
  onEnabled: (enabled: boolean) => void
  onAxis: (axis: 'x' | 'y' | 'z') => void
  onPosition: (position: number) => void
  onVariant: (variant: VolumeSliceVariant) => void
}) {
  const step = (bounds[1] - bounds[0]) / 300 || 0.01
  return (
    <section className="volume-slice-inspector">
      <div className="geometry-section-title"><Slice size={13} /> Section diagnostic</div>
      {!available && (
        <div className="volume-slice-caveat"><AlertCircle size={13} /> A real VolumeMesh asset is required.</div>
      )}
      {variants.families.length > 0 && (
        <>
          <div className="volume-slice-variant" role="group" aria-label="Generated slice representation">
            {(['flat', 'crinkled'] as const).map((candidate) => {
              const supported = candidate === 'flat' ? variants.hasFlat : variants.hasCrinkled
              return (
                <button type="button" className={variant === candidate ? 'active' : ''} disabled={!supported} aria-pressed={variant === candidate} key={candidate} onClick={() => onVariant(candidate)}>
                  {candidate === 'flat' ? 'Flat' : 'Crinkled'}
                </button>
              )
            })}
          </div>
          <p className="volume-slice-variant-detail">
            {`${variants.pairedCount} paired generated ${variants.pairedCount === 1 ? 'slice' : 'slices'} · Flat is the default where available.`}
            {!variants.hasFlat ? ' Flat is unavailable, so Crinkled is retained.' : !variants.hasCrinkled ? ' Crinkled is unavailable.' : ''}
          </p>
        </>
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
      <p>{variants.families.length > 0
        ? 'The representation switch controls Flow360-generated slice faces. The clip controls remain a separate interactive view of the current render asset.'
        : 'This is an interactive clipping section. No Flow360-generated flat or crinkled slice pair was identified, so no unseen cell topology is inferred.'}</p>
    </section>
  )
}
