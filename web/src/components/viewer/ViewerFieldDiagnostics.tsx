import { Crosshair } from 'lucide-react'
import { useMemo } from 'react'
import { useI18n } from '../../i18n'
import type { UVFFieldExtrema, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe } from '../../lib/uvf-three'

export function ViewerFieldDiagnostics({
  field,
  range,
  histogram,
  extrema = null,
  probe = null,
  entityNames = {},
  riskDirection = 'max',
  onLocateExtreme,
}: {
  field: UVFFieldInfo | undefined
  range: [number, number] | null
  histogram: UVFFieldHistogram | null
  extrema?: UVFFieldExtrema | null
  probe?: UVFFieldProbe | null
  entityNames?: Record<string, string>
  riskDirection?: 'min' | 'max'
  onLocateExtreme?: (direction: 'min' | 'max') => void
}) {
  const { t } = useI18n()
  const activeHistogram = histogram?.field.name === field?.name ? histogram : null
  const activeProbe = probe?.fieldName === field?.name ? probe : null
  const riskProbe = extrema && extrema.field.name === field?.name ? extrema[riskDirection] : null
  const peak = useMemo(
    () => Math.max(...(activeHistogram?.bins.map((bin) => bin.count) ?? [1]), 1),
    [activeHistogram],
  )

  if (!field || (!activeHistogram && !riskProbe && !activeProbe)) return null

  const distributionLabel = t('{field} distribution with {count} samples')
    .replace('{field}', field.name)
    .replace('{count}', String(activeHistogram?.sampleCount ?? 0))
  const locateLabel = t(riskDirection === 'min' ? 'Locate lowest value · {value}' : 'Locate highest value · {value}')
    .replace('{value}', riskProbe?.value.toPrecision(5) ?? '—')

  return (
    <div className="viewer-field-diagnostics">
      {activeHistogram && (
        <div className="viewer-field-histogram" aria-label={distributionLabel}>
          {activeHistogram.bins.map((bin, index) => (
            <i
              key={`${bin.min}-${index}`}
              className={range && bin.max >= range[0] && bin.min <= range[1] ? 'in-range' : ''}
              style={{ height: `${Math.max(3, bin.count / peak * 100)}%` }}
              title={`${bin.min.toPrecision(4)} – ${bin.max.toPrecision(4)}: ${bin.count}`}
            />
          ))}
        </div>
      )}
      {riskProbe && onLocateExtreme && (
        <button type="button" className="viewer-field-locate-extreme" onClick={() => onLocateExtreme(riskDirection)}>
          <Crosshair size={10} /> {locateLabel}
        </button>
      )}
      {activeProbe && (
        <div className="viewer-field-diagnostic-probe">
          <strong>{t('Probe ·')} {entityNames[activeProbe.entityId] ?? activeProbe.entityId}</strong>
          <span>{activeProbe.value.toPrecision(6)}</span>
          <small>({activeProbe.position.map((value) => value.toPrecision(4)).join(', ')})</small>
        </div>
      )}
    </div>
  )
}
