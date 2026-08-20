import type { DynamicFormSchema } from '../../api/client'
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
        {variants.map((variant, index) => (
          <button
            type="button"
            role="radio"
            aria-checked={selected === index}
            className={selected === index ? 'active' : ''}
            key={index}
            onClick={() => onSelect(index)}
          >
            <strong>{variantLabel(variant, index)}</strong>
            {variant.description && <small>{cleanSchemaDescription(variant.description)}</small>}
          </button>
        ))}
      </div>
    </div>
  )
}
