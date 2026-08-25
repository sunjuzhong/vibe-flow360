import type { DynamicFormSchema } from '../../api/client'
import type { KeyboardEvent } from 'react'
import { currentLanguage } from '../../i18n'
import { translate } from '../../i18n/translations'
import HelpTooltip from '../HelpTooltip'
import { cleanSchemaDescription, variantLabel } from './common'

type UnionVariantPickerProps = {
  id?: string
  title: string
  variants: DynamicFormSchema[]
  selected: number
  onSelect: (variant: number) => void
  disabled?: boolean
  describedBy?: string
  invalid?: boolean
  required?: boolean
}

export default function UnionVariantPicker({ id, title, variants, selected, onSelect, disabled = false, describedBy, invalid = false, required = false }: UnionVariantPickerProps) {
  const t = (value: string) => translate(value, currentLanguage())
  const moveSelection = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (!disabled) onSelect(index)
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    if (disabled) return
    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? variants.length - 1
        : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + variants.length) % variants.length
    onSelect(nextIndex)
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]')
    buttons?.[nextIndex]?.focus()
  }
  return (
    <div id={id} className="schema-union-picker" role="radiogroup" aria-label={`${title} ${t('Value type')}`} aria-describedby={describedBy} aria-invalid={invalid || undefined} aria-required={required || undefined} aria-disabled={disabled || undefined}>
      <span>{t('Value type')}</span>
      <div>
        {variants.map((variant, index) => {
          const label = variantLabel(variant, index)
          const description = variant.description ? cleanSchemaDescription(variant.description) : ''
          return (
            <div
              role="radio"
              aria-checked={selected === index}
              aria-disabled={disabled || undefined}
              tabIndex={!disabled && selected === index ? 0 : -1}
              className={selected === index ? 'active' : ''}
              key={index}
              title={description ? `${label}: ${description}` : label}
              onClick={() => { if (!disabled) onSelect(index) }}
              onKeyDown={(event) => moveSelection(event, index)}
            >
              <strong>{label}</strong>
              {description && !disabled && (
                <span className="schema-union-option-help" onClick={(event) => event.stopPropagation()}>
                  <HelpTooltip label={t('About {title}').replace('{title}', label)} placement="bottom" align="start">
                    {description}
                  </HelpTooltip>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
