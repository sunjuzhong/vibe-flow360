import { FormEvent, useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type { DynamicFormSchema } from '../api/client'

type SchemaFormDialogProps = {
  schema: DynamicFormSchema
  issues: Array<{ path?: string; message: string; stages?: string[] }>
  submitting: boolean
  onCancel: () => void
  onSubmit: (values: Record<string, unknown>) => void
}

type UnionDraft = { variant: number; value: unknown }

export default function SchemaFormDialog({
  schema,
  issues,
  submitting,
  onCancel,
  onSubmit,
}: SchemaFormDialogProps) {
  const initial = useMemo(() => initialValue(schema), [schema])
  const [value, setValue] = useState<unknown>(initial)
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    try {
      const serialized = serializeValue(schema, value)
      if (!isRecord(serialized)) throw new Error('The Flow360 form root must be an object.')
      setError('')
      onSubmit(serialized)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="schema-form-backdrop" role="presentation">
      <form className="schema-form-dialog" onSubmit={submit} aria-label="Complete Flow360 inputs">
        <header>
          <div>
            <p className="eyebrow">FLOW360 SCHEMA PREFLIGHT</p>
            <h2>Complete required simulation inputs</h2>
            <span>The form is generated from the installed Flow360 schema.</span>
          </div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close required inputs">
            <X size={18} />
          </button>
        </header>
        <div className="schema-form-issues">
          {issues.map((issue, index) => (
            <div key={`${issue.path}-${index}`}>
              <strong>{issue.stages?.join(' → ') || 'SimulationParams'}</strong>
              <code>{issue.path || 'schema'}</code>
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
        <div className="schema-form-body">
          <SchemaField schema={schema} value={value} onChange={setValue} path="" />
        </div>
        {error && <div className="schema-form-error">{error}</div>}
        <footer>
          <button type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? 'Validating with Flow360…' : 'Apply inputs & validate again'}
          </button>
        </footer>
      </form>
    </div>
  )
}

function SchemaField({
  schema,
  value,
  onChange,
  path,
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  path: string
}) {
  const title = schema.title || humanize(path.split('.').pop() || 'Simulation parameters')
  const fieldID = `schema-${path.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`
  if (schema.type === 'object') {
    const object = isRecord(value) ? value : {}
    return (
      <fieldset className="schema-object">
        {path && <legend>{title}</legend>}
        {schema.description && path && <p>{schema.description}</p>}
        {Object.entries(schema.properties ?? {}).map(([key, child]) => (
          <SchemaField
            key={key}
            schema={child}
            path={path ? `${path}.${key}` : key}
            value={object[key]}
            onChange={(next) => onChange({ ...object, [key]: next })}
          />
        ))}
      </fieldset>
    )
  }
  if (schema.type === 'quantity') {
    const object = isRecord(value) ? value : {}
    return (
      <label className="schema-field" htmlFor={fieldID}>
        <FieldLabel schema={schema} title={title} path={path} />
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
          <input
            aria-label={`${title} unit`}
            value={String(object.units ?? schema.unit ?? '')}
            onChange={(event) => onChange({ ...object, units: event.target.value })}
            required
          />
        </span>
      </label>
    )
  }
  if (schema.type === 'boolean') {
    return (
      <label className="schema-field schema-boolean">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <FieldLabel schema={schema} title={title} path={path} />
      </label>
    )
  }
  if (schema.type === 'enum') {
    return (
      <label className="schema-field" htmlFor={fieldID}>
        <FieldLabel schema={schema} title={title} path={path} />
        <select id={fieldID} value={JSON.stringify(value)} onChange={(event) => onChange(JSON.parse(event.target.value))}>
          {(schema.options ?? []).map((option) => (
            <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>
          ))}
        </select>
      </label>
    )
  }
  if (schema.type === 'array') {
    const array = Array.isArray(value) ? value : []
    return (
      <fieldset className="schema-object schema-array">
        <legend>{title}</legend>
        {schema.description && <p>{schema.description}</p>}
        {array.map((item, index) => (
          <div className="schema-array-item" key={index}>
            <SchemaField
              schema={schema.items ?? { type: 'json' }}
              path={`${path}.${index}`}
              value={item}
              onChange={(next) => onChange(array.map((entry, itemIndex) => itemIndex === index ? next : entry))}
            />
            <button type="button" className="icon-button" onClick={() => onChange(array.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${title} ${index + 1}`}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => onChange([...array, initialValue(schema.items ?? { type: 'json' })])}>
          <Plus size={14} /> Add item
        </button>
      </fieldset>
    )
  }
  if (schema.type === 'union') {
    const draft = isUnionDraft(value) ? value : { variant: 0, value: initialValue(schema.variants?.[0] ?? { type: 'json' }) }
    const selected = schema.variants?.[draft.variant] ?? { type: 'json' as const }
    return (
      <fieldset className="schema-object">
        <legend>{title}</legend>
        <label className="schema-field">
          <span>Value type</span>
          <select
            value={draft.variant}
            onChange={(event) => {
              const variant = Number(event.target.value)
              onChange({ variant, value: initialValue(schema.variants?.[variant] ?? { type: 'json' }) })
            }}
          >
            {(schema.variants ?? []).map((variant, index) => (
              <option value={index} key={index}>{variant.title || humanize(variant.type)}</option>
            ))}
          </select>
        </label>
        <SchemaField schema={selected} value={draft.value} path={`${path}.value`} onChange={(next) => onChange({ ...draft, value: next })} />
      </fieldset>
    )
  }
  if (schema.type === 'json') {
    return (
      <label className="schema-field" htmlFor={fieldID}>
        <FieldLabel schema={schema} title={title} path={path} />
        <textarea id={fieldID} className="plan-code-input" value={String(value ?? '{}')} onChange={(event) => onChange(event.target.value)} />
      </label>
    )
  }
  return (
    <label className="schema-field" htmlFor={fieldID}>
      <FieldLabel schema={schema} title={title} path={path} />
      <input
        id={fieldID}
        type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}
        step={schema.type === 'integer' ? 1 : schema.type === 'number' ? 'any' : undefined}
        required={schema.required === true}
        min={schema.minimum}
        max={schema.maximum}
        minLength={schema.minLength}
        maxLength={schema.maxLength}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function FieldLabel({ schema, title, path }: { schema: DynamicFormSchema; title: string; path: string }) {
  return (
    <span className="schema-field-label">
      <strong>{title}{schema.required === true ? ' *' : ''}</strong>
      <code>{path}</code>
      {schema.description && <small>{schema.description}</small>}
    </span>
  )
}

export function initialValue(schema: DynamicFormSchema): unknown {
  if (schema.default !== undefined && schema.default !== null) return schema.default
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, initialValue(child)]))
    case 'array':
      return []
    case 'quantity':
      return { value: '', units: schema.unit ?? '' }
    case 'boolean':
      return false
    case 'enum':
      return schema.options?.[0]
    case 'union':
      return { variant: 0, value: initialValue(schema.variants?.[0] ?? { type: 'json' }) }
    case 'json':
      return '{}'
    default:
      return ''
  }
}

export function serializeValue(schema: DynamicFormSchema, value: unknown): unknown {
  switch (schema.type) {
    case 'object': {
      const object = isRecord(value) ? value : {}
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, child]) => [key, serializeValue(child, object[key])]),
      )
    }
    case 'array':
      return (Array.isArray(value) ? value : []).map((item) => serializeValue(schema.items ?? { type: 'json' }, item))
    case 'quantity': {
      const object = isRecord(value) ? value : {}
      const numeric = Number(object.value)
      if (!Number.isFinite(numeric)) throw new Error(`${schema.title || schema.path || 'Quantity'} requires a numeric value.`)
      const units = String(object.units ?? schema.unit ?? '').trim()
      if (!units) throw new Error(`${schema.title || schema.path || 'Quantity'} requires a unit.`)
      return { value: numeric, units }
    }
    case 'number':
    case 'integer': {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) throw new Error(`${schema.title || schema.path || 'Field'} requires a number.`)
      if (schema.type === 'integer' && !Number.isInteger(numeric)) throw new Error(`${schema.title || schema.path || 'Field'} requires an integer.`)
      return numeric
    }
    case 'union': {
      const draft = isUnionDraft(value) ? value : { variant: 0, value }
      return serializeValue(schema.variants?.[draft.variant] ?? { type: 'json' }, draft.value)
    }
    case 'json':
      if (typeof value !== 'string') return value
      return JSON.parse(value)
    default:
      return value
  }
}

function numberConstraint(schema: DynamicFormSchema | undefined, key: 'minimum' | 'maximum') {
  return schema?.[key]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isUnionDraft(value: unknown): value is UnionDraft {
  return isRecord(value) && typeof value.variant === 'number' && 'value' in value
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
