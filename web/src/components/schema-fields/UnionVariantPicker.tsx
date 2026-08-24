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
  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? variants.length - 1
        : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + variants.length) % variants.length
    onSelect(nextIndex)
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
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
            <button
              type="button"
              role="radio"
              aria-checked={selected === index}
              tabIndex={selected === index ? 0 : -1}
              disabled={disabled}
              className={selected === index ? 'active' : ''}
              key={index}
              title={description ? `${label}: ${description}` : label}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => moveSelection(event, index)}
            >
              <strong>{label}</strong>
              {description && (
                <span className="schema-union-option-help" onClick={(event) => event.stopPropagation()}>
                  <HelpTooltip label={t('About {title}').replace('{title}', label)} placement="bottom" align="start">
                    {description}
                  </HelpTooltip>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
