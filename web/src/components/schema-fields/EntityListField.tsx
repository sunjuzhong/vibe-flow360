import type { ReactNode } from 'react'
import type { DynamicFormSchema } from '../../api/client'
import { currentLanguage } from '../../i18n'
import { translate } from '../../i18n/translations'
import { FieldShell, type FieldMessage } from '../FieldShell'

type EntityListFieldProps = {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  title: string
  fieldID: string
  descriptionHelp?: ReactNode
  invalid?: boolean
  configured?: boolean
  showAll?: boolean
  status?: ReactNode
  messages?: FieldMessage[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export default function EntityListField({ schema, value, onChange, title, fieldID, descriptionHelp, invalid = false, status, messages = [] }: EntityListFieldProps) {
  const draft = isRecord(value) ? value : {}
  const selected = Array.isArray(draft.entities) ? draft.entities.filter((item): item is string => typeof item === 'string') : []
  const choices = schema.entity_choices ?? []
  const allSelected = choices.length > 0 && choices.every((choice) => selected.includes(choice.value))
  const disabled = schema.disabled === true || schema.readOnly === true
  const t = (value: string) => translate(value, currentLanguage())
  const entityKind = schema.entity_kind ? t(schema.entity_kind) : t('entity')

  return <FieldShell
    id={fieldID}
    label={title}
    required={schema.required === true}
    disabled={disabled}
    help={descriptionHelp}
    status={status}
    messages={messages}
    className={`schema-object schema-entity-list${invalid ? ' schema-field-invalid' : ''}`}
  >
    {(controlProps) => <div
      id={controlProps.id}
      role="group"
      aria-label={controlProps['aria-label']}
      tabIndex={invalid && !disabled ? -1 : undefined}
      aria-invalid={controlProps['aria-invalid']}
      aria-required={controlProps['aria-required']}
      aria-describedby={controlProps['aria-describedby']}
      aria-errormessage={controlProps['aria-errormessage']}
    >
      <div className="schema-entity-header">
        <span>{selected.length} {t('selected')}</span>
        <button type="button" disabled={disabled || choices.length === 0} onClick={() => onChange({ ...draft, entities: allSelected ? [] : choices.map((choice) => choice.value) })}>{t(allSelected ? 'Clear all' : 'Select all')}</button>
      </div>
      {choices.length ? <div className="schema-entity-grid">{choices.map((choice) => <label key={choice.value} className={selected.includes(choice.value) ? 'selected' : ''}><input type="checkbox" disabled={disabled} checked={selected.includes(choice.value)} onChange={(event) => onChange({ ...draft, entities: event.target.checked ? [...selected, choice.value] : selected.filter((item) => item !== choice.value) })} /><span><code>{choice.label}</code>{choice.model_type && <small>{choice.model_type}</small>}</span></label>)}</div> : <div className="schema-array-empty"><strong>{t('No compatible entities')}</strong><span>{t('This field accepts: {entity}.').replace('{entity}', entityKind)}</span><small>{t('Create one from the Parameter entities panel, then reopen this editor.')}</small></div>}
    </div>}
  </FieldShell>
}
