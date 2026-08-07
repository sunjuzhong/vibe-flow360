import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from 'react'
import { ChevronDown, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { DynamicFormSchema } from '../api/client'
import { schemaContainsRecommendation, schemaRequiresUserInput } from '../lib/planPresentation'
import HelpTooltip from './HelpTooltip'

type SchemaFormDialogProps = {
  schema: DynamicFormSchema
  issues: Array<{ path?: string; message: string; stages?: string[] }>
  submitting: boolean
  onCancel: () => void
  onSubmit: (values: Record<string, unknown>) => void
  initialValues?: Record<string, unknown>
  sparse?: boolean
}

type UnionDraft = { variant: number; value: unknown }

export default function SchemaFormDialog({
  schema,
  issues,
  submitting,
  onCancel,
  onSubmit,
  initialValues,
  sparse = false,
}: SchemaFormDialogProps) {
  const initial = useMemo(
    () => initialValues ?? initialValue(schema, sparse),
    [initialValues, schema, sparse],
  )
  const [value, setValue] = useState<unknown>(initial)
  const [error, setError] = useState('')
  const hasRecommendation = schemaContainsRecommendation(schema)
  const requiresUserInput = schemaRequiresUserInput(schema)

  useEffect(() => {
    setValue(initial)
    setError('')
  }, [initial])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    try {
      const serialized = serializeValue(schema, value, sparse)
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
            <p className="eyebrow">{hasRecommendation ? 'VIBE SIMULATE RECOVERY' : 'AGENT-GUIDED PREFLIGHT'}</p>
            <h2>{hasRecommendation ? 'The Agent found a recovery path' : 'The Agent needs your input'}</h2>
            <span>
              {hasRecommendation
                ? requiresUserInput
                  ? 'Review the recovery and provide only the remaining engineering inputs requested by Flow360.'
                  : 'Review the evidence and apply the recommendation. No CFD parameter entry is required.'
                : 'Flow360 has no safe default for these engineering decisions. Complete only the requested fields; the Agent will validate them before approval.'}
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
          <SchemaFormFields schema={schema} value={value} onChange={setValue} sparse={sparse} />
        </div>
        {error && <div className="schema-form-error">{error}</div>}
        <footer>
          <button type="button" onClick={onCancel} disabled={submitting}>Cancel</button>
          <button className="primary" type="submit" disabled={submitting}>
            {submitting
              ? 'Validating with Flow360…'
              : hasRecommendation
                ? 'Apply AI recommendation & validate'
                : 'Apply inputs & let Agent validate'}
          </button>
        </footer>
      </form>
    </div>
  )
}

export function SchemaFormFields({
  schema,
  value,
  onChange,
  sparse = false,
  showAll = false,
  baseline,
  addLabel = 'Change',
  removeLabel = 'Keep inherited',
  rootTabs = false,
  collapsibleObjects = false,
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  sparse?: boolean
  showAll?: boolean
  baseline?: unknown
  addLabel?: string
  removeLabel?: string
  rootTabs?: boolean
  collapsibleObjects?: boolean
}) {
  const tabKeys = useMemo(() => rootTabs && schema.type === 'object' ? Object.keys(schema.properties ?? {}) : [], [rootTabs, schema])
  const [activeTab, setActiveTab] = useState(tabKeys[0] ?? '')

  useEffect(() => {
    if (!tabKeys.includes(activeTab)) setActiveTab(tabKeys[0] ?? '')
  }, [activeTab, tabKeys])

  if (rootTabs && schema.type === 'object' && tabKeys.length > 0) {
    const object = isRecord(value) ? value : {}
    const baselineObject = isRecord(baseline) ? baseline : {}
    const key = tabKeys.includes(activeTab) ? activeTab : tabKeys[0]
    const child = schema.properties?.[key]
    if (!child) return null
    const present = Object.prototype.hasOwnProperty.call(object, key)
    const requiredKeys = Array.isArray(schema.required) ? schema.required : []
    const required = child.required === true || requiredKeys.includes(key)
    const tabID = (tabKey: string) => `schema-root-tab-${tabKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    const panelID = (tabKey: string) => `schema-root-panel-${tabKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    const selectAdjacentTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabKeys.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabKeys.length) % tabKeys.length
      const nextKey = tabKeys[nextIndex]
      setActiveTab(nextKey)
      document.getElementById(tabID(nextKey))?.focus()
    }
    return (
      <div className="schema-tab-layout">
        <div className="schema-root-tabs" role="tablist" aria-label={schema.title || 'Simulation parameter groups'}>
          {tabKeys.map((tabKey, index) => {
            const tabSchema = schema.properties?.[tabKey]
            const configured = Object.prototype.hasOwnProperty.call(object, tabKey)
            return (
              <button
                id={tabID(tabKey)}
                key={tabKey}
                type="button"
                role="tab"
                aria-selected={tabKey === key}
                aria-controls={panelID(tabKey)}
                tabIndex={tabKey === key ? 0 : -1}
                className={tabKey === key ? 'active' : ''}
                onClick={() => setActiveTab(tabKey)}
                onKeyDown={(event) => selectAdjacentTab(event, index)}
              >
                <span>{tabSchema?.title || humanize(tabKey)}</span>
                <small className={configured ? 'configured' : ''}>{configured ? 'Set' : 'Empty'}</small>
              </button>
            )
          })}
        </div>
        <div className="schema-root-panel" id={panelID(key)} role="tabpanel" aria-labelledby={tabID(key)}>
          <SchemaField
            schema={child}
            path={key}
            value={present ? object[key] : initialValue(child, sparse)}
            baseline={baselineObject[key]}
            sparse={sparse}
            showAll={showAll}
            configured={present}
            addLabel={addLabel}
            removeLabel={removeLabel}
            collapsibleObjects={collapsibleObjects}
            rootTabContent
            onChange={(next) => onChange({ ...object, [key]: next })}
          />
          {sparse && !required && present && (
            <button
              type="button"
              className="schema-remove-change schema-root-remove"
              onClick={() => {
                const next = { ...object }
                delete next[key]
                onChange(next)
              }}
            >
              <Trash2 size={12} /> {removeLabel === 'Remove' ? `Remove ${child.title || humanize(key)} configuration` : removeLabel}
            </button>
          )}
        </div>
      </div>
    )
  }

  return <SchemaField schema={schema} value={value} onChange={onChange} path="" sparse={sparse} showAll={showAll} configured baseline={baseline} addLabel={addLabel} removeLabel={removeLabel} collapsibleObjects={collapsibleObjects} />
}

function SchemaField({
  schema,
  value,
  onChange,
  path,
  sparse,
  showAll,
  configured,
  baseline,
  addLabel,
  removeLabel,
  collapsibleObjects,
  rootTabContent = false,
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  path: string
  sparse: boolean
  showAll: boolean
  configured: boolean
  baseline?: unknown
  addLabel: string
  removeLabel: string
  collapsibleObjects: boolean
  rootTabContent?: boolean
}) {
  const title = schema.title || humanize(path.split('.').pop() || 'Simulation parameters')
  const fieldID = `schema-${path.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`
  const [sectionOpen, setSectionOpen] = useState(path.split('.').length === 1)
  if (schema.type === 'object') {
    const object = isRecord(value) ? value : {}
    const baselineObject = isRecord(baseline) ? baseline : {}
    const requiredKeys = Array.isArray(schema.required) ? schema.required : []
    const fields = (
      <>
        {schema.description && path && !collapsibleObjects && <p>{schema.description}</p>}
        {Object.entries(schema.properties ?? {}).map(([key, child]) => {
          const childPath = path ? `${path}.${key}` : key
          const present = Object.prototype.hasOwnProperty.call(object, key)
          const required = child.required === true || requiredKeys.includes(key)
          if (sparse && !showAll && !present && !required) {
            return (
              <div className="schema-add-field" key={key}>
                <span>
                  <strong className="schema-title-with-help">
                    {child.title || humanize(key)}
                    {collapsibleObjects && <SchemaDescriptionHelp description={child.description} title={child.title || humanize(key)} />}
                  </strong>
                  {baselineObject[key] !== undefined && <small>Inherited: {compactValue(baselineObject[key])}</small>}
                  {child.description && !collapsibleObjects && <small>{child.description}</small>}
                </span>
                <button type="button" onClick={() => onChange({ ...object, [key]: initialValue(child, true) })}>
                  <Plus size={13} /> {addLabel}
                </button>
              </div>
            )
          }
          return (
            <div className="schema-edit-field" key={key}>
              <SchemaField
                schema={child}
                path={childPath}
                value={present ? object[key] : initialValue(child, sparse)}
                baseline={baselineObject[key]}
                sparse={sparse}
                showAll={showAll}
                configured={present}
                addLabel={addLabel}
                removeLabel={removeLabel}
                collapsibleObjects={collapsibleObjects}
                onChange={(next) => onChange({ ...object, [key]: next })}
              />
              {sparse && !required && present && (
                <button
                  type="button"
                  className="schema-remove-change"
                  onClick={() => {
                    const next = { ...object }
                    delete next[key]
                    onChange(next)
                  }}
                >
                  <Trash2 size={12} /> {removeLabel}
                </button>
              )}
            </div>
          )
        })}
      </>
    )
    if (rootTabContent) {
      return <div className="schema-root-object-content">{fields}</div>
    }
    if (path && collapsibleObjects) {
      return (
        <details className="schema-section" open={sectionOpen} onToggle={(event) => setSectionOpen(event.currentTarget.open)}>
          <summary>
            <span className="schema-section-title">
              <span>{title}</span>
              <SchemaDescriptionHelp description={schema.description} title={title} />
            </span>
            {showAll && !configured && <small className="schema-field-state">Not configured</small>}
            <ChevronDown size={16} />
          </summary>
          <div className="schema-section-body">{fields}</div>
        </details>
      )
    }
    return (
      <fieldset className="schema-object">
        {path && <legend>{title}{showAll && !configured && <small className="schema-field-state">Not configured</small>}</legend>}
        {fields}
      </fieldset>
    )
  }
  if (schema.type === 'quantity') {
    const object = isRecord(value) ? value : {}
    const unitOptions = schema.unit_options?.length ? schema.unit_options : [schema.unit ?? '']
    const storedUnit = String(object.units ?? schema.unit ?? '')
    const selectedUnit = canonicalQuantityUnit(schema, storedUnit)
    const unsupportedUnit = Boolean(selectedUnit) && !unitOptions.includes(selectedUnit)
    return (
      <label className="schema-field" htmlFor={fieldID}>
        <FieldLabel schema={schema} title={title} path={path} configured={configured} showAll={showAll} descriptionTooltip={collapsibleObjects} />
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
      </label>
    )
  }
  if (schema.type === 'entity_assignment') {
    return <EntityAssignmentField schema={schema} value={value} onChange={onChange} fieldID={fieldID} title={title} configured={configured} showAll={showAll} />
  }
  if (schema.type === 'field_removal') {
    const recommendation = schema.recommendation
    return (
      <fieldset className="schema-object schema-entity-assignment">
        <legend>{title}{showAll && !configured && <small className="schema-field-state">Not configured</small>}</legend>
        <div className="schema-ai-recommendation">
          <div className="schema-ai-heading">
            <span><Sparkles size={15} /><strong>Schema-safe repair</strong></span>
            <em className={`confidence-${recommendation?.confidence ?? 'high'}`}>{recommendation?.confidence ?? 'high'} confidence</em>
          </div>
          <h3>{recommendation?.title ?? 'Remove this incompatible setting'}</h3>
          <p>{recommendation?.reason ?? schema.description}</p>
          {recommendation?.evidence?.length ? (
            <details>
              <summary>Flow360 validation evidence</summary>
              <ul>{recommendation.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          ) : null}
        </div>
      </fieldset>
    )
  }
  if (schema.type === 'boolean') {
    return (
      <label className="schema-field schema-boolean">
        <input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        <FieldLabel schema={schema} title={title} path={path} configured={configured} showAll={showAll} descriptionTooltip={collapsibleObjects} />
      </label>
    )
  }
  if (schema.type === 'enum') {
    return (
      <label className="schema-field" htmlFor={fieldID}>
        <FieldLabel schema={schema} title={title} path={path} configured={configured} showAll={showAll} descriptionTooltip={collapsibleObjects} />
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
    const itemSchema = schema.items ?? { type: 'json' as const }
    const arrayEditor = (
      <>
        <div className="schema-array-toolbar">
          <span>
            <strong>{array.length ? `${array.length} item${array.length === 1 ? '' : 's'}` : 'No items yet'}</strong>
            {rootTabContent && <SchemaDescriptionHelp description={schema.description} title={title} />}
          </span>
          <button type="button" className="schema-array-add" onClick={() => onChange([...array, initialValue(itemSchema, sparse)])}>
            <Plus size={14} /> Add item
          </button>
        </div>
        {array.length === 0 ? (
          <div className="schema-array-empty">
            <strong>This list is empty</strong>
            <span>Add an item to configure this parameter group.</span>
          </div>
        ) : (
          <div className="schema-array-list">
            {array.map((item, index) => (
              <section className="schema-array-card" key={index}>
                <header>
                  <span>Item {index + 1}</span>
                  <button type="button" className="schema-array-remove" onClick={() => onChange(array.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${title} item ${index + 1}`}>
                    <Trash2 size={13} /> Remove
                  </button>
                </header>
                <div className="schema-array-card-body">
                  <SchemaField
                    schema={itemSchema.title ? itemSchema : { ...itemSchema, title: 'Value' }}
                    path={`${path}.${index}`}
                    value={item}
                    sparse={sparse}
                    showAll={showAll}
                    configured
                    addLabel={addLabel}
                    removeLabel={removeLabel}
                    collapsibleObjects={collapsibleObjects}
                    rootTabContent={itemSchema.type === 'object'}
                    onChange={(next) => onChange(array.map((entry, itemIndex) => itemIndex === index ? next : entry))}
                  />
                </div>
              </section>
            ))}
          </div>
        )}
      </>
    )
    if (rootTabContent) {
      return <div className="schema-array-editor schema-root-array">{arrayEditor}</div>
    }
    return (
      <fieldset className="schema-object schema-array schema-array-editor">
        <legend>
          <span className="schema-legend-content">
            {title}
            {collapsibleObjects && <SchemaDescriptionHelp description={schema.description} title={title} />}
            {showAll && !configured && <small className="schema-field-state">Not configured</small>}
          </span>
        </legend>
        {schema.description && !collapsibleObjects && <p>{schema.description}</p>}
        {arrayEditor}
      </fieldset>
    )
  }
  if (schema.type === 'union') {
    const draft = isUnionDraft(value) ? value : { variant: 0, value: initialValue(schema.variants?.[0] ?? { type: 'json' }, sparse) }
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
              onChange({ variant, value: initialValue(schema.variants?.[variant] ?? { type: 'json' }, sparse) })
            }}
          >
            {(schema.variants ?? []).map((variant, index) => (
              <option value={index} key={index}>{variant.title || humanize(variant.type)}</option>
            ))}
          </select>
        </label>
        <SchemaField schema={selected} value={draft.value} path={`${path}.value`} sparse={sparse} showAll={showAll} configured={configured} addLabel={addLabel} removeLabel={removeLabel} collapsibleObjects={collapsibleObjects} onChange={(next) => onChange({ ...draft, value: next })} />
      </fieldset>
    )
  }
  if (schema.type === 'json') {
    return (
      <label className="schema-field" htmlFor={fieldID}>
        <FieldLabel schema={schema} title={title} path={path} configured={configured} showAll={showAll} descriptionTooltip={collapsibleObjects} />
        <textarea id={fieldID} className="plan-code-input" value={String(value ?? '{}')} onChange={(event) => onChange(event.target.value)} />
      </label>
    )
  }
  return (
    <label className="schema-field" htmlFor={fieldID}>
      <FieldLabel schema={schema} title={title} path={path} configured={configured} showAll={showAll} descriptionTooltip={collapsibleObjects} />
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
  configured,
  showAll,
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  fieldID: string
  title: string
  configured: boolean
  showAll: boolean
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
      <legend>{title}{showAll && !configured && <small className="schema-field-state">Not configured</small>}</legend>
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

function FieldLabel({
  schema,
  title,
  path,
  configured = true,
  showAll = false,
  descriptionTooltip = false,
}: {
  schema: DynamicFormSchema
  title: string
  path: string
  configured?: boolean
  showAll?: boolean
  descriptionTooltip?: boolean
}) {
  return (
    <span className="schema-field-label">
      <strong>
        {title}{schema.required === true ? ' *' : ''}
        {descriptionTooltip && <SchemaDescriptionHelp description={schema.description} title={title} />}
        {showAll && !configured && <small className="schema-field-state">Not configured</small>}
      </strong>
      <code>{path}</code>
      {schema.description && !descriptionTooltip && <small>{schema.description}</small>}
    </span>
  )
}

function SchemaDescriptionHelp({ description, title }: { description?: string; title: string }) {
  const help = cleanSchemaDescription(description)
  if (!help) return null
  return (
    <HelpTooltip label={`About ${title}`} placement="bottom" align="start">
      {help}
    </HelpTooltip>
  )
}

export function cleanSchemaDescription(description?: string): string {
  if (!description) return ''
  const readable = description
    .replace(/:(?:ref|class|meth|attr):`([^`<]+?)(?:\s*<[^>]+>)?`/gi, '$1')
    .replace(/`([^`<]+?)\s*<[^>]+>`/g, '$1')
    .replace(/\s+See\s+(?:also\s+)?(?:ref(?:erence)?s?|details?)\s*:?.*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim()
  return readable || description.replace(/\s+/g, ' ').trim()
}

export function initialValue(schema: DynamicFormSchema, sparse = false): unknown {
  if (schema.default !== undefined && schema.default !== null) return schema.default
  switch (schema.type) {
    case 'object': {
      const requiredKeys = Array.isArray(schema.required) ? schema.required : []
      return Object.fromEntries(
        Object.entries(schema.properties ?? {})
          .filter(([key, child]) => !sparse || child.required === true || requiredKeys.includes(key))
          .map(([key, child]) => [key, initialValue(child, sparse)]),
      )
    }
    case 'array':
      return []
    case 'quantity':
      return { value: '', units: schema.unit ?? '' }
    case 'entity_assignment':
      return {
        model: schema.default_model ?? schema.model_choices?.[0]?.value ?? '',
        entities: schema.default_entities ?? [],
      }
    case 'field_removal':
      return null
    case 'boolean':
      return false
    case 'enum':
      return schema.options?.[0]
    case 'union':
      return { variant: 0, value: initialValue(schema.variants?.[0] ?? { type: 'json' }, sparse) }
    case 'json':
      return '{}'
    default:
      return ''
  }
}

// Convert canonical Flow360 JSON into the UI draft shape used by SchemaField.
// Most values are already compatible; unions and free-form JSON fields need a
// small wrapper so an existing Draft can be edited without losing its value.
export function hydrateSchemaValue(schema: DynamicFormSchema, value: unknown, sparse = false): unknown {
  if (value === undefined) return initialValue(schema, sparse)
  switch (schema.type) {
    case 'object': {
      if (!isRecord(value)) return initialValue(schema, sparse)
      const hydrated: Record<string, unknown> = { ...value }
      for (const [key, child] of Object.entries(schema.properties ?? {})) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          hydrated[key] = hydrateSchemaValue(child, value[key], sparse)
        }
      }
      return hydrated
    }
    case 'array':
      return Array.isArray(value)
        ? value.map((item) => hydrateSchemaValue(schema.items ?? { type: 'json' }, item, sparse))
        : initialValue(schema, sparse)
    case 'union': {
      const variants = schema.variants ?? []
      const variant = Math.max(0, variants.findIndex((candidate) => schemaValueMatches(candidate, value)))
      return { variant, value: hydrateSchemaValue(variants[variant] ?? { type: 'json' }, value, sparse) }
    }
    case 'json':
      return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    default:
      return value
  }
}

export function serializeValue(schema: DynamicFormSchema, value: unknown, sparse = false): unknown {
  switch (schema.type) {
    case 'object': {
      const object = isRecord(value) ? value : {}
      if (sparse) {
        return Object.fromEntries(
          Object.entries(object)
            .filter(([key]) => Boolean(schema.properties?.[key]))
            .map(([key, childValue]) => [key, serializeValue(schema.properties![key], childValue, true)]),
        )
      }
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, child]) => [key, serializeValue(child, object[key], false)]),
      )
    }
    case 'array':
      return (Array.isArray(value) ? value : []).map((item) => serializeValue(schema.items ?? { type: 'json' }, item, sparse))
    case 'quantity': {
      const object = isRecord(value) ? value : {}
      const numeric = Number(object.value)
      if (!Number.isFinite(numeric)) throw new Error(`${schema.title || schema.path || 'Quantity'} requires a numeric value.`)
      const units = canonicalQuantityUnit(schema, String(object.units ?? schema.unit ?? '').trim())
      if (!units) throw new Error(`${schema.title || schema.path || 'Quantity'} requires a unit.`)
      if (schema.unit_options?.length && !schema.unit_options.includes(units)) {
        throw new Error(`${schema.title || schema.path || 'Quantity'} has an unsupported stored unit.`)
      }
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
    case 'field_removal':
      return null
    case 'number':
    case 'integer': {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) throw new Error(`${schema.title || schema.path || 'Field'} requires a number.`)
      if (schema.type === 'integer' && !Number.isInteger(numeric)) throw new Error(`${schema.title || schema.path || 'Field'} requires an integer.`)
      return numeric
    }
    case 'union': {
      const draft = isUnionDraft(value) ? value : { variant: 0, value }
      return serializeValue(schema.variants?.[draft.variant] ?? { type: 'json' }, draft.value, sparse)
    }
    case 'json':
      if (typeof value !== 'string') return value
      return JSON.parse(value)
    default:
      return value
  }
}

function canonicalQuantityUnit(schema: DynamicFormSchema, unit: string) {
  return schema.unit_aliases?.[unit] ?? unit
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

function schemaValueMatches(schema: DynamicFormSchema, value: unknown): boolean {
  switch (schema.type) {
    case 'quantity':
      return isRecord(value) && 'value' in value && 'units' in value
    case 'object':
    case 'entity_assignment':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'string':
      return typeof value === 'string'
    case 'enum':
      return (schema.options ?? []).some((option) => JSON.stringify(option) === JSON.stringify(value))
    default:
      return false
  }
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function compactValue(value: unknown) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (isRecord(value)) {
    if ('value' in value) return `${String(value.value)}${value.units ? ` ${String(value.units)}` : ''}`
    return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`
  }
  return String(value)
}
