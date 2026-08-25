import { createContext, FormEvent, KeyboardEvent, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, CheckCircle2, ChevronDown, Code2, Edit3, ListFilter, Plus, RefreshCw, Search, Sparkles, Trash2, X } from 'lucide-react'
import type { DynamicFormSchema } from '../api/client'
import { currentLanguage } from '../i18n'
import { translate } from '../i18n/translations'
import { schemaContainsRecommendation, schemaRequiresUserInput } from '../lib/planPresentation'
import { useFocusTrap } from '../lib/useFocusTrap'
import HelpTooltip from './HelpTooltip'
import EntityListField from './schema-fields/EntityListField'
import MultiSelectField from './schema-fields/MultiSelectField'
import NegativeOneOrPositiveIntegerField from './schema-fields/NegativeOneOrPositiveIntegerField'
import QuantityField from './schema-fields/QuantityField'
import UnionVariantPicker from './schema-fields/UnionVariantPicker'
import { FieldShell, InputField, ToggleField, type FieldControlProps, type FieldMessage } from './InputField'

type SchemaFormDialogProps = {
  schema: DynamicFormSchema
  issues: Array<{ path?: string; message: string; stages?: string[] }>
  submitting: boolean
  onCancel: () => void
  onSubmit: (values: Record<string, unknown>) => void
  initialValues?: Record<string, unknown>
  sparse?: boolean
}

type UnionDraft = { variant: number; value: unknown; values?: unknown[] }

export type ExpressionValidationResult = { valid: boolean; message?: string }
export type ExpressionValidator = (path: string) => Promise<ExpressionValidationResult>

type SchemaFormFieldsProps = {
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
  expressionValidator?: ExpressionValidator
  issues?: Array<{ path?: string; message: string; level?: 'error' | 'warning' }>
  focusIssuePath?: string
  focusIssueRequest?: number
}

const ExpressionValidationContext = createContext<ExpressionValidator | undefined>(undefined)
const FieldIssueContext = createContext<SchemaFormFieldsProps['issues']>([])

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

export function SchemaFormFields(props: SchemaFormFieldsProps) {
  return (
    <FieldIssueContext.Provider value={props.issues ?? []}>
      <ExpressionValidationContext.Provider value={props.expressionValidator}>
        <SchemaFormFieldsContent {...props} />
      </ExpressionValidationContext.Provider>
    </FieldIssueContext.Provider>
  )
}

function SchemaFormFieldsContent({
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
  focusIssuePath,
  focusIssueRequest,
}: SchemaFormFieldsProps) {
  const issues = useContext(FieldIssueContext)
  const tabKeys = useMemo(() => rootTabs && schema.type === 'object' ? Object.keys(schema.properties ?? {}) : [], [rootTabs, schema])
  const focusedTab = rootTabForIssuePath(focusIssuePath, tabKeys)
  const [activeTab, setActiveTab] = useState(focusedTab ?? tabKeys[0] ?? '')
  const handledFocusKeyRef = useRef('')

  useEffect(() => {
    if (!tabKeys.includes(activeTab)) setActiveTab(tabKeys[0] ?? '')
  }, [activeTab, tabKeys])

  useEffect(() => {
    const focusKey = focusIssuePath ? `${focusIssueRequest ?? ''}:${focusIssuePath}` : ''
    if (!focusedTab || !focusKey || handledFocusKeyRef.current === focusKey) return
    handledFocusKeyRef.current = focusKey
    setActiveTab(focusedTab)
  }, [focusIssuePath, focusIssueRequest, focusedTab])

  useEffect(() => {
    if (!focusIssuePath || !focusedTab || activeTab !== focusedTab || typeof document === 'undefined') return
    const frame = window.requestAnimationFrame(() => {
      const path = normalizeIssuePath(focusIssuePath)
      const segments = path.split('.')
      let target: HTMLElement | null = null
      while (segments.length > 0 && !target) {
        target = document.getElementById(schemaFieldID(segments.join('.')))
        segments.pop()
      }
      if (!target) target = document.getElementById(`schema-root-tab-${focusedTab.replace(/[^a-zA-Z0-9_-]/g, '-')}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, focusIssuePath, focusIssueRequest, focusedTab])

  if (rootTabs && schema.type === 'object' && tabKeys.length > 0) {
    const object = isRecord(value) ? value : {}
    const baselineObject = isRecord(baseline) ? baseline : {}
    const key = tabKeys.includes(activeTab) ? activeTab : tabKeys[0]
    const child = schema.properties?.[key]
    if (!child) return null
    const present = Object.prototype.hasOwnProperty.call(object, key) && isConfiguredValue(object[key])
    const tabID = (tabKey: string) => `schema-root-tab-${tabKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    const panelID = (tabKey: string) => `schema-root-panel-${tabKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    const selectAdjacentTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabKeys.length - 1
          : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + tabKeys.length) % tabKeys.length
      const nextKey = tabKeys[nextIndex]
      setActiveTab(nextKey)
      document.getElementById(tabID(nextKey))?.focus()
    }
    return (
      <div className="schema-tab-layout">
        <label className="schema-root-select">
          <span>{localizeSchemaText('Parameter group')}</span>
          <select value={key} onChange={(event) => setActiveTab(event.target.value)}>
            {tabKeys.map((tabKey) => {
              const tabSchema = schema.properties?.[tabKey]
              const stats = schemaGroupStats(tabSchema, object[tabKey], baselineObject[tabKey], issues, tabKey)
              const statsLabel = groupStatsLabel(stats)
              return <option value={tabKey} key={tabKey}>{localizeSchemaText(tabSchema?.title || humanize(tabKey))}{statsLabel ? ` · ${statsLabel}` : ''}</option>
            })}
          </select>
        </label>
        <div className="schema-root-tabs" role="tablist" aria-label={schema.title || 'Simulation parameter groups'}>
          {tabKeys.map((tabKey, index) => {
            const tabSchema = schema.properties?.[tabKey]
            const invalid = issues?.some((issue) => issue.level !== 'warning' && issueMatchesPath(issue.path, tabKey))
            const stats = schemaGroupStats(tabSchema, object[tabKey], baselineObject[tabKey], issues, tabKey)
            const showStats = stats.modified > 0 || stats.errors > 0 || stats.warnings > 0
            return (
              <button
                id={tabID(tabKey)}
                key={tabKey}
                type="button"
                role="tab"
                aria-selected={tabKey === key}
                aria-controls={panelID(tabKey)}
                tabIndex={tabKey === key ? 0 : -1}
                className={`${tabKey === key ? 'active' : ''}${invalid ? ' invalid' : ''}`.trim()}
                onClick={() => setActiveTab(tabKey)}
                onKeyDown={(event) => selectAdjacentTab(event, index)}
              >
                <span>{localizeSchemaText(tabSchema?.title || humanize(tabKey))}</span>
                {showStats && <span className="schema-root-tab-stats">
                  {stats.modified > 0 && <small className="modified" title={localizeSchemaText('Modified fields')}>{stats.modified} {localizeSchemaText('changed')}</small>}
                  {stats.errors > 0 && <small className="invalid" title={localizeSchemaText('Validation errors')}>{stats.errors} {localizeSchemaText('errors')}</small>}
                  {stats.warnings > 0 && <small className="warning" title={localizeSchemaText('Validation warnings')}>{stats.warnings} {localizeSchemaText('warnings')}</small>}
                </span>}
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
        </div>
      </div>
    )
  }

  return <SchemaField schema={schema} value={value} onChange={onChange} path="" sparse={sparse} showAll={showAll} configured baseline={baseline} addLabel={addLabel} removeLabel={removeLabel} collapsibleObjects={collapsibleObjects} />
}

export type SchemaGroupStats = { unconfigured: number; modified: number; errors: number; warnings: number }

export function schemaGroupStats(
  schema: DynamicFormSchema | undefined,
  value: unknown,
  baseline: unknown,
  issues: SchemaFormFieldsProps['issues'],
  rootPath: string,
): SchemaGroupStats {
  const leafEntries = (node: DynamicFormSchema | undefined, current: unknown, original: unknown): Array<{ configured: boolean; modified: boolean }> => {
    if (!node) return []
    if (node.type === 'object') {
      const currentObject = isRecord(current) ? current : {}
      const baselineObject = isRecord(original) ? original : {}
      return Object.entries(node.properties ?? {}).flatMap(([key, child]) => leafEntries(child, currentObject[key], baselineObject[key]))
    }
    return [{ configured: isConfiguredValue(current), modified: JSON.stringify(current) !== JSON.stringify(original) }]
  }
  const leaves = leafEntries(schema, value, baseline)
  return {
    unconfigured: leaves.filter((leaf) => !leaf.configured).length,
    modified: leaves.filter((leaf) => leaf.modified).length,
    errors: issues?.filter((issue) => issue.level !== 'warning' && issueMatchesPath(issue.path, rootPath)).length ?? 0,
    warnings: issues?.filter((issue) => issue.level === 'warning' && issueMatchesPath(issue.path, rootPath)).length ?? 0,
  }
}

function groupStatsLabel(stats: SchemaGroupStats) {
  const labels: string[] = []
  if (stats.modified) labels.push(`${stats.modified} ${localizeSchemaText('changed')}`)
  if (stats.errors) labels.push(`${stats.errors} ${localizeSchemaText('errors')}`)
  if (stats.warnings) labels.push(`${stats.warnings} ${localizeSchemaText('warnings')}`)
  return labels.join(', ')
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
  embeddedObjectContent = false,
  visibleObjectKeys,
  compactUnion = false,
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
  embeddedObjectContent?: boolean
  visibleObjectKeys?: Set<string>
  compactUnion?: boolean
}) {
  const issues = useContext(FieldIssueContext)
  const title = schema.title || humanize(path.split('.').pop() || 'Simulation parameters')
  const displayTitle = formatSchemaLabel(title)
  const fieldID = schemaFieldID(path)
  const fieldIssues = issues?.filter((issue) => issue.level !== 'warning' && issueMatchesPath(issue.path, path, true)) ?? []
  const fieldMessages: FieldMessage[] = (issues?.filter((issue) => issueMatchesPath(issue.path, path, true)) ?? [])
    .map((issue, index) => ({ key: `${issue.path}-${index}`, level: issue.level ?? 'error', message: issue.message }))
  const branchIssues = issues?.filter((issue) => issue.level !== 'warning' && issueMatchesPath(issue.path, path)) ?? []
  const branchMessages: FieldMessage[] = (issues?.filter((issue) => issueMatchesPath(issue.path, path)) ?? [])
    .map((issue, index) => ({ key: `${issue.path}-${index}`, level: issue.level ?? 'error', message: issue.message }))
  const branchInvalid = Boolean(path) && issues?.some((issue) => issue.level !== 'warning' && issueMatchesPath(issue.path, path))
  const disabled = schema.disabled === true || schema.readOnly === true
  const [sectionOpen, setSectionOpen] = useState(path.split('.').length === 1)
  const quantityObject = quantityLikeObjectSchema(schema, value)
  if (quantityObject) {
    return <QuantityField
      schema={quantityObject}
      value={value}
      onChange={onChange}
      title={displayTitle}
      fieldID={fieldID}
      path={collapsibleObjects ? undefined : path}
      help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined}
      description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined}
      status={configurationStatus(schema, configured, showAll)}
      hideLabel={rootTabContent}
      fieldIssues={fieldIssues}
      messages={fieldMessages}
      canonicalUnit={canonicalQuantityUnit}
      numberConstraint={numberConstraint}
    />
  }
  const nullableChild = nullableSingleProperty(schema)
  if (nullableChild) {
    const [childKey, childSchema] = nullableChild
    const object = isRecord(value) ? value : {}
    const childValue = Object.prototype.hasOwnProperty.call(object, childKey) ? object[childKey] : initialValue(childSchema, true)
    return <div className="schema-nullable-object">
      <ToggleField
        id={fieldID}
        className="schema-field schema-nullable-object-toggle"
        label={displayTitle}
        checked={configured}
        onChange={(enabled) => onChange(enabled ? initialValue(schema, true) : null)}
        checkedLabel={localizeSchemaText('Enabled')}
        uncheckedLabel={localizeSchemaText('Disabled')}
        disabled={disabled}
        status={configurationStatus(schema, configured, showAll)}
        help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined}
        description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined}
        hideLabel={rootTabContent}
        messages={fieldMessages}
      />
      {configured && <SchemaField
        schema={childSchema}
        value={childValue}
        onChange={(next) => onChange({ ...object, [childKey]: next })}
        path={`${path}.${childKey}`}
        sparse={sparse}
        showAll={showAll}
        configured={isConfiguredValue(childValue)}
        addLabel={addLabel}
        removeLabel={removeLabel}
        collapsibleObjects={collapsibleObjects}
      />}
    </div>
  }
  if (schema.type === 'object') {
    const object = isRecord(value) ? value : {}
    const baselineObject = isRecord(baseline) ? baseline : {}
    const requiredKeys = Array.isArray(schema.required) ? schema.required : []
    const fields = (
      <>
        {schema.description && path && !collapsibleObjects && !embeddedObjectContent && <p>{localizedSchemaDescription(schema.description)}</p>}
        {Object.entries(schema.properties ?? {}).filter(([key, child]) => !isDiscriminatorDefault(key, child) && (!visibleObjectKeys || visibleObjectKeys.has(key))).map(([key, child]) => {
          const childPath = path ? `${path}.${key}` : key
          const present = Object.prototype.hasOwnProperty.call(object, key) && isConfiguredValue(object[key])
          const required = child.required === true || requiredKeys.includes(key)
          if (sparse && !showAll && !present && !required) {
            return (
              <div className="schema-add-field" key={key}>
                <span>
                  <strong className="schema-title-with-help">
                    {localizeSchemaText(child.title || humanize(key))}
                    {collapsibleObjects && <SchemaDescriptionHelp description={child.description} title={child.title || humanize(key)} />}
                  </strong>
                  {baselineObject[key] !== undefined && <small>Inherited: {compactValue(baselineObject[key])}</small>}
                  {child.description && !collapsibleObjects && <small>{localizedSchemaDescription(child.description)}</small>}
                </span>
                <button type="button" onClick={() => onChange({ ...object, [key]: initialValue(child, true) })}>
                  <Plus size={13} /> {addLabel}
                </button>
              </div>
            )
          }
          const directRootControl = rootTabContent && collapsibleObjects && isSingleControlRootSchema(child)
          const editor = (
            <div className={`schema-edit-field schema-edit-field-${child.type} schema-field-key-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`} key={key}>
              <SchemaField
                schema={required && child.required !== true ? { ...child, required: true } : child}
                path={childPath}
                value={present ? object[key] : initialValue(child, sparse)}
                baseline={baselineObject[key]}
                sparse={sparse}
                showAll={showAll}
                configured={present}
                addLabel={addLabel}
                removeLabel={removeLabel}
                collapsibleObjects={collapsibleObjects}
                rootTabContent={rootTabContent && child.type !== 'object' && !directRootControl}
                embeddedObjectContent={rootTabContent && child.type === 'object'}
                onChange={(next) => onChange({ ...object, [key]: next })}
              />
            </div>
          )
          if (rootTabContent && collapsibleObjects && !directRootControl) {
            const invalid = issues?.some((issue) => issue.level !== 'warning' && issueMatchesPath(issue.path, childPath)) ?? false
            const childTitle = child.title || humanize(key)
            return (
              <RootFieldSection
                key={key}
                title={childTitle}
                description={child.description}
                configured={present}
                defaulted={hasExplicitDefault(child)}
                showAll={showAll}
                invalid={invalid}
              >
                {editor}
              </RootFieldSection>
            )
          }
          return editor
        })}
      </>
    )
    if (rootTabContent || embeddedObjectContent) {
      return <div className="schema-root-object-content">{fields}</div>
    }
    if (path && collapsibleObjects) {
      return (
        <details className={`schema-section${branchInvalid ? ' schema-invalid' : ''}`} open={sectionOpen || branchInvalid} onToggle={(event) => setSectionOpen(event.currentTarget.open)}>
          <summary>
            <span className="schema-section-title">
              <span>{displayTitle}</span>
              <SchemaDescriptionHelp description={schema.description} title={title} />
            </span>
            {configurationStatus(schema, configured, showAll) && <small className="schema-field-state">{configurationStatus(schema, configured, showAll)}</small>}
            <ChevronDown size={16} />
          </summary>
          <div className="schema-section-body">{fields}</div>
        </details>
      )
    }
    return (
      <fieldset className={`schema-object${branchInvalid ? ' schema-invalid' : ''}`}>
        {path && <legend>{displayTitle}{configurationStatus(schema, configured, showAll) && <small className="schema-field-state">{configurationStatus(schema, configured, showAll)}</small>}</legend>}
        {fields}
      </fieldset>
    )
  }
  if (schema.type === 'quantity') {
    return (
      <QuantityField
        schema={schema}
        value={value}
        onChange={onChange}
        title={displayTitle}
        fieldID={fieldID}
        path={collapsibleObjects ? undefined : path}
        help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined}
        description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined}
        status={configurationStatus(schema, configured, showAll)}
        hideLabel={rootTabContent}
        fieldIssues={fieldIssues}
        messages={fieldMessages}
        canonicalUnit={canonicalQuantityUnit}
        numberConstraint={numberConstraint}
      />
    )
  }
  if (schema.type === 'expression') {
    return <ExpressionField schema={schema} value={value} onChange={onChange} path={path} title={displayTitle} sectionContent={rootTabContent} configured={configured} showAll={showAll} messages={fieldMessages} />
  }
  if (schema.type === 'entity_assignment') {
    return <EntityAssignmentField schema={schema} value={value} onChange={onChange} fieldID={fieldID} title={displayTitle} configured={configured} showAll={showAll} fieldIssues={fieldIssues} messages={fieldMessages} />
  }
  if (schema.type === 'field_removal') {
    const recommendation = schema.recommendation
    return (
      <fieldset id={fieldID} tabIndex={fieldIssues.length ? -1 : undefined} className={`schema-object schema-entity-assignment${fieldIssues.length ? ' schema-invalid' : ''}`}>
        <legend>{displayTitle}{configurationStatus(schema, configured, showAll) && <small className="schema-field-state">{configurationStatus(schema, configured, showAll)}</small>}</legend>
        <div className="schema-ai-recommendation">
          <div className="schema-ai-heading">
            <span><Sparkles size={15} /><strong>Schema-safe repair</strong></span>
            <em className={`confidence-${recommendation?.confidence ?? 'high'}`}>{recommendation?.confidence ?? 'high'} confidence</em>
          </div>
          <h3>{recommendation?.title ?? 'Remove this incompatible setting'}</h3>
          <p>{localizeSchemaText(recommendation?.reason ?? schema.description ?? '')}</p>
          {recommendation?.evidence?.length ? (
            <details>
              <summary>Flow360 validation evidence</summary>
              <ul>{recommendation.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          ) : null}
        </div>
        <SchemaInlineIssues issues={fieldIssues} />
      </fieldset>
    )
  }
  if (schema.type === 'boolean') {
    return (
      <ToggleField
        id={fieldID}
        className="schema-field schema-boolean"
        label={displayTitle}
        path={collapsibleObjects ? undefined : path}
        checked={Boolean(value)}
        onChange={onChange}
        disabled={disabled}
        required={schema.required === true}
        status={configurationStatus(schema, configured, showAll)}
        help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined}
        description={!collapsibleObjects ? schema.description : undefined}
        hideLabel={rootTabContent}
        messages={fieldMessages}
      />
    )
  }
  if (schema.type === 'enum') {
    return (
      <InputField id={fieldID} className="schema-field" label={displayTitle} path={collapsibleObjects ? undefined : path} required={schema.required === true} disabled={disabled} status={configurationStatus(schema, configured, showAll)} help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined} description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined} hideLabel={rootTabContent} messages={fieldMessages}>
        <select id={fieldID} value={JSON.stringify(value)} onChange={(event) => onChange(JSON.parse(event.target.value))}>
          {(schema.options ?? []).map((option) => (
            <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>
          ))}
        </select>
      </InputField>
    )
  }
  if (schema.type === 'multi_select') {
    return <MultiSelectField schema={schema} value={value} onChange={onChange} title={displayTitle} fieldID={fieldID} configured={configured} showAll={showAll} status={configurationStatus(schema, configured, showAll)} fieldIssues={fieldIssues} messages={fieldMessages} />
  }
  if (schema.type === 'array') {
    if (isComplexArrayItem(schema.items)) {
      return <ComplexArrayField schema={schema} value={value} onChange={onChange} path={path} addLabel={addLabel} removeLabel={removeLabel} collapsibleObjects={collapsibleObjects} rootTabContent={rootTabContent} configured={configured} showAll={showAll} messages={branchMessages} />
    }
    const array = Array.isArray(value) ? value : []
    const itemSchema = schema.items ?? { type: 'json' as const }
    const editableItemSchema = disabled ? { ...itemSchema, disabled: true } : itemSchema
    const arrayEditor = (controlProps: FieldControlProps) => (
      <div id={controlProps.id} role="group" aria-label={controlProps['aria-label']} aria-required={controlProps['aria-required']} aria-describedby={controlProps['aria-describedby']} aria-invalid={controlProps['aria-invalid']} aria-errormessage={controlProps['aria-errormessage']}>
        <div className="schema-array-toolbar">
          <span>
            <strong>{array.length ? `${array.length} item${array.length === 1 ? '' : 's'}` : 'No items yet'}</strong>
            {rootTabContent && <SchemaDescriptionHelp description={schema.description} title={title} />}
          </span>
          <button type="button" disabled={disabled} className="schema-array-add" onClick={() => onChange([...array, initialValue(itemSchema, sparse)])}>
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
                  <button type="button" disabled={disabled} className="schema-array-remove" onClick={() => onChange(array.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${title} item ${index + 1}`}>
                    <Trash2 size={13} /> Remove
                  </button>
                </header>
                <div className="schema-array-card-body">
                  <SchemaField
                    schema={editableItemSchema.title ? editableItemSchema : { ...editableItemSchema, title: 'Value' }}
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
      </div>
    )
    return (
      <FieldShell
        id={fieldID}
        label={displayTitle}
        required={schema.required === true}
        disabled={disabled}
        help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined}
        description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined}
        status={configurationStatus(schema, configured, showAll)}
        hideLabel={rootTabContent}
        messages={fieldMessages}
        className={`${rootTabContent ? 'schema-root-array' : 'schema-object schema-array'} schema-array-editor${fieldIssues.length ? ' schema-field-invalid' : ''}`}
      >
        {arrayEditor}
      </FieldShell>
    )
  }
  if (schema.type === 'entity_list') {
    return <EntityListField schema={schema} value={value} onChange={onChange} title={displayTitle} fieldID={fieldID} descriptionHelp={<SchemaDescriptionHelp description={schema.description} title={title} />} invalid={fieldIssues.length > 0} configured={configured} showAll={showAll} status={configurationStatus(schema, configured, showAll)} messages={fieldMessages} />
  }
  if (schema.type === 'union') {
    const draft = isUnionDraft(value) ? value : { variant: 0, value: initialValue(schema.variants?.[0] ?? { type: 'json' }, sparse) }
    const enumArray = enumArrayUnion(schema)
    if (enumArray) {
      const selected = normalizeEnumArrayUnionValue(draft.value, enumArray.options)
      return <MultiSelectField
        schema={{
          ...schema,
          type: 'multi_select',
          options: enumArray.options,
          value_key: 'items',
          // Pydantic applies list `min_length` to the union wrapper in this
          // schema shape, where the dynamic projection exposes it as minLength.
          minItems: enumArray.schema.minItems ?? schema.minItems ?? schema.minLength,
          maxItems: enumArray.schema.maxItems ?? schema.maxItems ?? schema.maxLength,
        }}
        value={{ items: selected }}
        title={displayTitle}
        fieldID={fieldID}
        configured={configured}
        showAll={showAll}
        fieldIssues={fieldIssues}
        messages={fieldMessages}
        onChange={(next) => {
          const items = isRecord(next) && Array.isArray(next.items) ? next.items : []
          const values = [...(draft.values ?? [])]
          values[draft.variant] = draft.value
          values[enumArray.variant] = items
          onChange({ variant: enumArray.variant, value: items, values })
        }}
      />
    }
    const negativeOneOrPositive = negativeOneOrPositiveIntegerUnion(schema)
    if (negativeOneOrPositive) {
      return <NegativeOneOrPositiveIntegerField
        draft={draft}
        integerVariant={negativeOneOrPositive.integerVariant}
        sentinelVariant={negativeOneOrPositive.sentinelVariant}
        fieldID={fieldID}
        title={displayTitle}
        path={collapsibleObjects ? undefined : path}
        help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined}
        description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined}
        status={configurationStatus(schema, configured, showAll)}
        required={schema.required === true}
        disabled={disabled}
        fieldIssues={fieldIssues}
        messages={fieldMessages}
        onChange={onChange}
      />
    }
    const selected = schema.variants?.[draft.variant] ?? { type: 'json' as const }
    const variants = schema.variants ?? []
    const expressionVariant = variants.findIndex((variant) => variant.type === 'expression')
    const valueVariant = variants.findIndex((variant) => ['quantity', 'number', 'integer'].includes(variant.type))
    const valueOrExpression = expressionVariant >= 0 && valueVariant >= 0 && variants.length === 2
    const selectVariant = (variant: number) => {
      const values = [...(draft.values ?? [])]
      values[draft.variant] = draft.value
      onChange({
        variant,
        value: values[variant] ?? initialValue(variants[variant] ?? { type: 'json' }, sparse),
        values,
      })
    }
    const selectedSchema = disabled ? { ...selected, disabled: true } : selected
    const compactValueProperty = singleValueProperty(selected)
    const selectedObject = isRecord(draft.value) ? draft.value : {}
    const selectedEditor = compactValueProperty
      ? <SchemaField
          schema={disabled ? { ...compactValueProperty[1], disabled: true } : compactValueProperty[1]}
          value={selectedObject[compactValueProperty[0]]}
          path={`${path}.${compactValueProperty[0]}`}
          sparse={sparse}
          showAll={showAll}
          configured={isConfiguredValue(selectedObject[compactValueProperty[0]])}
          addLabel={addLabel}
          removeLabel={removeLabel}
          collapsibleObjects={collapsibleObjects}
          rootTabContent
          compactUnion
          onChange={(next) => onChange({ ...draft, value: { ...selectedObject, [compactValueProperty[0]]: next } })}
        />
      : selected.type === 'expression' && valueOrExpression
      ? <ExpressionField schema={selectedSchema} value={draft.value} path={path} title={title} embedded onChange={(next) => onChange({ ...draft, value: next })} />
      : <SchemaField schema={selectedSchema} value={draft.value} path={path} sparse={sparse} showAll={showAll} configured={configured} addLabel={addLabel} removeLabel={removeLabel} collapsibleObjects={collapsibleObjects} rootTabContent onChange={(next) => onChange({ ...draft, value: next })} />
    const unionEditor = (controlProps: FieldControlProps) => (
      <>
        {compactUnion ? null : valueOrExpression ? (
          <div id={controlProps.id} className="schema-value-kind" role="group" aria-label={`${title} value type`} aria-required={controlProps['aria-required']} aria-describedby={controlProps['aria-describedby']} aria-invalid={controlProps['aria-invalid']}>
            <button type="button" disabled={disabled} className={draft.variant === valueVariant ? 'active' : ''} aria-pressed={draft.variant === valueVariant} onClick={() => selectVariant(valueVariant)}>Fixed value</button>
            <button type="button" disabled={disabled} className={draft.variant === expressionVariant ? 'active' : ''} aria-pressed={draft.variant === expressionVariant} onClick={() => selectVariant(expressionVariant)}><Code2 size={13} /> Expression</button>
          </div>
        ) : (
          <UnionVariantPicker id={controlProps.id} title={title} variants={variants} selected={draft.variant} onSelect={selectVariant} disabled={disabled} describedBy={controlProps['aria-describedby']} invalid={Boolean(controlProps['aria-invalid'])} required={Boolean(controlProps['aria-required'])} />
        )}
        <div className={valueOrExpression ? 'schema-value-or-expression-editor' : ''}>{selectedEditor}</div>
      </>
    )
    return (
      <FieldShell
        id={`${fieldID}-variant`}
        label={localizeSchemaText(title)}
        path={collapsibleObjects ? undefined : path}
        required={schema.required === true}
        disabled={disabled}
        help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined}
        description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined}
        status={configurationStatus(schema, configured, showAll)}
        hideLabel={rootTabContent}
        messages={fieldMessages}
        className={`${rootTabContent ? 'schema-root-union' : 'schema-object'}${valueOrExpression ? ' schema-value-or-expression' : ''}${compactUnion ? ' schema-compact-union' : ''}`}
      >
        {unionEditor}
      </FieldShell>
    )
  }
  if (schema.type === 'json') {
    return (
      <InputField id={fieldID} className="schema-field" label={displayTitle} path={collapsibleObjects ? undefined : path} required={schema.required === true} disabled={disabled} status={configurationStatus(schema, configured, showAll)} help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined} description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined} hideLabel={rootTabContent} messages={fieldMessages}>
        <textarea id={fieldID} className="plan-code-input" value={String(value ?? '{}')} onChange={(event) => onChange(event.target.value)} />
      </InputField>
    )
  }
  return (
    <InputField id={fieldID} className="schema-field" label={displayTitle} path={collapsibleObjects ? undefined : path} required={schema.required === true} disabled={disabled} status={configurationStatus(schema, configured, showAll)} help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined} description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined} hideLabel={rootTabContent} messages={fieldMessages}>
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
    </InputField>
  )
}

function isComplexArrayItem(schema?: DynamicFormSchema) {
  return schema?.type === 'object'
    || schema?.type === 'union' && Boolean(schema.variants?.some((variant) => variant.type === 'object'))
}

type FloatingRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

export function placeFloatingMenu(
  trigger: FloatingRect,
  menu: Pick<FloatingRect, 'width' | 'height'>,
  viewport: { width: number; height: number; left?: number; top?: number },
) {
  const margin = 12
  const gap = 5
  const viewportLeft = viewport.left ?? 0
  const viewportTop = viewport.top ?? 0
  const viewportRight = viewportLeft + viewport.width
  const viewportBottom = viewportTop + viewport.height
  const left = Math.min(
    Math.max(trigger.right - menu.width, viewportLeft + margin),
    Math.max(viewportLeft + margin, viewportRight - menu.width - margin),
  )
  const below = trigger.bottom + gap
  const above = trigger.top - menu.height - gap
  const preferredTop = below + menu.height <= viewportBottom - margin ? below : above
  const top = Math.min(
    Math.max(preferredTop, viewportTop + margin),
    Math.max(viewportTop + margin, viewportBottom - menu.height - margin),
  )
  return { left, top }
}

export function complexArrayCopy(path: string, title: string) {
  const identity = `${path} ${title}`.toLowerCase().replace(/[_-]+/g, ' ')
  const kind = identity.includes('volume zone')
    ? 'volume zone'
    : identity.includes('refinement')
      ? 'refinement'
      : identity.includes('model')
        ? 'model'
        : identity.includes('output')
          ? 'output'
          : 'item'
  const keys = {
    item: ['ITEM', 'Item'],
    model: ['MODEL', 'Model'],
    refinement: ['REFINEMENT', 'Refinement'],
    'volume zone': ['VOLUME ZONE', 'Volume zone'],
    output: ['OUTPUT', 'Output'],
  } as const
  const [uppercaseNoun, noun] = keys[kind]
  return {
    noun: localizeSchemaText(noun),
    newKicker: localizeSchemaText(`NEW ${uppercaseNoun}`),
    editKicker: localizeSchemaText(`EDIT ${uppercaseNoun}`),
    fixedType: localizeSchemaText(`${noun} type is fixed after creation.`),
    closeLabel: localizeSchemaText(`Close ${kind} editor`),
    saveLabel: localizeSchemaText(`Save ${kind}`),
  }
}

export function complexArrayVariantGroup(path: string, title: string, variantTitle: string) {
  const collection = `${path} ${title}`.toLowerCase()
  const variant = variantTitle.toLowerCase().replace(/[\s_-]+/g, '')
  if (collection.includes('output')) {
    if (variant.includes('probe')) return 'Probe'
    if (variant.includes('force') || variant.includes('integral')) return 'Force'
    if (variant.includes('streamline') || variant.includes('isosurface')) return 'Render'
    if (variant.includes('surface')) return 'Surface'
    if (variant.includes('volume') || variant.includes('slice')) return 'Volume'
    return 'Surface'
  }
  if (collection.includes('model')) {
    if (/wall|freestream|inflow|outflow|symmetry|periodic|slip/.test(variant)) return 'Boundary'
    if (/rotation|porous|actuator|betdisk/.test(variant)) return 'Volume'
    return 'Physics'
  }
  return localizeSchemaText('Types')
}

export function schemaNeedsUserInput(schema: DynamicFormSchema): boolean {
  if (schema.required === true) return true
  if (schema.type === 'object') {
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    return Object.entries(schema.properties ?? {}).some(([key, child]) => required.has(key) || schemaNeedsUserInput(child))
  }
  return false
}

function ComplexArrayField({
  schema, value, onChange, path, addLabel, removeLabel, collapsibleObjects, rootTabContent, configured, showAll, messages,
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  path: string
  addLabel: string
  removeLabel: string
  collapsibleObjects: boolean
  rootTabContent: boolean
  configured: boolean
  showAll: boolean
  messages: FieldMessage[]
}) {
  const array = Array.isArray(value) ? value : []
  const itemSchema = schema.items ?? { type: 'json' as const }
  const variants = itemSchema.type === 'union' ? itemSchema.variants ?? [] : []
  const [menuOpen, setMenuOpen] = useState(false)
  const [typeSearch, setTypeSearch] = useState('')
  const [editorFilter, setEditorFilter] = useState(false)
  const [editor, setEditor] = useState<{ index: number | null; schema: DynamicFormSchema; value: unknown } | null>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuSearchRef = useRef<HTMLInputElement>(null)
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null)
  const disabled = schema.disabled === true || schema.readOnly === true
  const issues = useContext(FieldIssueContext)
  const closeEditor = useCallback(() => setEditor(null), [])
  const editorDialogRef = useFocusTrap<HTMLElement>(Boolean(editor), closeEditor, '.schema-item-editor-close')
  const menuID = `${schemaFieldID(path)}-type-menu`

  const closeTypeMenu = useCallback((restoreFocus: boolean) => {
    setMenuOpen(false)
    setTypeSearch('')
    if (restoreFocus) requestAnimationFrame(() => menuTriggerRef.current?.focus())
  }, [])

  const openNew = (variantIndex?: number) => {
    const selectedSchema = variantIndex === undefined ? itemSchema : variants[variantIndex]
    if (!selectedSchema) return
    // New complex items start sparse, but initialValue includes every explicit
    // schema default so the dialog shows what Flow360 will actually use.
    const initial = initialValue(selectedSchema, true)
    // A portal menu item disappears in the same commit that opens the nested
    // dialog. Anchor focus on the durable trigger so useFocusTrap can restore
    // it when the dialog closes.
    menuTriggerRef.current?.focus()
    setEditor({
      index: null,
      schema: selectedSchema,
      value: itemSchema.type === 'union' ? { variant: variantIndex ?? 0, value: initial } : initial,
    })
    setEditorFilter(false)
    setTypeSearch('')
    setMenuOpen(false)
  }

  const openExisting = (index: number) => {
    const item = array[index]
    const selected = itemSchema.type === 'union' && isUnionDraft(item)
      ? itemSchema.variants?.[item.variant] ?? itemSchema
      : itemSchema
    setEditor({ index, schema: selected, value: item })
    setEditorFilter(false)
  }

  const saveEditor = () => {
    if (!editor) return
    onChange(editor.index === null
      ? [...array, editor.value]
      : array.map((entry, index) => index === editor.index ? editor.value : entry))
    setEditor(null)
  }

  const title = schema.title || humanize(path.split('.').pop() || 'Items')
  const displayTitle = formatSchemaLabel(title)
  const itemCopy = complexArrayCopy(path, title)
  const updateMenuPosition = useCallback(() => {
    const trigger = menuTriggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const viewport = window.visualViewport
    setMenuPosition(placeFloatingMenu(
      trigger.getBoundingClientRect(),
      menu.getBoundingClientRect(),
      {
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight,
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
      },
    ))
  }, [])

  const filteredVariantGroups = useMemo(() => {
    const query = typeSearch.trim().toLocaleLowerCase()
    const grouped = new Map<string, Array<{ schema: DynamicFormSchema; index: number; label: string }>>()
    variants.forEach((variant, index) => {
      const label = formatSchemaLabel(variant.title || `Type ${index + 1}`)
      if (query && !`${label} ${variant.title ?? ''}`.toLocaleLowerCase().includes(query)) return
      const group = complexArrayVariantGroup(path, title, variant.title || label)
      grouped.set(group, [...(grouped.get(group) ?? []), { schema: variant, index, label }])
    })
    return [...grouped.entries()]
  }, [path, title, typeSearch, variants])

  const editorPath = editor ? `${path}.${editor.index ?? array.length}` : ''
  const editorFields = useMemo(() => editor?.schema.type === 'object'
    ? Object.entries(editor.schema.properties ?? {}).filter(([key, child]) => !isDiscriminatorDefault(key, child)).map(([key, child]) => {
      const childPath = `${editorPath}.${key}`
      const invalid = issues?.some((issue) => issue.level !== 'warning' && issueMatchesPath(issue.path, childPath)) ?? false
      return {
        key,
        path: childPath,
        label: formatSchemaLabel(child.title || humanize(key)),
        required: (Array.isArray(editor.schema.required) && editor.schema.required.includes(key)) || schemaNeedsUserInput(child),
        invalid,
      }
    })
    : [], [editor, editorPath, issues])
  const visibleEditorKeys = useMemo(() => editorFilter
    ? new Set(editorFields.filter((field) => field.required || field.invalid).map((field) => field.key))
    : undefined, [editorFields, editorFilter])
  const jumpToEditorField = (fieldPath: string) => {
    const target = document.getElementById(schemaFieldID(fieldPath))
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    target?.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    if (!menuOpen) return
    // Keyboard activation can restore focus to the trigger after React's
    // portal commit. Run in the next task so the search field wins that race.
    const focusTimer = window.setTimeout(() => menuSearchRef.current?.focus(), 0)
    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    window.visualViewport?.addEventListener('resize', updateMenuPosition)
    window.visualViewport?.addEventListener('scroll', updateMenuPosition)
    return () => {
      window.clearTimeout(focusTimer)
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
      window.visualViewport?.removeEventListener('resize', updateMenuPosition)
      window.visualViewport?.removeEventListener('scroll', updateMenuPosition)
    }
  }, [menuOpen, updateMenuPosition])

  useEffect(() => {
    if (!editor) return
    // useFocusTrap provides containment, Escape, and restoration. This delayed
    // initial focus additionally covers a dialog opened by a menuitem's native
    // Enter activation, whose default focus step can run after the portal commit.
    const focusTimer = window.setTimeout(() => editorDialogRef.current?.querySelector<HTMLElement>('.schema-item-editor-close')?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [editor?.index, editor?.schema, editorDialogRef])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target))) return
      closeTypeMenu(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [closeTypeMenu, menuOpen])

  const handleTypeMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeTypeMenu(true)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && (event.target as HTMLElement).getAttribute('role') === 'menuitem') {
      event.preventDefault()
      ;(event.target as HTMLButtonElement).click()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    if (!items.length) return
    event.preventDefault()
    const current = items.indexOf(event.target as HTMLButtonElement)
    if (event.key === 'Home') items[0].focus()
    else if (event.key === 'End') items[items.length - 1].focus()
    else if (event.key === 'ArrowDown') items[current < 0 ? 0 : (current + 1) % items.length].focus()
    else items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length].focus()
  }

  const typeMenu = menuOpen && variants.length > 0 && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={menuRef}
        className={`schema-array-type-menu schema-array-type-menu--portal${menuPosition ? ' is-positioned' : ''}`}
        role="menu"
        id={menuID}
        aria-label={localizeSchemaText('Choose {item} type').replace('{item}', itemCopy.noun)}
        style={menuPosition ? { left: menuPosition.left, top: menuPosition.top } : undefined}
        onKeyDown={handleTypeMenuKeyDown}
      >
        <label className="schema-array-type-search"><Search size={13} /><span className="sr-only">{localizeSchemaText('Search types')}</span><input ref={menuSearchRef} value={typeSearch} placeholder={localizeSchemaText('Search types')} onChange={(event) => setTypeSearch(event.target.value)} /></label>
        {filteredVariantGroups.map(([group, entries]) => <section className="schema-array-type-group" key={group}><strong>{localizeSchemaText(group)}</strong>{entries.map((entry) => <button type="button" role="menuitem" key={entry.index} onClick={() => openNew(entry.index)}>{entry.label}</button>)}</section>)}
        {filteredVariantGroups.length === 0 && <span className="schema-array-type-empty">{localizeSchemaText('No matching types')}</span>}
      </div>,
      document.body,
    )
    : null
  const editorContent = (
    <>
      <div className="schema-array-toolbar">
        <span><strong>{array.length ? localizeSchemaText('{count} items').replace('{count}', String(array.length)) : localizeSchemaText('No items yet')}</strong>{rootTabContent && <SchemaDescriptionHelp description={schema.description} title={title} />}</span>
        <div className="schema-array-add-wrap">
          <button ref={menuTriggerRef} type="button" disabled={disabled} className="schema-array-add" aria-haspopup={variants.length ? 'menu' : undefined} aria-controls={variants.length ? menuID : undefined} aria-expanded={variants.length ? menuOpen : undefined} onClick={() => variants.length ? setMenuOpen((current) => !current) : openNew()}>
            <Plus size={14} /> Add item {variants.length ? <ChevronDown size={13} /> : null}
          </button>
          {typeMenu}
        </div>
      </div>
      {array.length === 0 ? <div className="schema-array-empty"><strong>This list is empty</strong><span>Add an item to configure this parameter group.</span></div> : (
        <div className="schema-array-list">{array.map((item, index) => <section className="schema-array-card compact" key={index}>
          <header>
            <span>{arrayItemSummary(itemSchema, item, index)}</span>
            <span className="schema-array-row-actions">
              <button type="button" disabled={disabled} className="schema-array-edit" onClick={() => openExisting(index)}><Edit3 size={13} /> Edit</button>
              <button type="button" disabled={disabled} className="schema-array-remove" onClick={() => onChange(array.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${title} item ${index + 1}`}><Trash2 size={13} /> Remove</button>
            </span>
          </header>
        </section>)}</div>
      )}
    </>
  )

  const dialog = editor && <div className="schema-item-editor-backdrop" role="presentation">
    <section ref={editorDialogRef} className="schema-item-editor-dialog" role="dialog" aria-modal="true" aria-label={`${editor.index === null ? 'Add' : 'Edit'} ${editor.schema.title || 'item'}`} tabIndex={-1}>
      <header><div><span className="schema-item-editor-kicker">{editor.index === null ? itemCopy.newKicker : itemCopy.editKicker}</span><h3>{formatSchemaLabel(editor.schema.title || title)}</h3><small>{itemCopy.fixedType}</small></div><button type="button" className="icon-button schema-item-editor-close" onClick={closeEditor} aria-label={itemCopy.closeLabel}><X size={17} /></button></header>
      <div className={`schema-item-editor-workspace ${editorFields.length > 4 ? 'has-nav' : 'no-nav'}`}>
      {editorFields.length > 4 && <nav className="schema-item-editor-nav" aria-label={localizeSchemaText('Form sections')}>
        <button type="button" className={editorFilter ? 'active' : ''} aria-pressed={editorFilter} onClick={() => setEditorFilter((current) => !current)}><ListFilter size={13} />{localizeSchemaText('Required / errors only')}</button>
        {([['Needs attention', editorFields.filter((field) => field.required || field.invalid)], ['Other fields', editorFilter ? [] : editorFields.filter((field) => !field.required && !field.invalid)]] as const).map(([group, fields]) => fields.length > 0 && <section key={group}><strong>{localizeSchemaText(group)}</strong>{fields.map((field) => <button type="button" className={field.invalid ? 'invalid' : ''} key={field.key} onClick={() => jumpToEditorField(field.path)}><span>{field.label}</span>{field.invalid ? <AlertCircle size={12} /> : field.required ? <small>{localizeSchemaText('Required')}</small> : null}</button>)}</section>)}
      </nav>}
      <div className="schema-item-editor-body"><SchemaField
        schema={editor.schema}
        path={editorPath}
        value={itemSchema.type === 'union' && isUnionDraft(editor.value) ? editor.value.value : editor.value}
        sparse
        showAll
        configured
        addLabel={addLabel}
        removeLabel={removeLabel}
        collapsibleObjects
        rootTabContent={false}
        embeddedObjectContent={editor.schema.type === 'object'}
        visibleObjectKeys={visibleEditorKeys}
        onChange={(next) => setEditor((current) => current ? {
          ...current,
          value: itemSchema.type === 'union' && isUnionDraft(current.value) ? { ...current.value, value: next } : next,
        } : current)}
      /></div></div>
      <footer><button type="button" onClick={closeEditor}>{localizeSchemaText('Cancel')}</button><button type="button" className="primary" onClick={saveEditor}>{itemCopy.saveLabel}</button></footer>
    </section>
  </div>
  const renderedDialog = dialog && typeof document !== 'undefined' ? createPortal(dialog, document.body) : dialog

  return <FieldShell
    id={schemaFieldID(path)}
    label={displayTitle}
    required={schema.required === true}
    disabled={disabled}
    help={collapsibleObjects ? <SchemaDescriptionHelp description={schema.description} title={title} /> : undefined}
    description={!collapsibleObjects ? localizedSchemaDescription(schema.description) : undefined}
    status={configurationStatus(schema, configured, showAll)}
    hideLabel={rootTabContent}
    messages={messages}
    className={`${rootTabContent ? 'schema-root-array' : 'schema-object schema-array'} schema-array-editor${messages.some((message) => (message.level ?? 'error') === 'error') ? ' schema-field-invalid' : ''}`}
  >
    {(controlProps) => <div id={controlProps.id} role="group" aria-label={controlProps['aria-label']} aria-required={controlProps['aria-required']} aria-describedby={controlProps['aria-describedby']} aria-invalid={controlProps['aria-invalid']} aria-errormessage={controlProps['aria-errormessage']}>{editorContent}{renderedDialog}</div>}
  </FieldShell>
}

function arrayItemSummary(schema: DynamicFormSchema, value: unknown, index: number) {
  const draft = schema.type === 'union' && isUnionDraft(value) ? value : null
  const selected = draft ? schema.variants?.[draft.variant] : schema
  const candidate = draft?.value ?? value
  const object = isRecord(candidate) ? candidate : {}
  const type = selected?.title || String(object.output_type ?? `Item ${index + 1}`)
  const name = String(object.name ?? '').trim()
  return name && name !== type ? `${type} · ${name}` : type
}

function RootFieldSection({
  title,
  description,
  configured,
  defaulted,
  showAll,
  invalid,
  children,
}: {
  title: string
  description?: string
  configured: boolean
  defaulted: boolean
  showAll: boolean
  invalid: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className={`schema-section schema-root-field-section${invalid ? ' schema-invalid' : ''}`}
      open={open || invalid}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="schema-section-title">
          <span>{formatSchemaLabel(title)}</span>
          <SchemaDescriptionHelp description={description} title={title} />
        </span>
        {showAll && !configured && <small className="schema-field-state">{localizeSchemaText(defaulted ? 'Default value' : 'Not configured')}</small>}
        <ChevronDown size={16} />
      </summary>
      <div className="schema-section-body">{children}</div>
    </details>
  )
}

export function normalizeIssuePath(issuePath: string | undefined): string {
  return (issuePath ?? '')
    .replace(/^simulation_params\.?/, '')
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/^\./, '')
}

export function rootTabForIssuePath(issuePath: string | undefined, tabKeys: string[]): string | undefined {
  const root = normalizeIssuePath(issuePath).split('.')[0]
  return tabKeys.includes(root) ? root : undefined
}

export function schemaFieldID(path: string): string {
  return `schema-${path.replace(/[^a-zA-Z0-9_-]/g, '-') || 'root'}`
}

function issueMatchesPath(issuePath: string | undefined, fieldPath: string, exact = false): boolean {
  if (!issuePath || !fieldPath) return false
  const normalized = normalizeIssuePath(issuePath)
  if (exact) return normalized === fieldPath
  return normalized === fieldPath || normalized.startsWith(`${fieldPath}.`)
}

function ExpressionField({
  schema,
  value,
  onChange,
  path,
  title,
  embedded = false,
  sectionContent = false,
  configured = true,
  showAll = false,
  messages = [],
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  path: string
  title: string
  embedded?: boolean
  sectionContent?: boolean
  configured?: boolean
  showAll?: boolean
  messages?: FieldMessage[]
}) {
  const validator = useContext(ExpressionValidationContext)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const validationSequence = useRef(0)
  const object = isRecord(value) ? value : {}
  const expression = String(object.expression ?? '')
  const [status, setStatus] = useState<'idle' | 'checking' | 'valid' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const update = (nextExpression: string, outputUnits: unknown = object.output_units) => {
    const next: Record<string, unknown> = {
      type_name: schema.wire_discriminator?.value ?? 'expression',
      expression: nextExpression,
    }
    if (typeof outputUnits === 'string' && outputUnits.trim()) next.output_units = outputUnits
    onChange(next)
    setStatus('idle')
    setMessage('')
  }
  const validate = async () => {
    const trimmed = expression.trim()
    if (!trimmed) {
      setStatus('error')
      setMessage('Enter an expression before validation.')
      return
    }
    if (trimmed.includes('^')) {
      setStatus('error')
      setMessage('Use ** for powers; Flow360 does not allow ^ in typed expressions.')
      return
    }
    if (!validator) return
    const sequence = ++validationSequence.current
    setStatus('checking')
    setMessage('Checking with the installed Flow360 schema…')
    try {
      const result = await validator(path)
      if (sequence !== validationSequence.current) return
      setStatus(result.valid ? 'valid' : 'error')
      setMessage(result.message ?? (result.valid ? 'Valid Flow360 expression.' : 'Flow360 rejected this expression.'))
    } catch (cause) {
      if (sequence !== validationSequence.current) return
      setStatus('error')
      setMessage(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const insertSuggestion = (suggestion: string) => {
    const token = suggestion.endsWith('()') ? suggestion.slice(0, -1) : suggestion
    const separator = expression && !/\s$/.test(expression) ? ' ' : ''
    update(`${expression}${separator}${token}`)
    requestAnimationFrame(() => inputRef.current?.focus())
  }
  const statusID = `${path.replace(/[^a-zA-Z0-9_-]/g, '-')}-expression-status`
  const suggestions = [...(schema.unit_suggestions ?? []), ...(schema.function_suggestions ?? []).slice(0, 6)]
  const disabled = schema.disabled === true || schema.readOnly === true
  const fieldID = schemaFieldID(path)
  const renderEditor = (controlProps?: FieldControlProps) => (
    <>
      <div className="schema-expression-input-wrap">
        <Code2 size={16} aria-hidden="true" />
        <textarea
          {...controlProps}
          ref={inputRef}
          aria-label={`${title} expression`}
          aria-describedby={[controlProps?.['aria-describedby'], statusID].filter(Boolean).join(' ') || undefined}
          disabled={disabled}
          rows={2}
          spellCheck={false}
          placeholder={schema.example || (schema.expected_unit ? `1 * u.${schema.expected_unit}` : 'Enter a Flow360 expression')}
          value={expression}
          onChange={(event) => update(event.target.value)}
          onBlur={() => void validate()}
        />
      </div>
      <div className="schema-expression-meta">
        <span>
          Expected: <strong>{schema.expected_dimension || schema.expected_unit || 'schema-compatible value'}</strong>
          {schema.expected_unit && schema.expected_dimension && <small> · {schema.expected_unit}</small>}
        </span>
        {!schema.allow_runtime && <span>Compile-time expression</span>}
      </div>
      {suggestions.length > 0 && (
        <div className="schema-expression-suggestions" aria-label="Expression suggestions">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => insertSuggestion(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <div id={statusID} className={`schema-expression-status ${status}`} aria-live="polite">
        {status === 'checking' && <RefreshCw size={13} className="spin" />}
        {status === 'valid' && <CheckCircle2 size={13} />}
        {status === 'error' && <AlertCircle size={13} />}
        {status !== 'idle' && <span>{message}</span>}
      </div>
      <details className="schema-expression-advanced">
        <summary>Advanced</summary>
        <label>
          Output units
          <input
            disabled={disabled}
            value={String(object.output_units ?? '')}
            placeholder="Infer from the expression"
            onChange={(event) => update(expression, event.target.value)}
          />
        </label>
      </details>
    </>
  )
  if (embedded) return <div className="schema-expression embedded">{renderEditor()}</div>
  return (
    <FieldShell
      id={fieldID}
      label={title}
      path={path}
      required={schema.required === true}
      disabled={disabled}
      help={<SchemaDescriptionHelp description={schema.description} title={title} />}
      hideLabel={sectionContent}
      status={status === 'idle' ? configurationStatus(schema, configured, showAll) : status === 'valid' ? 'Valid' : status === 'error' ? 'Invalid' : 'Checking'}
      statusTone={status === 'valid' ? 'success' : status === 'error' ? 'error' : status === 'checking' ? 'warning' : 'neutral'}
      messages={messages}
      className="schema-field schema-expression"
    >
      {(controlProps) => renderEditor(controlProps)}
    </FieldShell>
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
  fieldIssues,
  messages,
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  fieldID: string
  title: string
  configured: boolean
  showAll: boolean
  fieldIssues: Array<{ path?: string; message: string; level?: 'error' | 'warning' }>
  messages: FieldMessage[]
}) {
  const [editing, setEditing] = useState(false)
  const draft = isRecord(value) ? value : {}
  const selected = Array.isArray(draft.entities) ? draft.entities.filter((item): item is string => typeof item === 'string') : []
  const entityChoices = schema.entity_choices ?? []
  const allSelected = entityChoices.length > 0 && entityChoices.every((choice) => selected.includes(choice.value))
  const model = String(draft.model ?? schema.default_model ?? '')
  const modelLabel = schema.model_choices?.find((choice) => choice.value === model)?.label ?? model
  const recommendation = schema.recommendation
  const disabled = schema.disabled === true || schema.readOnly === true
  return (
    <FieldShell id={fieldID} label={formatSchemaLabel(title)} required={schema.required === true} disabled={disabled} help={<SchemaDescriptionHelp description={schema.description} title={title} />} status={configurationStatus(schema, configured, showAll)} messages={messages} className={`schema-object schema-entity-assignment${fieldIssues.length ? ' schema-field-invalid' : ''}`}>
      {(controlProps) => <div id={controlProps.id} role="group" tabIndex={fieldIssues.length && !disabled ? -1 : undefined} aria-required={controlProps['aria-required']} aria-invalid={controlProps['aria-invalid']} aria-describedby={controlProps['aria-describedby']} aria-errormessage={controlProps['aria-errormessage']}>
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
          <button type="button" disabled={disabled} className="schema-change-recommendation" onClick={() => setEditing((current) => !current)}>
            <ChevronDown size={13} className={editing ? 'expanded' : ''} />
            {editing ? 'Hide choices' : 'Change recommendation'}
          </button>
        </div>
      ) : schema.description ? <p>{localizedSchemaDescription(schema.description)}</p> : null}
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
              disabled={disabled || entityChoices.length === 0}
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
              disabled={disabled}
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
                  disabled={disabled}
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
          {entityChoices.length === 0 && <div className="schema-array-empty"><strong>{localizeSchemaText('No compatible entities')}</strong><span>{localizeSchemaText('No schema-compatible surfaces are available.')}</span><small>{localizeSchemaText('Create one from the Parameter entities panel, then reopen this editor.')}</small></div>}
        </div>
      )}
      </div>}
    </FieldShell>
  )
}

function SchemaInlineIssues({ issues }: { issues: Array<{ path?: string; message: string }> }) {
  return <>{issues.map((issue, index) => <small className="schema-inline-error" role="alert" key={`${issue.path}-${index}`}><AlertCircle size={12} />{issue.message}</small>)}</>
}

function SchemaDescriptionHelp({ description, title }: { description?: string; title: string }) {
  const help = localizedSchemaDescription(description)
  if (!help) return null
  return (
    <HelpTooltip label={localizeSchemaText('About {title}').replace('{title}', localizeSchemaText(title))} placement="bottom" align="start">
      {help}
    </HelpTooltip>
  )
}

function localizeSchemaText(value: string): string {
  return translate(value, currentLanguage())
}

export function formatSchemaLabel(value: string): string {
  const translated = localizeSchemaText(value)
  if (translated !== value) return translated
  const needsFormatting = /[_-]/.test(value) || /[a-z0-9][A-Z]/.test(value)
  return needsFormatting ? localizeSchemaText(humanize(value)) : value
}

function hasExplicitDefault(schema: DynamicFormSchema): boolean {
  return schema.default !== undefined && schema.default !== null
}

export function configurationStatus(schema: DynamicFormSchema, configured: boolean, showAll: boolean): string | undefined {
  if (!showAll || configured) return undefined
  return localizeSchemaText(hasExplicitDefault(schema) ? 'Default value' : 'Not configured')
}

function localizedSchemaDescription(description?: string): string {
  const cleaned = cleanSchemaDescription(description)
  return cleaned ? localizeSchemaText(cleaned) : ''
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
          .filter(([key, child]) => !sparse || child.required === true || requiredKeys.includes(key) || isDiscriminatorDefault(key, child) || child.default !== undefined && child.default !== null)
          .map(([key, child]) => [key, initialValue(child, sparse)]),
      )
    }
    case 'array':
      return []
    case 'quantity':
      return { value: initialValue(schema.value_schema ?? { type: 'number' }, sparse), units: schema.unit ?? '' }
    case 'expression':
      return {
        [schema.wire_discriminator?.field ?? 'type_name']: schema.wire_discriminator?.value ?? 'expression',
        expression: '',
      }
    case 'entity_assignment':
      return {
        model: schema.default_model ?? schema.model_choices?.[0]?.value ?? '',
        entities: schema.default_entities ?? [],
      }
    case 'entity_list':
      return { entities: [], selectors: [] }
    case 'field_removal':
      return null
    case 'boolean':
      return false
    case 'enum':
      return schema.options?.[0]
    case 'multi_select':
      return { [schema.value_key || 'items']: [] }
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
  if (value === null && schema.nullable) return null
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
    case 'entity_list': {
      if (!isRecord(value)) return initialValue(schema, sparse)
      const stored = Array.isArray(value.stored_entities) ? value.stored_entities : []
      const unmatchedStoredEntities: Record<string, unknown>[] = []
      const matchedStoredEntities: Array<{ value: string; payload: Record<string, unknown> }> = []
      const entities = stored.flatMap((entity) => {
        if (!isRecord(entity)) return []
        const choice = (schema.entity_choices ?? []).find((candidate) => entityMatchesChoice(entity, candidate))
        if (choice) {
          matchedStoredEntities.push({ value: choice.value, payload: entity })
          return [choice.value]
        }
        unmatchedStoredEntities.push(entity)
        return []
      })
      return {
        entities,
        selectors: Array.isArray(value.selectors) ? value.selectors : [],
        ...(matchedStoredEntities.length ? { matched_stored_entities: matchedStoredEntities } : {}),
        ...(unmatchedStoredEntities.length ? { unmatched_stored_entities: unmatchedStoredEntities } : {}),
      }
    }
    case 'expression': {
      const object = isRecord(value) ? value : {}
      return {
        ...object,
        [schema.wire_discriminator?.field ?? 'type_name']: schema.wire_discriminator?.value ?? 'expression',
        expression: String(object.expression ?? ''),
      }
    }
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
  if (value === null && schema.nullable) return null
  switch (schema.type) {
    case 'object': {
      const object = isRecord(value) ? value : {}
      if (sparse) {
        return Object.fromEntries(
          Object.entries(object)
            .filter(([key]) => Boolean(schema.properties?.[key]) || key.startsWith('private_attribute'))
            .map(([key, childValue]) => [key, schema.properties?.[key] ? serializeValue(schema.properties[key], childValue, true) : childValue]),
        )
      }
      return Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, child]) => [key, serializeValue(child, object[key], false)]),
      )
    }
    case 'array':
      return (Array.isArray(value) ? value : []).map((item) => serializeValue(schema.items ?? { type: 'json' }, item, sparse))
    case 'multi_select': {
      const object = isRecord(value) ? value : {}
      const valueKey = schema.value_key || 'items'
      return { ...object, [valueKey]: Array.isArray(object[valueKey]) ? object[valueKey] : [] }
    }
    case 'quantity': {
      const object = isRecord(value) ? value : {}
      const serializedValue = serializeValue(schema.value_schema ?? { type: 'number' }, object.value, sparse)
      const units = canonicalQuantityUnit(schema, String(object.units ?? schema.unit ?? '').trim())
      if (!units) throw new Error(`${schema.title || schema.path || 'Quantity'} requires a unit.`)
      if (schema.unit_options?.length && !schema.unit_options.includes(units)) {
        throw new Error(`${schema.title || schema.path || 'Quantity'} has an unsupported stored unit.`)
      }
      return { value: serializedValue, units }
    }
    case 'expression': {
      const object = isRecord(value) ? value : {}
      const expression = String(object.expression ?? '').trim()
      if (!expression) throw new Error(`${schema.title || schema.path || 'Expression'} requires an expression.`)
      const result: Record<string, unknown> = {
        [schema.wire_discriminator?.field ?? 'type_name']: schema.wire_discriminator?.value ?? 'expression',
        expression,
      }
      const outputUnits = String(object.output_units ?? '').trim()
      if (outputUnits) result.output_units = outputUnits
      return result
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
    case 'entity_list': {
      const object = isRecord(value) ? value : {}
      const selected = new Set(Array.isArray(object.entities) ? object.entities.filter((item): item is string => typeof item === 'string') : [])
      const unmatchedStoredEntities = Array.isArray(object.unmatched_stored_entities)
        ? object.unmatched_stored_entities.filter(isRecord)
        : []
      const matchedStoredEntities = Array.isArray(object.matched_stored_entities)
        ? object.matched_stored_entities.filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.value === 'string' && isRecord(entry.payload))
        : []
      const result: Record<string, unknown> = {
        stored_entities: [
          ...(schema.entity_choices ?? []).flatMap((choice) => {
            if (!selected.has(choice.value)) return []
            const preserved = matchedStoredEntities
              .filter((entry) => entry.value === choice.value)
              .map((entry) => entry.payload as Record<string, unknown>)
            return preserved.length ? preserved : choice.payload ? [choice.payload] : []
          }),
          ...unmatchedStoredEntities,
        ],
      }
      if (Array.isArray(object.selectors) && object.selectors.length) result.selectors = object.selectors
      return result
    }
    case 'field_removal':
      return null
    case 'number':
    case 'integer': {
      if (typeof value === 'string' && value.trim() === '') throw new Error(`${schema.title || schema.path || 'Field'} requires a number.`)
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) throw new Error(`${schema.title || schema.path || 'Field'} requires a number.`)
      if (schema.type === 'integer' && !Number.isInteger(numeric)) throw new Error(`${schema.title || schema.path || 'Field'} requires an integer.`)
      if (schema.minimum !== undefined && numeric < schema.minimum) throw new Error(`${schema.title || schema.path || 'Field'} must be at least ${schema.minimum}.`)
      if (schema.maximum !== undefined && numeric > schema.maximum) throw new Error(`${schema.title || schema.path || 'Field'} must be at most ${schema.maximum}.`)
      if (schema.exclusiveMinimum !== undefined && numeric <= schema.exclusiveMinimum) throw new Error(`${schema.title || schema.path || 'Field'} must be greater than ${schema.exclusiveMinimum}.`)
      if (schema.exclusiveMaximum !== undefined && numeric >= schema.exclusiveMaximum) throw new Error(`${schema.title || schema.path || 'Field'} must be less than ${schema.exclusiveMaximum}.`)
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

function quantityLikeObjectSchema(schema: DynamicFormSchema, value: unknown): DynamicFormSchema | null {
  if (schema.type !== 'object') return null
  const properties = schema.properties ?? {}
  const keys = Object.keys(properties)
  if (keys.length !== 2 || !keys.includes('value') || !keys.includes('units')) return null
  if (!['number', 'integer'].includes(properties.value.type) || properties.units.type !== 'string') return null
  const object = isRecord(value) ? value : isRecord(schema.default) ? schema.default : {}
  const unit = String(object.units ?? '')
  if (!unit) return null
  return {
    ...schema,
    type: 'quantity',
    unit,
    unit_options: [unit],
    value_schema: properties.value,
  }
}

function nullableSingleProperty(schema: DynamicFormSchema): [string, DynamicFormSchema] | null {
  if (schema.type !== 'object' || !schema.nullable) return null
  const entries = Object.entries(schema.properties ?? {}).filter(([key, child]) => !isDiscriminatorDefault(key, child))
  return entries.length === 1 && entries[0][1].type === 'enum' ? entries[0] : null
}

function singleValueProperty(schema: DynamicFormSchema): [string, DynamicFormSchema] | null {
  if (schema.type !== 'object') return null
  const entries = Object.entries(schema.properties ?? {}).filter(([key, child]) => !isDiscriminatorDefault(key, child))
  return entries.length === 1 && entries[0][0] === 'value' ? entries[0] : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isConfiguredValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isRecord(value)) return Object.keys(value).length > 0
  return true
}

function isUnionDraft(value: unknown): value is UnionDraft {
  return isRecord(value) && typeof value.variant === 'number' && 'value' in value
}

function negativeOneOrPositiveIntegerUnion(schema: DynamicFormSchema): { integerVariant: number; sentinelVariant: number } | null {
  if (schema.type !== 'union' || schema.variants?.length !== 2) return null
  const integerVariant = schema.variants.findIndex((variant) => variant.type === 'integer'
    && (variant.exclusiveMinimum === 0 || variant.minimum === 1))
  const sentinelVariant = schema.variants.findIndex((variant) => variant.type === 'enum'
    && variant.options?.length === 1
    && variant.options[0] === -1)
  return integerVariant >= 0 && sentinelVariant >= 0 ? { integerVariant, sentinelVariant } : null
}

function isSingleControlRootSchema(schema: DynamicFormSchema): boolean {
  return ['string', 'number', 'integer', 'boolean', 'enum', 'quantity'].includes(schema.type)
    || negativeOneOrPositiveIntegerUnion(schema) !== null
}

function enumArrayUnion(schema: DynamicFormSchema): { variant: number; schema: DynamicFormSchema; options: string[] } | null {
  if (schema.type !== 'union' || !schema.variants?.length) return null
  const variant = schema.variants.findIndex((candidate) => candidate.type === 'array'
    && candidate.items?.type === 'enum'
    && candidate.items.options?.length
    && candidate.items.options.every((option) => typeof option === 'string'))
  if (variant < 0) return null
  const arraySchema = schema.variants[variant]
  const alternatives = schema.variants.filter((_, index) => index !== variant)
  if (!alternatives.length || !alternatives.every((candidate) => candidate.type === 'enum'
    && candidate.options?.every((option) => typeof option === 'string'))) return null
  return { variant, schema: arraySchema, options: arraySchema.items?.options as string[] }
}

function normalizeEnumArrayUnionValue(value: unknown, options: string[]): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return []
  if (options.includes(value)) return [value]
  if (value === 'both' && options.includes('paraview') && options.includes('tecplot')) return ['paraview', 'tecplot']
  return []
}

function entityMatchesChoice(entity: Record<string, unknown>, choice: { value: string; payload?: Record<string, unknown> }) {
  const payload = choice.payload ?? {}
  const entityID = String(entity.private_attribute_id ?? entity.name ?? '')
  const payloadID = String(payload.private_attribute_id ?? payload.name ?? choice.value)
  return entityID !== '' && entityID === payloadID
}

function isDiscriminatorDefault(_key: string, schema: DynamicFormSchema): boolean {
  return schema.type === 'enum'
    && schema.default !== undefined
    && schema.options?.length === 1
    && JSON.stringify(schema.options[0]) === JSON.stringify(schema.default)
}

function schemaValueMatches(schema: DynamicFormSchema, value: unknown): boolean {
  switch (schema.type) {
    case 'quantity':
      return isRecord(value)
        && 'value' in value
        && 'units' in value
        && schemaValueMatches(schema.value_schema ?? { type: 'number' }, value.value)
    case 'expression':
      return isRecord(value)
        && (value.type_name === 'expression' || typeof value.expression === 'string')
    case 'object': {
      if (!isRecord(value)) return false
      const discriminators = Object.entries(schema.properties ?? {}).filter(([key, child]) => isDiscriminatorDefault(key, child))
      return discriminators.length === 0 || discriminators.every(([key, child]) =>
        (child.options ?? []).some((option) => JSON.stringify(option) === JSON.stringify(value[key])),
      )
    }
    case 'entity_assignment':
    case 'entity_list':
    case 'multi_select':
      return isRecord(value)
    case 'array':
      return Array.isArray(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number' && numericValueMatchesConstraints(schema, value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) && numericValueMatchesConstraints(schema, value)
    case 'string':
      return typeof value === 'string'
    case 'enum':
      return (schema.options ?? []).some((option) => JSON.stringify(option) === JSON.stringify(value))
    default:
      return false
  }
}

function numericValueMatchesConstraints(schema: DynamicFormSchema, value: number) {
  return (schema.minimum === undefined || value >= schema.minimum)
    && (schema.maximum === undefined || value <= schema.maximum)
    && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum)
    && (schema.exclusiveMaximum === undefined || value < schema.exclusiveMaximum)
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function compactValue(value: unknown) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (isRecord(value)) {
    if ('value' in value) return `${String(value.value)}${value.units ? ` ${String(value.units)}` : ''}`
    return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`
  }
  return String(value)
}
