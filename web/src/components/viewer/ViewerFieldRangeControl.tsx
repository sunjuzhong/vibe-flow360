import type { CSSProperties } from 'react'
import { useI18n } from '../../i18n'
import {
  formatFieldRange,
  normalizeFieldValue,
  sampleColormap,
  type ColormapName,
  type UVFResolvedFieldScale,
} from '../../lib/uvf-three'

export const VIEWER_FIELD_RANGE_STEPS = 1000

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function normalizeViewerFieldRange(
  range: [number, number] | null | undefined,
  min: number,
  max: number,
): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min, max]
  const lower = clamp(Math.min(range?.[0] ?? min, range?.[1] ?? max), min, max)
  const upper = clamp(Math.max(range?.[0] ?? min, range?.[1] ?? max), min, max)
  return lower < upper ? [lower, upper] : [min, max]
}

export function resolveViewerFieldDomain(
  range: [number, number] | null | undefined,
  min: number,
  max: number,
): [number, number] {
  if (range && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] !== range[1]) {
    return [Math.min(range[0], range[1]), Math.max(range[0], range[1])]
  }
  return [min, max]
}

export function viewerFieldRangeSliderPosition(
  min: number,
  max: number,
  value: number,
  scale: UVFResolvedFieldScale,
): number {
  return Math.round(clamp(normalizeFieldValue(value, min, max, scale), 0, 1) * VIEWER_FIELD_RANGE_STEPS)
}

export function viewerFieldRangeSliderValue(
  min: number,
  max: number,
  position: number,
  scale: UVFResolvedFieldScale,
): number {
  const fraction = clamp(position, 0, VIEWER_FIELD_RANGE_STEPS) / VIEWER_FIELD_RANGE_STEPS
  if (scale === 'log' && min > 0 && max > min) {
    return 10 ** (Math.log10(min) + fraction * (Math.log10(max) - Math.log10(min)))
  }
  return min + fraction * (max - min)
}

export function viewerFieldRangeGradient(
  colormap: ColormapName,
  lowerPosition: number,
  upperPosition: number,
): string {
  const lower = clamp(lowerPosition, 0, VIEWER_FIELD_RANGE_STEPS) / VIEWER_FIELD_RANGE_STEPS * 100
  const upper = clamp(upperPosition, 0, VIEWER_FIELD_RANGE_STEPS) / VIEWER_FIELD_RANGE_STEPS * 100
  const stops = Array.from({ length: 9 }, (_, index) => {
    const fraction = index / 8
    const position = lower + (upper - lower) * fraction
    return `${sampleColormap(fraction, colormap).getStyle()} ${position}%`
  })
  const first = sampleColormap(0, colormap).getStyle()
  const last = sampleColormap(1, colormap).getStyle()
  return `linear-gradient(to right, ${first} 0%, ${first} ${lower}%, ${stops.join(', ')}, ${last} ${upper}%, ${last} 100%)`
}

export function ViewerFieldRangeControl({
  fieldName,
  min,
  max,
  range,
  scale,
  colormap,
  onChange,
}: {
  fieldName: string
  min: number
  max: number
  range: [number, number]
  scale: UVFResolvedFieldScale
  colormap: ColormapName
  onChange: (range: [number, number]) => void
}) {
  const { t } = useI18n()
  const normalizedRange = normalizeViewerFieldRange(range, min, max)
  const rawLowerPosition = viewerFieldRangeSliderPosition(min, max, normalizedRange[0], scale)
  const rawUpperPosition = viewerFieldRangeSliderPosition(min, max, normalizedRange[1], scale)
  const lowerPosition = Math.min(rawLowerPosition, Math.max(0, rawUpperPosition - 1))
  const upperPosition = Math.max(rawUpperPosition, Math.min(VIEWER_FIELD_RANGE_STEPS, lowerPosition + 1))
  const formattedRange = formatFieldRange(normalizedRange[0], normalizedRange[1])
  const disabled = !(max > min)

  return (
    <div
      className="viewer-colormap-range"
      role="group"
      aria-label={t('Color range')}
      title={t('Values outside this range use the endpoint colors')}
      style={{ '--viewer-field-range-gradient': viewerFieldRangeGradient(colormap, lowerPosition, upperPosition) } as CSSProperties}
    >
      <div className="viewer-colormap-range-values" aria-live="polite">
        <output>{formattedRange[0]}</output>
        <output>{formattedRange[1]}</output>
      </div>
      <div className="viewer-colormap-range-slider">
        <div className="viewer-colormap-range-track" aria-hidden="true" />
        <input
          className="viewer-colormap-range-min"
          type="range"
          min={0}
          max={VIEWER_FIELD_RANGE_STEPS}
          step={1}
          value={lowerPosition}
          disabled={disabled}
          aria-label={`${t('Minimum color range')} · ${fieldName}`}
          onChange={(event) => {
            const position = Math.min(Number(event.target.value), upperPosition - 1)
            onChange([viewerFieldRangeSliderValue(min, max, position, scale), normalizedRange[1]])
          }}
        />
        <input
          className="viewer-colormap-range-max"
          type="range"
          min={0}
          max={VIEWER_FIELD_RANGE_STEPS}
          step={1}
          value={upperPosition}
          disabled={disabled}
          aria-label={`${t('Maximum color range')} · ${fieldName}`}
          onChange={(event) => {
            const position = Math.max(Number(event.target.value), lowerPosition + 1)
            onChange([normalizedRange[0], viewerFieldRangeSliderValue(min, max, position, scale)])
          }}
        />
      </div>
    </div>
  )
}
