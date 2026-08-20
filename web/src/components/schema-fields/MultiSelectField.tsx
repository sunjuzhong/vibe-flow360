import { useState } from 'react'
import { AlertCircle, ChevronDown, Search } from 'lucide-react'
import type { DynamicFormSchema } from '../../api/client'
import { SchemaDescriptionHelp } from './common'

type MultiSelectFieldProps = {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  title: string
  fieldID: string
  configured: boolean
  showAll: boolean
  fieldIssues: Array<{ path?: string; message: string }>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default function MultiSelectField({ schema, value, onChange, title, fieldID, configured, showAll, fieldIssues }: MultiSelectFieldProps) {
  const [query, setQuery] = useState('')
  const draft = isRecord(value) ? value : {}
  const valueKey = schema.value_key || 'items'
  const stored = Array.isArray(draft[valueKey]) ? draft[valueKey] : []
  const selected = stored.filter((item): item is string => typeof item === 'string')
  const preserved = stored.filter((item) => typeof item !== 'string')
  const options = (schema.options ?? []).filter((item): item is string => typeof item === 'string')
  const choices = [...options, ...selected.filter((item) => !options.includes(item))]
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = choices.filter((item) => item.toLowerCase().includes(normalizedQuery))
  const allSelected = options.length > 0 && options.every((option) => selected.includes(option))
  const minimumSelections = schema.minItems ?? 0
  const update = (next: string[]) => onChange({ ...draft, [valueKey]: [...next, ...preserved] })
  return (
    <fieldset className={`schema-object schema-multi-select-field${fieldIssues.length ? ' schema-field-invalid' : ''}`} id={fieldID}>
      <legend>
        <span className="schema-legend-content">
          {title}{schema.required === true ? ' *' : ''}
          <SchemaDescriptionHelp description={schema.description} title={title} />
          {showAll && !configured && <small className="schema-field-state">Not configured</small>}
        </span>
      </legend>
      <details className="schema-multi-select">
        <summary>
          <span className={selected.length ? 'schema-multi-select-values' : 'schema-multi-select-placeholder'}>
            {selected.length ? selected.slice(0, 3).map((item) => <span key={item}>{item}</span>) : 'Select options'}
            {selected.length > 3 && <em>+{selected.length - 3}</em>}
          </span>
          <span className="schema-multi-select-count">{selected.length} selected</span>
          <ChevronDown size={15} aria-hidden="true" />
        </summary>
        <div className="schema-multi-select-popover">
          <div className="schema-multi-select-tools">
            <label>
              <Search size={14} aria-hidden="true" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search options" aria-label="Search options" />
            </label>
            {(!allSelected || minimumSelections === 0) && <button type="button" onClick={() => update(allSelected ? selected.filter((item) => !options.includes(item)) : [...new Set([...selected, ...options])])}>{allSelected ? 'Clear predefined' : 'Select all'}</button>}
          </div>
          <div className="schema-multi-select-options" role="group" aria-label={`${title} options`}>
            {filtered.map((option) => {
              const checked = selected.includes(option)
              const disabled = checked && selected.length <= minimumSelections
              return <label key={option} className={`${checked ? 'selected' : ''}${disabled ? ' disabled' : ''}`.trim()}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => update(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />
                <span>{option}</span>
                {!options.includes(option) && <small>Custom</small>}
              </label>
            })}
            {filtered.length === 0 && <div className="schema-multi-select-empty">No matching options</div>}
          </div>
          {preserved.length > 0 && <small className="schema-multi-select-preserved">{preserved.length === 1 ? 'One custom variable is preserved' : 'Custom variables are preserved'}</small>}
        </div>
      </details>
      {fieldIssues.map((issue, index) => <small className="schema-inline-error" role="alert" key={`${issue.path}-${index}`}><AlertCircle size={12} />{issue.message}</small>)}
    </fieldset>
  )
}
