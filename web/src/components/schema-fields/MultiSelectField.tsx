import { useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { DynamicFormSchema } from '../../api/client'
import { FieldShell, type FieldMessage } from '../FieldShell'
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
  messages?: FieldMessage[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default function MultiSelectField({ schema, value, onChange, title, fieldID, configured, showAll, fieldIssues, messages }: MultiSelectFieldProps) {
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
  const disabled = schema.disabled === true || schema.readOnly === true
  const fieldMessages = messages ?? fieldIssues.map((issue) => ({ ...issue, level: 'error' as const }))
  return (
    <FieldShell
      id={fieldID}
      label={title}
      required={schema.required === true}
      disabled={disabled}
      help={<SchemaDescriptionHelp description={schema.description} title={title} />}
      status={showAll && !configured ? 'Not configured' : undefined}
      messages={fieldMessages}
      className={`schema-object schema-multi-select-field${fieldIssues.length ? ' schema-field-invalid' : ''}`}
    >
      {(controlProps) => <details
        id={controlProps.id}
        className="schema-multi-select"
        tabIndex={disabled || fieldIssues.length ? -1 : undefined}
        aria-disabled={disabled || undefined}
        aria-label={controlProps['aria-label']}
        aria-invalid={controlProps['aria-invalid']}
        aria-required={controlProps['aria-required']}
        aria-describedby={controlProps['aria-describedby']}
        aria-errormessage={controlProps['aria-errormessage']}
        onClick={disabled ? (event) => event.preventDefault() : undefined}
      >
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
              <input value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} placeholder="Search options" aria-label="Search options" />
            </label>
            {(!allSelected || minimumSelections === 0) && <button type="button" disabled={disabled} onClick={() => update(allSelected ? selected.filter((item) => !options.includes(item)) : [...new Set([...selected, ...options])])}>{allSelected ? 'Clear predefined' : 'Select all'}</button>}
          </div>
          <div className="schema-multi-select-options" role="group" aria-label={`${title} options`}>
            {filtered.map((option) => {
              const checked = selected.includes(option)
              const optionDisabled = disabled || checked && selected.length <= minimumSelections
              return <label key={option} className={`${checked ? 'selected' : ''}${optionDisabled ? ' disabled' : ''}`.trim()}>
                <input type="checkbox" checked={checked} disabled={optionDisabled} onChange={(event) => update(event.target.checked ? [...selected, option] : selected.filter((item) => item !== option))} />
                <span>{option}</span>
                {!options.includes(option) && <small>Custom</small>}
              </label>
            })}
            {filtered.length === 0 && <div className="schema-multi-select-empty">No matching options</div>}
          </div>
          {preserved.length > 0 && <small className="schema-multi-select-preserved">{preserved.length === 1 ? 'One custom variable is preserved' : 'Custom variables are preserved'}</small>}
        </div>
      </details>}
    </FieldShell>
  )
}
