import type { DynamicFormSchema } from '../../api/client'
import HelpTooltip from '../HelpTooltip'
import { cleanSchemaDescription, variantLabel } from './common'

type UnionVariantPickerProps = {
  title: string
  variants: DynamicFormSchema[]
  selected: number
  onSelect: (variant: number) => void
}

export default function UnionVariantPicker({ title, variants, selected, onSelect }: UnionVariantPickerProps) {
  return (
    <div className="schema-union-picker" role="radiogroup" aria-label={`${title} value type`}>
      <span>Value type</span>
      <div>
        {variants.map((variant, index) => {
          const label = variantLabel(variant, index)
          const description = variant.description ? cleanSchemaDescription(variant.description) : ''
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected === index}
              className={selected === index ? 'active' : ''}
              key={index}
              title={description ? `${label}: ${description}` : label}
              onClick={() => onSelect(index)}
            >
              <strong>{label}</strong>
              {description && (
                <span className="schema-union-option-help" onClick={(event) => event.stopPropagation()}>
                  <HelpTooltip label={`About ${label}`} placement="bottom" align="start">
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
