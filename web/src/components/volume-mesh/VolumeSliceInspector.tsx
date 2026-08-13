import { AlertCircle, Slice } from 'lucide-react'
import type { VolumeSliceVariant, VolumeSliceVariantReview } from '../../lib/volumeMeshReview'
import { useI18n } from '../../i18n'
import './VolumeSliceInspector.css'

export function VolumeSliceVariantControl({
  variants,
  variant,
  onVariant,
}: {
  variants: VolumeSliceVariantReview
  variant: VolumeSliceVariant
  onVariant: (variant: VolumeSliceVariant) => void
}) {
  const { t } = useI18n()
  if (variants.families.length === 0) return null
  return (
    <div className="volume-field-slice-option">
      <span>{t('Slice representation')}</span>
      <div className="volume-slice-variant" role="group" aria-label={t('Generated slice representation')}>
        {(['flat', 'crinkled'] as const).map((candidate) => {
          const supported = candidate === 'flat' ? variants.hasFlat : variants.hasCrinkled
          return (
            <button type="button" className={variant === candidate ? 'active' : ''} disabled={!supported} aria-pressed={variant === candidate} key={candidate} onClick={() => onVariant(candidate)}>
              {t(candidate === 'flat' ? 'Flat' : 'Crinkled')}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function VolumeSliceInspector({
  available,
  variants,
  variant,
  onVariant,
}: {
  available: boolean
  variants: VolumeSliceVariantReview
  variant: VolumeSliceVariant
  onVariant: (variant: VolumeSliceVariant) => void
}) {
  const { t } = useI18n()
  return (
    <section className="volume-slice-inspector">
      <div className="geometry-section-title"><Slice size={13} /> Section diagnostic</div>
      {!available && (
        <div className="volume-slice-caveat"><AlertCircle size={13} /> A real VolumeMesh asset is required.</div>
      )}
      {variants.families.length > 0 && (
        <>
          <VolumeSliceVariantControl variants={variants} variant={variant} onVariant={onVariant} />
          <p className="volume-slice-variant-detail">
            {`${variants.pairedCount} paired generated ${variants.pairedCount === 1 ? 'slice' : 'slices'} · Flat is the default where available.`}
            {!variants.hasFlat ? ' Flat is unavailable, so Crinkled is retained.' : !variants.hasCrinkled ? ' Crinkled is unavailable.' : ''}
          </p>
        </>
      )}
      <p>{variants.families.length > 0
        ? t('The representation switch controls Flow360-generated slice faces. Use the shared Clip tool below the 3D view for interactive clipping.')
        : t('No Flow360-generated flat or crinkled slice pair was identified. Use the shared Clip tool below the 3D view for interactive clipping.')}</p>
    </section>
  )
}
