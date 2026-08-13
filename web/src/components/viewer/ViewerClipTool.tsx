import { Scissors, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { BoundingBoxData, ViewerClipPlane } from './Viewer3D'

export type ViewerClipAxis = 'x' | 'y' | 'z'

export function viewerClipBounds(
  boundingBox: BoundingBoxData | null | undefined,
  axis: ViewerClipAxis,
): [number, number] {
  if (!boundingBox) return [-1, 1]
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const min = boundingBox.min[index]
  const max = boundingBox.max[index]
  return Number.isFinite(min) && Number.isFinite(max) && min < max ? [min, max] : [-1, 1]
}

export function createViewerClipPlane(
  enabled: boolean,
  axis: ViewerClipAxis,
  position: number,
): ViewerClipPlane | null {
  if (!enabled) return null
  const normal: [number, number, number] = axis === 'x'
    ? [1, 0, 0]
    : axis === 'y' ? [0, 1, 0] : [0, 0, 1]
  return { normal, constant: -position }
}

export function ViewerClipButton({
  enabled,
  onToggle,
}: {
  enabled: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  return (
    <button
      type="button"
      className={`viewer-clip-toggle viewer-icon-tooltip ${enabled ? 'active' : ''}`}
      data-tooltip={t('Toggle clipping plane')}
      aria-label={t('Toggle clipping plane')}
      aria-pressed={enabled}
      onClick={onToggle}
    >
      <Scissors size={14} /> <span>{t('Clip')}</span>
    </button>
  )
}

export function ViewerClipPopover({
  axis,
  position,
  bounds,
  onAxisChange,
  onPositionChange,
  onClose,
}: {
  axis: ViewerClipAxis
  position: number
  bounds: [number, number]
  onAxisChange: (axis: ViewerClipAxis) => void
  onPositionChange: (position: number) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const step = (bounds[1] - bounds[0]) / 300 || 0.01
  return (
    <section className="viewer-clip-popover" role="dialog" aria-label={t('Inspection tools')}>
      <header>
        <strong><Scissors size={13} /> {t('Inspection tools')}</strong>
        <button type="button" onClick={onClose} aria-label={t('Close inspection tools')} title={t('Close inspection tools')}>
          <X size={13} />
        </button>
      </header>
      <div className="viewer-clip-controls">
        <label>{t('Clip axis')}
          <select value={axis} onChange={(event) => onAxisChange(event.target.value as ViewerClipAxis)}>
            <option value="x">{t('X plane')}</option>
            <option value="y">{t('Y plane')}</option>
            <option value="z">{t('Z plane')}</option>
          </select>
        </label>
        <label>{t('Position')} · {position.toPrecision(5)}
          <input
            aria-label={t('Clipping plane position')}
            type="range"
            min={bounds[0]}
            max={bounds[1]}
            step={step}
            value={position}
            onChange={(event) => onPositionChange(Number(event.target.value))}
          />
        </label>
      </div>
    </section>
  )
}
