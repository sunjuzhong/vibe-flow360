import { Crosshair } from 'lucide-react'
import { useMemo } from 'react'
import type {
  UVFFieldExtrema,
  UVFFieldHistogram,
  UVFFieldInfo,
  UVFFieldProbe,
} from '../../lib/uvf-three'
import { surfaceQualityRiskDirection } from '../../lib/surfaceMeshReview'

export function SurfaceQualityInspector({
  field,
  range,
  histogram,
  extrema,
  probe,
  entityNames,
  onRangeChange,
  onLocateExtreme,
}: {
  field: UVFFieldInfo | undefined
  range: [number, number] | null
  histogram: UVFFieldHistogram | null
  extrema: UVFFieldExtrema | null
  probe: UVFFieldProbe | null
  entityNames: Record<string, string>
  onRangeChange: (range: [number, number]) => void
  onLocateExtreme: (direction: 'min' | 'max') => void
}) {
  const histogramPeak = useMemo(
    () => Math.max(...(histogram?.bins.map((bin) => bin.count) ?? [1]), 1),
    [histogram],
  )
  if (!field) {
    return <p>No area, aspect-ratio, skewness, or other surface-quality field is present in this manifest.</p>
  }
  const activeHistogram = histogram?.field.name === field.name ? histogram : null
  const activeProbe = probe?.fieldName === field.name ? probe : null
  const riskDirection = surfaceQualityRiskDirection(field.name)
  const riskProbe = extrema?.field.name === field.name ? extrema[riskDirection] : null
  const step = (field.max - field.min) / 200 || 1

  return (
    <>
      <div className="surface-quality-field active">
        <span>{field.name}</span>
        <small>{field.kind} · {field.min.toPrecision(4)} – {field.max.toPrecision(4)}</small>
      </div>
      {activeHistogram && range && (
        <div className="surface-field-distribution">
          <div
            className="surface-histogram"
            aria-label={`${field.name} distribution, ${activeHistogram.sampleCount} samples`}
          >
            {activeHistogram.bins.map((bin, index) => (
              <i
                key={`${bin.min}-${index}`}
                className={bin.max >= range[0] && bin.min <= range[1] ? 'in-range' : ''}
                style={{ height: `${Math.max(3, bin.count / histogramPeak * 100)}%` }}
                title={`${bin.min.toPrecision(4)} – ${bin.max.toPrecision(4)}: ${bin.count}`}
              />
            ))}
          </div>
          <div className="surface-range-values">
            <span>{range[0].toPrecision(4)}</span>
            <button type="button" onClick={() => onRangeChange([field.min, field.max])}>
              Reset range
            </button>
            <span>{range[1].toPrecision(4)}</span>
          </div>
          <label>
            Minimum highlighted value
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={step}
              value={range[0]}
              onChange={(event) => onRangeChange([Math.min(Number(event.target.value), range[1]), range[1]])}
            />
          </label>
          <label>
            Maximum highlighted value
            <input
              type="range"
              min={field.min}
              max={field.max}
              step={step}
              value={range[1]}
              onChange={(event) => onRangeChange([range[0], Math.max(Number(event.target.value), range[0])])}
            />
          </label>
          {riskProbe && (
            <button
              type="button"
              className="surface-locate-worst"
              onClick={() => onLocateExtreme(riskDirection)}
            >
              <Crosshair size={10} />
              Locate {riskDirection === 'min' ? 'lowest' : 'highest'} · {riskProbe.value.toPrecision(5)}
            </button>
          )}
          {activeProbe && (
            <div className="surface-field-probe">
              <strong>Probe · {entityNames[activeProbe.entityId] ?? activeProbe.entityId}</strong>
              <span>{activeProbe.value.toPrecision(6)}</span>
              <small>({activeProbe.position.map((value) => value.toPrecision(4)).join(', ')})</small>
            </div>
          )}
        </div>
      )}
    </>
  )
}
