import { Crosshair } from 'lucide-react'
import { useMemo } from 'react'
import type { UVFFieldExtrema, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe } from '../../lib/uvf-three'
import { volumeQualityRiskDirection } from '../../lib/volumeMeshReview'
import { useI18n } from '../../i18n'

export function VolumeQualityInspector({
  fields,
  field,
  range,
  histogram,
  extrema,
  probe,
  entityNames,
  onFieldChange,
  onRangeChange,
  onLocateExtreme,
}: {
  fields: UVFFieldInfo[]
  field: UVFFieldInfo | undefined
  range: [number, number] | null
  histogram: UVFFieldHistogram | null
  extrema: UVFFieldExtrema | null
  probe: UVFFieldProbe | null
  entityNames: Record<string, string>
  onFieldChange: (fieldName: string | null) => void
  onRangeChange: (range: [number, number]) => void
  onLocateExtreme: (direction: 'min' | 'max') => void
}) {
  const { t } = useI18n()
  const peak = useMemo(() => Math.max(...(histogram?.bins.map((bin) => bin.count) ?? [1]), 1), [histogram])
  const fieldSelector = (
    <label className="volume-quality-field-selector">
      <span>{t('Field')}</span>
      <select value={field?.name ?? ''} onChange={(event) => onFieldChange(event.target.value || null)}>
        <option value="">{t('None')}</option>
        {fields.map((candidate) => (
          <option value={candidate.name} key={candidate.name}>{candidate.name}</option>
        ))}
      </select>
    </label>
  )
  if (!field) return (
    <>
      {fieldSelector}
      {fields.length === 0 && <p>No scalar cell-quality field is present. Select Quality after a diagnostic UVF asset is available.</p>}
    </>
  )
  const activeHistogram = histogram?.field.name === field.name ? histogram : null
  const activeProbe = probe?.fieldName === field.name ? probe : null
  const riskDirection = volumeQualityRiskDirection(field.name)
  const riskProbe = extrema?.field.name === field.name ? extrema[riskDirection] : null
  const step = (field.max - field.min) / 200 || 1

  return (
    <>
      {fieldSelector}
      <div className="volume-quality-field">
        <span>{field.name}</span>
        <small>{field.min.toPrecision(4)} – {field.max.toPrecision(4)}</small>
      </div>
      {activeHistogram && range && (
        <div className="volume-field-distribution">
          <div className="volume-histogram" aria-label={`${field.name} distribution, ${activeHistogram.sampleCount} samples`}>
            {activeHistogram.bins.map((bin, index) => (
              <i
                key={`${bin.min}-${index}`}
                className={bin.max >= range[0] && bin.min <= range[1] ? 'in-range' : ''}
                style={{ height: `${Math.max(3, bin.count / peak * 100)}%` }}
                title={`${bin.min.toPrecision(4)} – ${bin.max.toPrecision(4)}: ${bin.count}`}
              />
            ))}
          </div>
          <div className="volume-range-values">
            <span>{range[0].toPrecision(4)}</span>
            <button type="button" onClick={() => onRangeChange([field.min, field.max])}>Reset range</button>
            <span>{range[1].toPrecision(4)}</span>
          </div>
          <label>Minimum displayed value
            <input type="range" min={field.min} max={field.max} step={step} value={range[0]} onChange={(event) => onRangeChange([Math.min(Number(event.target.value), range[1]), range[1]])} />
          </label>
          <label>Maximum displayed value
            <input type="range" min={field.min} max={field.max} step={step} value={range[1]} onChange={(event) => onRangeChange([range[0], Math.max(Number(event.target.value), range[0])])} />
          </label>
          {riskProbe && (
            <button type="button" className="volume-locate-worst" onClick={() => onLocateExtreme(riskDirection)}>
              <Crosshair size={10} /> Locate {riskDirection === 'min' ? 'lowest' : 'highest'} · {riskProbe.value.toPrecision(5)}
            </button>
          )}
          {activeProbe && (
            <div className="volume-field-probe">
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
