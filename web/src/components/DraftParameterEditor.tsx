import { AlertCircle, CheckCircle2, Code2, ListTree, RefreshCw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, type DynamicFormSchema } from '../api/client'
import { hydrateSchemaValue, SchemaFormFields, serializeValue } from './SchemaForm'

type EditorMode = 'form' | 'json'

type Props = {
  draftId: string
  parameters?: Record<string, unknown>
  onSaved?: () => void
}

export default function DraftParameterEditor({ draftId, parameters, onSaved }: Props) {
  const baseline = useMemo(() => parameters ?? {}, [parameters])
  const [schema, setSchema] = useState<DynamicFormSchema | null>(null)
  const [mode, setMode] = useState<EditorMode>('form')
  const [formValue, setFormValue] = useState<unknown>(baseline)
  const [jsonValue, setJSONValue] = useState(() => JSON.stringify(baseline, null, 2))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setSaved(false)
    setDirty(false)
    setJSONValue(JSON.stringify(baseline, null, 2))
    api.draftParameterSchema(draftId)
      .then((response) => {
        if (!active) return
        setSchema(response.schema)
        setFormValue(hydrateSchemaValue(response.schema, baseline, true))
        setMode('form')
      })
      .catch((cause) => {
        if (!active) return
        setSchema(null)
        setMode('json')
        setError(`The Flow360 form schema is unavailable. You can still edit valid JSON. ${cleanError(cause)}`)
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [baseline, draftId])

  const selectMode = (nextMode: EditorMode) => {
    if (nextMode === mode) return
    try {
      if (nextMode === 'json') {
        if (!schema) return
        const next = buildDraftParameters(schema, formValue)
        setJSONValue(JSON.stringify(next, null, 2))
      } else {
        if (!schema) throw new Error('The Flow360 form schema is unavailable.')
        const next = parseParameterJSON(jsonValue)
        setFormValue(hydrateSchemaValue(schema, next, true))
      }
      setError('')
      setMode(nextMode)
    } catch (cause) {
      setError(cleanError(cause))
    }
  }

  const save = async () => {
    try {
      setSaving(true)
      setError('')
      setSaved(false)
      const next = mode === 'json'
        ? parseParameterJSON(jsonValue)
        : schema
          ? buildDraftParameters(schema, formValue)
          : baseline
      const response = await api.updateDraftParameters(draftId, next)
      const canonical = response.simulation_params
      setJSONValue(JSON.stringify(canonical, null, 2))
      if (schema) setFormValue(hydrateSchemaValue(schema, canonical, true))
      setDirty(false)
      setSaved(true)
      onSaved?.()
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="detail-empty"><RefreshCw size={15} className="spin" /> Loading the installed Flow360 schema…</div>
  }

  return (
    <div className="draft-parameter-editor">
      <div className="draft-parameter-toolbar">
        <div className="draft-editor-modes" role="tablist" aria-label="Draft parameter editor mode">
          <button type="button" role="tab" aria-selected={mode === 'form'} className={mode === 'form' ? 'active' : ''} disabled={!schema} onClick={() => selectMode('form')}>
            <ListTree size={13} /> Form
          </button>
          <button type="button" role="tab" aria-selected={mode === 'json'} className={mode === 'json' ? 'active' : ''} onClick={() => selectMode('json')}>
            <Code2 size={13} /> JSON
          </button>
        </div>
        <button type="button" className="draft-parameter-save" disabled={saving || !dirty} onClick={() => void save()}>
          {saving ? <RefreshCw size={13} className="spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save Draft'}
        </button>
      </div>

      {error && <div className="draft-parameter-message error" role="alert"><AlertCircle size={14} />{error}</div>}
      {saved && !error && <div className="draft-parameter-message success" role="status"><CheckCircle2 size={14} />Draft parameters saved to Flow360.</div>}

      {mode === 'form' && schema && (
        <div className="draft-parameter-form" role="tabpanel">
          <div className="draft-parameter-form-guide">
            <strong>Complete SimulationParams schema</strong>
            <span>Configured fields show the current Draft value. “Not configured” fields remain absent from saved params until you change them.</span>
          </div>
          <SchemaFormFields
            schema={schema}
            value={formValue}
            sparse
            showAll
            addLabel="Add"
            removeLabel="Remove"
            onChange={(next) => {
              setFormValue(next)
              setDirty(true)
              setSaved(false)
            }}
          />
        </div>
      )}
      {mode === 'json' && (
        <div role="tabpanel">
          <label className="draft-json-label" htmlFor={`draft-parameters-${draftId}`}>Complete SimulationParams JSON</label>
          <textarea
            id={`draft-parameters-${draftId}`}
            className="resource-json draft-json-editor"
            spellCheck={false}
            value={jsonValue}
            onChange={(event) => {
              setJSONValue(event.target.value)
              setDirty(true)
              setSaved(false)
            }}
          />
        </div>
      )}
      <p className="draft-parameter-help">
        Form and JSON edit the same Draft configuration. Saving replaces the Draft SimulationParams but does not start a mesh or solver run.
      </p>
    </div>
  )
}

export function parseParameterJSON(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (!isRecord(parsed)) throw new Error('Draft SimulationParams must be a JSON object.')
  return parsed
}

export function buildDraftParameters(schema: DynamicFormSchema, draft: unknown): Record<string, unknown> {
  const serialized = serializeValue(schema, draft, true)
  const merged = preserveUnknownFields(schema, draft, serialized)
  if (!isRecord(merged)) throw new Error('The Flow360 form root must be an object.')
  return merged
}

function preserveUnknownFields(schema: DynamicFormSchema, draft: unknown, serialized: unknown): unknown {
  if (schema.type !== 'object' || !isRecord(draft) || !isRecord(serialized)) return serialized
  const properties = schema.properties ?? {}
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (!properties[key]) result[key] = value
  }
  for (const [key, childSchema] of Object.entries(properties)) {
    if (Object.prototype.hasOwnProperty.call(draft, key) && Object.prototype.hasOwnProperty.call(serialized, key)) {
      result[key] = preserveUnknownFields(childSchema, draft[key], serialized[key])
    }
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanError(cause: unknown): string {
  return (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')
}
