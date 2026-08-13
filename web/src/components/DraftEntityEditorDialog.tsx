import { AlertCircle, Plus, Save, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { DynamicFormSchema } from '../api/client'
import { useI18n } from '../i18n'
import type { ParameterEntity, ParameterEntityType } from '../lib/draftEntities'
import { hydrateSchemaValue, serializeValue } from './SchemaForm'

export const editableDraftEntityTypes: ParameterEntityType[] = [
  'Box', 'Cylinder', 'Point', 'Sphere', 'AxisymmetricBody', 'CustomVolume',
  'SeedpointVolume', 'PointArray', 'PointArray2D', 'Slice',
]

type Translate = (value: string) => string

const numberArray = (title: string, length: number, translate: Translate, defaultValue: number[]): DynamicFormSchema => ({
  type: 'array',
  title: translate(title),
  items: { type: 'number', title: translate('Value') },
  minItems: length,
  maxItems: length,
  default: defaultValue,
})

const quantity = (title: string, unit: string, translate: Translate, value = 0, minimum?: number): DynamicFormSchema => ({
  type: 'quantity',
  title: translate(title),
  unit,
  unit_options: [...new Set([unit, 'm', 'cm', 'mm', 'in', 'ft'])],
  value_schema: { type: 'number', ...(minimum === undefined ? {} : { minimum }) },
  default: { value, units: unit },
})

const quantityVector = (title: string, length: number, unit: string, translate: Translate, value: number[]): DynamicFormSchema => ({
  type: 'object',
  title: translate(title),
  required: ['value', 'units'],
  properties: {
    value: numberArray('Coordinates', length, translate, value),
    units: { type: 'enum', title: translate('Units'), options: [...new Set([unit, 'm', 'cm', 'mm', 'in', 'ft'])], default: unit },
  },
  default: { value, units: unit },
})

export function draftEntitySchema(type: ParameterEntityType, unit = 'm', translate: Translate = (value) => value): DynamicFormSchema {
  const vector3 = (title: string, value = [0, 0, 0]) => numberArray(title, 3, translate, value)
  const qVector3 = (title: string, value = [0, 0, 0]) => quantityVector(title, 3, unit, translate, value)
  const axes: DynamicFormSchema = {
    type: 'array', title: translate('Principal axes'), minItems: 2, maxItems: 2,
    items: numberArray('Axis', 3, translate, [1, 0, 0]),
    default: [[1, 0, 0], [0, 1, 0]],
  }
  const common: Record<string, DynamicFormSchema> = {
    private_attribute_id: { type: 'string', title: translate('Entity ID'), required: true, minLength: 1 },
    name: { type: 'string', title: translate('Name'), required: true, minLength: 1 },
  }
  const byType: Record<string, Record<string, DynamicFormSchema>> = {
    Box: { axes, center: qVector3('Center'), size: qVector3('Size', [1, 1, 1]) },
    Cylinder: {
      axis: vector3('Axis', [0, 0, 1]), center: qVector3('Center'),
      height: quantity('Height', unit, translate, 1, 0),
      inner_radius: quantity('Inner radius', unit, translate, 0, 0),
      outer_radius: quantity('Outer radius', unit, translate, 1, 0),
    },
    Point: { location: qVector3('Location') },
    Sphere: { center: qVector3('Center'), radius: quantity('Radius', unit, translate, 1, 0) },
    AxisymmetricBody: {
      axis: vector3('Axis', [0, 0, 1]), center: qVector3('Center'),
      profile_curve: {
        type: 'array', title: translate('Profile curve'), minItems: 2,
        items: quantityVector('Profile point', 2, unit, translate, [0, 0]),
        default: [{ value: [0, 0], units: unit }, { value: [1, 0], units: unit }],
      },
    },
    CustomVolume: { axes, axis: vector3('Axis', [0, 0, 1]), center: qVector3('Center') },
    SeedpointVolume: {
      axes, axis: vector3('Axis', [0, 0, 1]), center: qVector3('Center'),
      point_in_mesh: {
        type: 'array', title: translate('Points in mesh'), minItems: 1,
        items: quantityVector('Point', 3, unit, translate, [0, 0, 0]),
        default: [{ value: [0, 0, 0], units: unit }],
      },
    },
    PointArray: {
      start: qVector3('Start'), end: qVector3('End', [1, 0, 0]),
      number_of_points: { type: 'integer', title: translate('Number of points'), minimum: 1, default: 10 },
    },
    PointArray2D: {
      origin: qVector3('Origin'),
      u_axis_vector: qVector3('U axis vector', [1, 0, 0]),
      v_axis_vector: qVector3('V axis vector', [0, 1, 0]),
      u_number_of_points: { type: 'integer', title: translate('U number of points'), minimum: 1, default: 10 },
      v_number_of_points: { type: 'integer', title: translate('V number of points'), minimum: 1, default: 10 },
    },
    Slice: { normal: vector3('Normal', [0, 0, 1]), origin: qVector3('Origin') },
  }
  const properties = { ...common, ...(byType[type] ?? {}) }
  return { type: 'object', title: translate('Draft entity'), properties, required: Object.keys(properties) }
}

function generatedID() {
  return globalThis.crypto?.randomUUID?.() ?? `entity-${Date.now().toString(36)}`
}

export function newDraftEntityValue(type: ParameterEntityType, unit = 'm'): Record<string, unknown> {
  const schema = draftEntitySchema(type, unit)
  const value = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, child]) => [key, child.default ?? '']))
  return { ...value, private_attribute_id: generatedID(), name: type }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function fixedNumberArray(schema: DynamicFormSchema): number | null {
  return schema.type === 'array'
    && schema.items?.type === 'number'
    && schema.minItems === schema.maxItems
    && typeof schema.minItems === 'number'
    ? schema.minItems
    : null
}

function vectorLabels(length: number) {
  return length === 2 ? ['X', 'Y'] : ['X', 'Y', 'Z'].slice(0, length)
}

function NumberVectorInput({
  value,
  length,
  onChange,
  label,
}: {
  value: unknown
  length: number
  onChange: (value: unknown) => void
  label: string
}) {
  const vector = Array.isArray(value) ? value : Array.from({ length }, () => 0)
  return (
    <div className="draft-entity-vector" role="group" aria-label={label}>
      {vectorLabels(length).map((axis, index) => (
        <label key={axis}>
          <span>{axis}</span>
          <input
            type="number"
            step="any"
            required
            aria-label={`${label} ${axis}`}
            value={String(vector[index] ?? '')}
            onChange={(event) => onChange(Array.from({ length }, (_, itemIndex) => (
              itemIndex === index ? event.target.value : vector[itemIndex] ?? 0
            )))}
          />
        </label>
      ))}
    </div>
  )
}

function DraftEntityField({
  schema,
  value,
  onChange,
  t,
}: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  t: Translate
}) {
  const title = schema.title ?? ''
  const vectorLength = fixedNumberArray(schema)
  if (vectorLength !== null) {
    return (
      <div className="draft-entity-field">
        <strong>{title}</strong>
        <NumberVectorInput value={value} length={vectorLength} onChange={onChange} label={title} />
      </div>
    )
  }
  if (schema.type === 'quantity') {
    const quantityValue = record(value)
    const units = schema.unit_options?.length ? schema.unit_options : [schema.unit ?? 'm']
    return (
      <label className="draft-entity-field">
        <strong>{title}</strong>
        <span className="draft-entity-quantity">
          <input
            type="number"
            step="any"
            required
            min={schema.value_schema?.minimum}
            value={String(quantityValue.value ?? '')}
            onChange={(event) => onChange({ ...quantityValue, value: event.target.value })}
          />
          <select value={String(quantityValue.units ?? schema.unit ?? '')} onChange={(event) => onChange({ ...quantityValue, units: event.target.value })} aria-label={`${title} ${t('Units')}`}>
            {units.map((unit) => <option value={unit} key={unit}>{unit}</option>)}
          </select>
        </span>
      </label>
    )
  }
  if (schema.type === 'object') {
    const object = record(value)
    const valueSchema = schema.properties?.value
    const unitsSchema = schema.properties?.units
    const quantityVectorLength = valueSchema ? fixedNumberArray(valueSchema) : null
    if (quantityVectorLength !== null && unitsSchema?.type === 'enum') {
      return (
        <div className="draft-entity-field">
          <strong>{title}</strong>
          <div className="draft-entity-vector-with-unit">
            <NumberVectorInput
              value={object.value}
              length={quantityVectorLength}
              label={title}
              onChange={(next) => onChange({ ...object, value: next })}
            />
            <select value={String(object.units ?? '')} onChange={(event) => onChange({ ...object, units: event.target.value })} aria-label={`${title} ${t('Units')}`}>
              {(unitsSchema.options ?? []).map((unit) => <option value={String(unit)} key={String(unit)}>{String(unit)}</option>)}
            </select>
          </div>
        </div>
      )
    }
  }
  if (schema.type === 'array' && schema.items) {
    const array = Array.isArray(value) ? value : []
    const itemVectorLength = fixedNumberArray(schema.items)
    const fixedLength = schema.minItems === schema.maxItems && typeof schema.minItems === 'number'
    if (fixedLength && itemVectorLength !== null) {
      return (
        <div className="draft-entity-field">
          <strong>{title}</strong>
          <div className="draft-entity-axis-list">
            {array.map((item, index) => (
              <div className="draft-entity-axis-row" key={index}>
                <span>{t('Axis')} {index + 1}</span>
                <NumberVectorInput
                  value={item}
                  length={itemVectorLength}
                  label={`${title} ${index + 1}`}
                  onChange={(next) => onChange(array.map((entry, itemIndex) => itemIndex === index ? next : entry))}
                />
              </div>
            ))}
          </div>
        </div>
      )
    }
    return (
      <div className="draft-entity-field draft-entity-point-list">
        <div className="draft-entity-field-heading">
          <strong>{title}</strong>
          <button type="button" onClick={() => onChange([...array, schema.items?.default ?? { value: [0, 0, 0], units: 'm' }])}><Plus size={13} />{t('Add point')}</button>
        </div>
        {array.map((item, index) => (
          <div className="draft-entity-point-row" key={index}>
            <span>{index + 1}</span>
            <DraftEntityField schema={{ ...schema.items!, title: `${title} ${index + 1}` }} value={item} onChange={(next) => onChange(array.map((entry, itemIndex) => itemIndex === index ? next : entry))} t={t} />
            <button type="button" className="icon-button" onClick={() => onChange(array.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${t('Remove point')} ${index + 1}`}><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    )
  }
  if (schema.type === 'enum') {
    return <label className="draft-entity-field"><strong>{title}</strong><select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>{(schema.options ?? []).map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select></label>
  }
  return (
    <label className="draft-entity-field">
      <strong>{title}</strong>
      <input
        type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'}
        step={schema.type === 'integer' ? 1 : 'any'}
        min={schema.minimum}
        required={schema.required === true}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function DraftEntityFields({ schema, value, onChange, t }: {
  schema: DynamicFormSchema
  value: unknown
  onChange: (value: unknown) => void
  t: Translate
}) {
  const object = record(value)
  const properties = schema.properties ?? {}
  const update = (key: string, next: unknown) => onChange({ ...object, [key]: next })
  const identity = ['private_attribute_id', 'name'].filter((key) => properties[key])
  const geometry = Object.keys(properties).filter((key) => !identity.includes(key))
  return (
    <>
      <section className="draft-entity-form-section">
        <h3>{t('Identity')}</h3>
        <div className="draft-entity-identity-grid">
          {identity.map((key) => <DraftEntityField key={key} schema={properties[key]} value={object[key]} onChange={(next) => update(key, next)} t={t} />)}
        </div>
      </section>
      <section className="draft-entity-form-section">
        <h3>{t('Geometry')}</h3>
        <div className="draft-entity-geometry-grid">
          {geometry.map((key) => <DraftEntityField key={key} schema={properties[key]} value={object[key]} onChange={(next) => update(key, next)} t={t} />)}
        </div>
      </section>
    </>
  )
}

function editableEntityValue(entity: ParameterEntity | undefined, type: ParameterEntityType, unit: string) {
  if (!entity) return newDraftEntityValue(type, unit)
  const raw = entity.raw
  const inputCache = record(raw.private_attribute_input_cache)
  return {
    ...newDraftEntityValue(type, unit),
    ...raw,
    ...(type === 'Box' && !raw.axes && inputCache.axes ? { axes: inputCache.axes } : {}),
  }
}

function arrayValue(value: unknown): unknown[] {
  const object = record(value)
  const candidate = 'value' in object ? object.value : value
  return Array.isArray(candidate) ? candidate : []
}

export function validateDraftEntityValue(type: ParameterEntityType, value: Record<string, unknown>): string[] {
  const issues: string[] = []
  const requireVector = (key: string, length: number) => {
    const vector = arrayValue(value[key])
    if (vector.length !== length || vector.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
      issues.push(`${key} must contain exactly ${length} finite numbers.`)
    }
  }
  const vectorLengthSquared = (key: string): number => arrayValue(value[key]).reduce<number>((total, entry) => total + Number(entry) ** 2, 0)
  const quantityNumber = (key: string) => Number(record(value[key]).value)
  if (!String(value.private_attribute_id ?? '').trim()) issues.push('Entity ID is required.')
  if (!String(value.name ?? '').trim()) issues.push('Name is required.')
  if (['Box', 'Cylinder', 'Sphere', 'AxisymmetricBody', 'CustomVolume', 'SeedpointVolume'].includes(type)) requireVector('center', 3)
  if (['Cylinder', 'AxisymmetricBody', 'CustomVolume', 'SeedpointVolume'].includes(type)) requireVector('axis', 3)
  if (type === 'Point') requireVector('location', 3)
  if (type === 'Box') {
    requireVector('size', 3)
    if (arrayValue(value.size).some((entry) => Number(entry) <= 0)) issues.push('size values must be greater than zero.')
    const axesValue = Array.isArray(value.axes) ? value.axes : []
    if (axesValue.length !== 2 || axesValue.some((axis) => !Array.isArray(axis) || axis.length !== 3 || axis.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry)))) issues.push('axes must contain exactly two finite 3D vectors.')
  }
  if (type === 'PointArray') { requireVector('start', 3); requireVector('end', 3) }
  if (type === 'PointArray2D') { requireVector('origin', 3); requireVector('u_axis_vector', 3); requireVector('v_axis_vector', 3) }
  if (type === 'Slice') { requireVector('normal', 3); requireVector('origin', 3) }
  if (['Cylinder', 'AxisymmetricBody', 'CustomVolume', 'SeedpointVolume'].includes(type) && vectorLengthSquared('axis') <= 1e-12) issues.push('axis must be non-zero.')
  if (type === 'Slice' && vectorLengthSquared('normal') <= 1e-12) issues.push('normal must be non-zero.')
  if (type === 'PointArray2D' && (vectorLengthSquared('u_axis_vector') <= 1e-12 || vectorLengthSquared('v_axis_vector') <= 1e-12)) issues.push('U and V axis vectors must be non-zero.')
  if (type === 'AxisymmetricBody') {
    const profile = Array.isArray(value.profile_curve) ? value.profile_curve : []
    if (profile.length < 2) issues.push('profile_curve requires at least two points.')
    if (profile.some((point) => arrayValue(point).length !== 2)) issues.push('Every profile_curve point must contain two coordinates.')
  }
  if (type === 'SeedpointVolume') {
    const points = Array.isArray(value.point_in_mesh) ? value.point_in_mesh : []
    if (points.length < 1) issues.push('point_in_mesh requires at least one point.')
    if (points.some((point) => arrayValue(point).length !== 3)) issues.push('Every point_in_mesh entry must contain three coordinates.')
  }
  if (type === 'Sphere' && quantityNumber('radius') <= 0) issues.push('radius must be greater than zero.')
  if (type === 'Cylinder') {
    const height = quantityNumber('height')
    const inner = quantityNumber('inner_radius')
    const outer = quantityNumber('outer_radius')
    if (height <= 0) issues.push('height must be greater than zero.')
    if (inner < 0 || outer <= 0 || inner >= outer) issues.push('Cylinder radii must satisfy 0 ≤ inner_radius < outer_radius.')
  }
  for (const key of ['number_of_points', 'u_number_of_points', 'v_number_of_points']) {
    if (key in value && (!Number.isInteger(value[key]) || Number(value[key]) < 1)) issues.push(`${key} must be a positive integer.`)
  }
  return issues
}

export function normalizeDraftEntity(
  type: ParameterEntityType,
  value: Record<string, unknown>,
  original?: ParameterEntity,
): Record<string, unknown> {
  const base = original?.type === type ? original.raw : {}
  const entity: Record<string, unknown> = {
    ...base,
    ...value,
    private_attribute_entity_type_name: type,
  }
  if (type === 'Box') {
    entity.type_name = 'Box'
    entity.private_attribute_constructor = 'from_principal_axes'
    entity.private_attribute_input_cache = {
      axes: value.axes,
      center: value.center,
      size: value.size,
      name: value.name,
    }
  }
  if (type === 'SeedpointVolume') entity.type = 'SeedpointVolume'
  return entity
}

export default function DraftEntityEditorDialog({
  entity,
  unit = 'm',
  saving,
  onSave,
  onDelete,
  onClose,
}: {
  entity?: ParameterEntity
  unit?: string
  saving: boolean
  onSave: (entity: Record<string, unknown>) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const { t } = useI18n()
  const [type, setType] = useState<ParameterEntityType>(entity?.type ?? 'Box')
  const schema = useMemo(() => draftEntitySchema(type, unit, t), [t, type, unit])
  const [value, setValue] = useState<unknown>(() => hydrateSchemaValue(schema, editableEntityValue(entity, type, unit)))
  const [error, setError] = useState('')
  const titleId = useId()

  useEffect(() => {
    const nextType = entity?.type ?? 'Box'
    const nextSchema = draftEntitySchema(nextType, unit, t)
    setType(nextType)
    setValue(hydrateSchemaValue(nextSchema, editableEntityValue(entity, nextType, unit)))
    setError('')
  }, [entity, t, unit])

  const changeType = (nextType: ParameterEntityType) => {
    setType(nextType)
    const nextSchema = draftEntitySchema(nextType, unit, t)
    const common = record(value)
    setValue(hydrateSchemaValue(nextSchema, {
      ...newDraftEntityValue(nextType, unit),
      private_attribute_id: common.private_attribute_id,
      name: common.name || nextType,
    }))
    setError('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    try {
      const serialized = serializeValue(schema, value, false)
      const candidate = record(serialized)
      const issues = validateDraftEntityValue(type, candidate)
      if (issues.length) throw new Error(issues[0])
      await onSave(normalizeDraftEntity(type, candidate, entity))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const remove = async () => {
    if (!onDelete || !window.confirm(t('Delete this Draft entity? Parameters that reference it may become invalid.'))) return
    try {
      await onDelete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, saving])

  const dialog = (
    <div className="schema-form-backdrop draft-entity-editor-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onClose()
    }}>
      <form
        className="schema-form-dialog draft-entity-editor-dialog"
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div>
            <p className="eyebrow">{t('DRAFT ENTITY')}</p>
            <h2 id={titleId}>{t(entity ? 'Edit Draft entity' : 'Add Draft entity')}</h2>
            <span>{t('Configure the entity in project coordinates. Saving validates and updates the active Draft SimulationParams.')}</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('Close Draft entity editor')}><X size={18} /></button>
        </header>
        <div className="schema-form-body">
          <label className="draft-entity-field draft-entity-type-field">
            <strong>{t('Entity type')}</strong>
            <select value={type} onChange={(event) => changeType(event.target.value as ParameterEntityType)}>
              {editableDraftEntityTypes.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <DraftEntityFields schema={schema} value={value} onChange={setValue} t={t} />
        </div>
        {error && <div className="schema-form-error" role="alert"><AlertCircle size={13} />{t(error)}</div>}
        <footer className="draft-entity-editor-actions">
          {onDelete && <button type="button" className="danger" disabled={saving} onClick={() => void remove()}><Trash2 size={13} />{t('Delete entity')}</button>}
          <span />
          <button type="button" onClick={onClose} disabled={saving}>{t('Cancel')}</button>
          <button className="primary" type="submit" disabled={saving}>{entity ? <Save size={13} /> : <Plus size={13} />}{t(saving ? 'Saving…' : 'Save entity')}</button>
        </footer>
      </form>
    </div>
  )
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}
