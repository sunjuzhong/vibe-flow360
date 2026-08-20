import type { ReactNode } from 'react'
import type { DynamicFormSchema } from '../../api/client'

type EntityListFieldProps = {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  title: string
  fieldID: string
  descriptionHelp?: ReactNode
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default function EntityListField({ schema, value, onChange, title, fieldID, descriptionHelp }: EntityListFieldProps) {
  const draft = isRecord(value) ? value : {}
  const selected = Array.isArray(draft.entities) ? draft.entities.filter((item): item is string => typeof item === 'string') : []
  const choices = schema.entity_choices ?? []
  const allSelected = choices.length > 0 && choices.every((choice) => selected.includes(choice.value))

  return <fieldset className="schema-object schema-entity-list" id={fieldID}>
    <legend><span className="schema-legend-content">{title}{schema.required === true ? ' *' : ''}{descriptionHelp}</span></legend>
    <div className="schema-entity-header">
      <span>{selected.length} selected</span>
      <button type="button" onClick={() => onChange({ ...draft, entities: allSelected ? [] : choices.map((choice) => choice.value) })}>{allSelected ? 'Clear all' : 'Select all'}</button>
    </div>
    {choices.length ? <div className="schema-entity-grid">{choices.map((choice) => <label key={choice.value} className={selected.includes(choice.value) ? 'selected' : ''}><input type="checkbox" checked={selected.includes(choice.value)} onChange={(event) => onChange({ ...draft, entities: event.target.checked ? [...selected, choice.value] : selected.filter((item) => item !== choice.value) })} /><span><code>{choice.label}</code>{choice.model_type && <small>{choice.model_type}</small>}</span></label>)}</div> : <div className="schema-array-empty"><strong>No compatible entities</strong><span>Create a compatible entity before configuring this output.</span></div>}
  </fieldset>
}
