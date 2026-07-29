import { FormEvent, useMemo, useState } from 'react'
import { ChevronDown, Plus, Sparkles, Trash2, X } from 'lucide-react'
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
  const hasRecommendation = schemaHasRecommendation(schema)

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
            <p className="eyebrow">{hasRecommendation ? 'VIBE SIMULATE RECOVERY' : 'FLOW360 SCHEMA PREFLIGHT'}</p>
            <h2>{hasRecommendation ? 'The Agent found a recovery path' : 'Complete required simulation inputs'}</h2>
            <span>
              {hasRecommendation
                ? 'Review the evidence and apply the recommendation. No CFD parameter entry is required.'
                : 'The form is generated from the installed Flow360 schema.'}
            </span>
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
            {submitting
              ? 'Validating with Flow360…'
              : hasRecommendation
                ? 'Apply AI recommendation & validate'
                : 'Apply inputs & validate again'}
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
    const unitOptions = schema.unit_options?.length ? schema.unit_options : [schema.unit ?? '']
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
          <select
            aria-label={`${title} unit`}
            value={String(object.units ?? schema.unit ?? '')}
            onChange={(event) => onChange({ ...object, units: event.target.value })}
            required
          >
            {unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
          </select>
        </span>
      </label>
    )
  }
  if (schema.type === 'entity_assignment') {
    return <EntityAssignmentField schema={schema} value={value} onChange={onChange} fieldID={fieldID} title={title} />
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

function EntityAssignmentField({
  schema,
  value,
  onChange,
  fieldID,
  title,
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  fieldID: string
  title: string
}) {
  const [editing, setEditing] = useState(false)
  const draft = isRecord(value) ? value : {}
  const selected = Array.isArray(draft.entities) ? draft.entities.filter((item): item is string => typeof item === 'string') : []
  const entityChoices = schema.entity_choices ?? []
  const allSelected = entityChoices.length > 0 && entityChoices.every((choice) => selected.includes(choice.value))
  const model = String(draft.model ?? schema.default_model ?? '')
  const modelLabel = schema.model_choices?.find((choice) => choice.value === model)?.label ?? model
  const recommendation = schema.recommendation
  return (
    <fieldset className="schema-object schema-entity-assignment">
      <legend>{title}</legend>
      {recommendation ? (
        <div className="schema-ai-recommendation">
          <div className="schema-ai-heading">
            <span><Sparkles size={15} /><strong>AI recommendation</strong></span>
            <em className={`confidence-${recommendation.confidence}`}>{recommendation.confidence} confidence</em>
          </div>
          <h3>{recommendation.title}</h3>
          <p>{recommendation.reason}</p>
          <div className="schema-ai-summary">
            <span><small>Boundary model</small><strong>{modelLabel}</strong></span>
            <span><small>Surfaces</small><strong>{selected.length} selected</strong></span>
          </div>
          {recommendation.evidence?.length ? (
            <details>
              <summary>Why the Agent recommends this</summary>
              <ul>{recommendation.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          ) : null}
          <button type="button" className="schema-change-recommendation" onClick={() => setEditing((current) => !current)}>
            <ChevronDown size={13} className={editing ? 'expanded' : ''} />
            {editing ? 'Hide choices' : 'Change recommendation'}
          </button>
        </div>
      ) : schema.description ? <p>{schema.description}</p> : null}
      {(!recommendation || editing) && (
        <div className="schema-assignment-editor">
          <label className="schema-field" htmlFor={`${fieldID}-model`}>
            <span className="schema-field-label">
              <strong>How should these surfaces behave?</strong>
              <small>Select a Flow360 boundary model only if the AI recommendation does not match your engineering intent.</small>
            </span>
            <select
              id={`${fieldID}-model`}
              required
              value={model}
              onChange={(event) => onChange({ ...draft, model: event.target.value })}
            >
              {(schema.model_choices ?? []).map((choice) => (
                <option key={choice.value} value={choice.value}>{choice.label}</option>
              ))}
            </select>
          </label>
          <div className="schema-entity-header">
            <strong>Geometry surfaces included</strong>
            <button
              type="button"
              onClick={() => onChange({
                ...draft,
                entities: allSelected ? [] : entityChoices.map((choice) => choice.value),
              })}
            >
              {allSelected ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="schema-entity-grid">
            {entityChoices.map((choice) => (
              <label key={choice.value}>
                <input
                  type="checkbox"
                  checked={selected.includes(choice.value)}
                  onChange={(event) => onChange({
                    ...draft,
                    entities: event.target.checked
                      ? [...selected, choice.value]
                      : selected.filter((item) => item !== choice.value),
                  })}
                />
                <code>{choice.label}</code>
              </label>
            ))}
          </div>
        </div>
      )}
    </fieldset>
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
    case 'entity_assignment':
      return {
        model: schema.default_model ?? schema.model_choices?.[0]?.value ?? '',
        entities: schema.default_entities ?? [],
      }
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
    case 'entity_assignment': {
      const object = isRecord(value) ? value : {}
      const model = String(object.model ?? '').trim()
      const entities = Array.isArray(object.entities)
        ? object.entities.filter((item): item is string => typeof item === 'string')
        : []
      if (!model) throw new Error(`${schema.title || 'Boundary assignment'} requires a model.`)
      if (!entities.length) throw new Error(`${schema.title || 'Boundary assignment'} requires at least one surface.`)
      return { model, entities }
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

function schemaHasRecommendation(schema: DynamicFormSchema): boolean {
  if (schema.recommendation) return true
  return Object.values(schema.properties ?? {}).some(schemaHasRecommendation)
    || (schema.variants ?? []).some(schemaHasRecommendation)
    || Boolean(schema.items && schemaHasRecommendation(schema.items))
}
