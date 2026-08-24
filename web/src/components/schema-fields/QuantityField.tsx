import type { ReactNode } from 'react'
import type { DynamicFormSchema } from '../../api/client'
import { FieldShell, type FieldMessage } from '../FieldShell'

type QuantityFieldProps = {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  title: string
  fieldID: string
  path?: string
  help?: ReactNode
  description?: ReactNode
  status?: ReactNode
  hideLabel?: boolean
  messages?: FieldMessage[]
  fieldIssues: Array<{ path?: string; message: string }>
  canonicalUnit: (schema: DynamicFormSchema, unit: string) => string
  numberConstraint: (schema: DynamicFormSchema | undefined, key: 'minimum' | 'maximum') => number | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatQuantityValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (isRecord(value)) return JSON.stringify(value, null, 2)
  return String(value ?? '')
}

function parseCompositeQuantityValue(schema: DynamicFormSchema | undefined, next: string): unknown {
  if (schema?.type === 'array') {
    const trimmed = next.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (Array.isArray(parsed)) return parsed
      } catch {
        return next
      }
    }
    return next.split(',').map((item) => item.trim()).filter(Boolean)
  }
  if (schema?.type === 'object') {
    try {
      return JSON.parse(next)
    } catch {
      return next
    }
  }
  return next
}

export default function QuantityField({
  schema,
  value,
  onChange,
  title,
  fieldID,
  path,
  help,
  description,
  status,
  hideLabel,
  messages,
  fieldIssues,
  canonicalUnit,
  numberConstraint,
}: QuantityFieldProps) {
  const object = isRecord(value) ? value : {}
  const unitOptions = schema.unit_options?.length ? schema.unit_options : [schema.unit ?? '']
  const storedUnit = String(object.units ?? schema.unit ?? '')
  const selectedUnit = canonicalUnit(schema, storedUnit)
  const unsupportedUnit = Boolean(selectedUnit) && !unitOptions.includes(selectedUnit)
  const valueSchema = schema.value_schema ?? { type: 'number' as const }
  const scalarValue = valueSchema.type === 'number' || valueSchema.type === 'integer'
  const disabled = schema.disabled === true || schema.readOnly === true
  const fieldMessages = messages ?? fieldIssues.map((issue) => ({ ...issue, level: 'error' as const }))

  return (
    <FieldShell
      id={fieldID}
      label={title}
      path={path}
      help={help}
      description={description}
      status={status}
      hideLabel={hideLabel}
      required={schema.required === true}
      disabled={disabled}
      messages={fieldMessages}
      className={`schema-field schema-quantity-field${fieldIssues.length ? ' schema-field-invalid' : ''}`}
    >
      {(controlProps) => <span className="schema-quantity">
        {scalarValue ? (
          <input
            {...controlProps}
            type="number"
            step={valueSchema.type === 'integer' ? 1 : 'any'}
            min={numberConstraint(valueSchema, 'minimum')}
            max={numberConstraint(valueSchema, 'maximum')}
            value={String(object.value ?? '')}
            onChange={(event) => onChange({ ...object, value: event.target.value })}
          />
        ) : (
          <textarea
            {...controlProps}
            rows={2}
            spellCheck={false}
            value={formatQuantityValue(object.value)}
            placeholder={valueSchema.type === 'array' ? '0, 0, 0' : 'JSON value'}
            onChange={(event) => onChange({ ...object, value: parseCompositeQuantityValue(valueSchema, event.target.value) })}
          />
        )}
        <select
          id={`${fieldID}-unit`}
          aria-label={`${title} unit`}
          aria-describedby={controlProps['aria-describedby']}
          value={selectedUnit}
          onChange={(event) => onChange({ ...object, units: event.target.value })}
          disabled={disabled}
          required
        >
          {unsupportedUnit && <option value={selectedUnit} disabled>Unsupported: {selectedUnit}</option>}
          {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      </span>}
    </FieldShell>
  )
}
