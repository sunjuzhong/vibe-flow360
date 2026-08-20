import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import type { DynamicFormSchema } from '../../api/client'

type QuantityFieldProps = {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  title: string
  fieldID: string
  label: ReactNode
  fieldIssues: Array<{ path?: string; message: string }>
  canonicalUnit: (schema: DynamicFormSchema, unit: string) => string
  numberConstraint: (schema: DynamicFormSchema | undefined, key: 'minimum' | 'maximum') => number | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default function QuantityField({
  schema,
  value,
  onChange,
  title,
  fieldID,
  label,
  fieldIssues,
  canonicalUnit,
  numberConstraint,
}: QuantityFieldProps) {
  const object = isRecord(value) ? value : {}
  const unitOptions = schema.unit_options?.length ? schema.unit_options : [schema.unit ?? '']
  const storedUnit = String(object.units ?? schema.unit ?? '')
  const selectedUnit = canonicalUnit(schema, storedUnit)
  const unsupportedUnit = Boolean(selectedUnit) && !unitOptions.includes(selectedUnit)

  return (
    <label className={`schema-field schema-quantity-field${fieldIssues.length ? ' schema-field-invalid' : ''}`} htmlFor={fieldID}>
      {label}
      <span className="schema-quantity">
        <input
          id={fieldID}
          type="number"
          required
          step="any"
          min={numberConstraint(schema.value_schema, 'minimum')}
          max={numberConstraint(schema.value_schema, 'maximum')}
          value={String(object.value ?? '')}
          onChange={(event) => onChange({ ...object, value: event.target.value })}
        />
        <select
          aria-label={`${title} unit`}
          value={selectedUnit}
          onChange={(event) => onChange({ ...object, units: event.target.value })}
          required
        >
          {unsupportedUnit && <option value={selectedUnit} disabled>Unsupported: {selectedUnit}</option>}
          {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      </span>
      {fieldIssues.map((issue, index) => <small className="schema-inline-error" role="alert" key={`${issue.path}-${index}`}><AlertCircle size={12} />{issue.message}</small>)}
    </label>
  )
}
