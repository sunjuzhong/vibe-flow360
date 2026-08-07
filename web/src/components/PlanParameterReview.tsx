import { AlertCircle, CheckCircle2, Code2, ListTree, RefreshCw, Save, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api, type DynamicFormSchema, type PlanFormSchemaResponse, type ProjectInfo, type ResourceNode, type SimulationPlan } from '../api/client'
import { errorMessage } from '../lib/errors'
import { unwrapSimulationParams } from '../lib/planStages'
import { buildDraftParameters, parseParameterJSON } from './DraftParameterEditor'
import { hydrateSchemaValue, SchemaFormFields } from './SchemaForm'

type Props = {
  project: ProjectInfo
  resource: ResourceNode
  plan: SimulationPlan
  fallbackParameters?: Record<string, unknown>
  busy: boolean
  repairBusy: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
  onRepair: () => Promise<void>
}

export default function PlanParameterReview({
  project,
  resource,
  plan,
  fallbackParameters,
  busy,
  repairBusy,
  onSave,
  onRepair,
}: Props) {
  const [schema, setSchema] = useState<DynamicFormSchema | null>(null)
  const [baseline, setBaseline] = useState<Record<string, unknown>>({})
  const [value, setValue] = useState<unknown>({})
  const [jsonValue, setJSONValue] = useState('{}')
  const [mode, setMode] = useState<'form' | 'json'>('form')
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const issues = plan.preflight?.issues ?? []
  const errors = issues.filter((issue) => issue.level === 'error')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setSaved(false)
    setDirty(false)
    api.planFormSchema({
      project_id: project.id,
      project_name: project.name,
      source_id: resource.id,
      source_type: resource.type,
      source_name: resource.name,
      draft_id: plan.remote_ids?.draft_id,
      target: plan.target,
      patch: plan.patch,
    }).then((response) => {
      if (!active) return
      const completeSchema = combineStageSchemas(response)
      // planFormSchema returns the canonical source baseline with plan.patch
      // already applied, so it is the exact payload that preflight validates.
      const current = Object.keys(response.baseline ?? {}).length
        ? unwrapSimulationParams(response.baseline)
        : applyJSONMergePatch(unwrapSimulationParams(fallbackParameters), plan.patch)
      setSchema(completeSchema)
      setBaseline(current)
      setValue(hydrateSchemaValue(completeSchema, current, true))
      setJSONValue(JSON.stringify(current, null, 2))
      setMode('form')
    }).catch((cause) => {
      if (!active) return
      const source = unwrapSimulationParams(fallbackParameters)
      const current = applyJSONMergePatch(source, plan.patch)
      setSchema(null)
      setBaseline(current)
      setJSONValue(JSON.stringify(current, null, 2))
      setMode('json')
      setError(`The complete Flow360 form schema is unavailable. You can still review valid JSON. ${errorMessage(cause)}`)
    }).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [fallbackParameters, plan.id, plan.patch, plan.revision, plan.target, project.id, project.name, resource.id, resource.name, resource.type])

  const errorSummary = useMemo(() => errors.length
    ? `${errors.length} parameter error${errors.length === 1 ? '' : 's'} must be resolved before approval.`
    : 'All current parameters pass the Flow360 preflight.', [errors.length])

  const selectMode = (next: 'form' | 'json') => {
    if (next === mode) return
    try {
      if (next === 'json') {
        if (!schema) return
        setJSONValue(JSON.stringify(buildDraftParameters(schema, value), null, 2))
      } else {
        if (!schema) throw new Error('The complete Flow360 form schema is unavailable.')
        setValue(hydrateSchemaValue(schema, parseParameterJSON(jsonValue), true))
      }
      setError('')
      setMode(next)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  const save = async () => {
    try {
      setError('')
      setSaved(false)
      const next = mode === 'json'
        ? parseParameterJSON(jsonValue)
        : schema
          ? buildDraftParameters(schema, value)
          : baseline
      await onSave(createJSONMergePatch(baseline, next))
      setSaved(true)
      setDirty(false)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }

  if (loading) return <div className="plan-neutral"><RefreshCw size={14} className="spin" /> Loading complete SimulationParams…</div>

  return (
    <section className="plan-parameter-review" aria-label="Complete SimulationParams review">
      <header>
        <div>
          <h3>Complete SimulationParams</h3>
          <p>Review and edit every parameter that will be handed to Flow360. Errors are marked at their exact field.</p>
        </div>
        <div className="plan-parameter-actions">
          <div className="draft-editor-modes" role="tablist" aria-label="Parameter editor mode">
            <button type="button" role="tab" aria-selected={mode === 'form'} className={mode === 'form' ? 'active' : ''} disabled={!schema} onClick={() => selectMode('form')}><ListTree size={13} /> Form</button>
            <button type="button" role="tab" aria-selected={mode === 'json'} className={mode === 'json' ? 'active' : ''} onClick={() => selectMode('json')}><Code2 size={13} /> JSON</button>
          </div>
          <button type="button" className="plan-ai-repair" disabled={repairBusy || !errors.length} onClick={() => {
            setError('')
            void onRepair().catch((cause) => setError(errorMessage(cause)))
          }}>
            {repairBusy ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
            {repairBusy ? 'Repairing & validating…' : 'AI Repair'}
          </button>
          <button type="button" className="draft-parameter-save" disabled={busy || !dirty} onClick={() => void save()}>
            {busy ? <RefreshCw size={13} className="spin" /> : <Save size={13} />}{busy ? 'Validating…' : 'Save & validate'}
          </button>
        </div>
      </header>

      <div className={`plan-parameter-status ${errors.length ? 'error' : 'ready'}`}>
        {errors.length ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
        <span>{errorSummary}</span>
      </div>
      {error && <div className="draft-parameter-message error" role="alert"><AlertCircle size={14} />{error}</div>}
      {saved && !error && <div className="draft-parameter-message success" role="status"><CheckCircle2 size={14} />Parameters saved and preflight refreshed.</div>}

      {mode === 'form' && schema && (
        <div className="draft-parameter-form plan-complete-parameter-form" role="tabpanel">
          <SchemaFormFields
            schema={schema}
            value={value}
            sparse
            showAll
            rootTabs
            collapsibleObjects
            issues={issues}
            onChange={(next) => { setValue(next); setDirty(true); setSaved(false) }}
          />
        </div>
      )}
      {mode === 'json' && (
        <div role="tabpanel">
          <label className="draft-json-label" htmlFor={`plan-parameters-${plan.id}`}>Complete SimulationParams JSON</label>
          <textarea id={`plan-parameters-${plan.id}`} className="resource-json draft-json-editor" spellCheck={false} value={jsonValue} onChange={(event) => { setJSONValue(event.target.value); setDirty(true); setSaved(false) }} />
        </div>
      )}
    </section>
  )
}

export function combineStageSchemas(response: PlanFormSchemaResponse): DynamicFormSchema {
  const schemas = response.stages.map((stage) => response.schemas[stage]).filter((item): item is DynamicFormSchema => Boolean(item))
  return schemas.reduce<DynamicFormSchema>((combined, schema) => {
    if (schema.type !== 'object') return combined
    return {
      ...combined,
      title: 'SimulationParams',
      properties: { ...(combined.properties ?? {}), ...(schema.properties ?? {}) },
      required: [...new Set([
        ...(Array.isArray(combined.required) ? combined.required : []),
        ...(Array.isArray(schema.required) ? schema.required : []),
      ])],
    }
  }, { type: 'object', title: 'SimulationParams', properties: {} })
}

export function applyJSONMergePatch(source: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...source }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key]
    } else if (isRecord(value)) {
      result[key] = applyJSONMergePatch(isRecord(result[key]) ? result[key] : {}, value)
    } else {
      result[key] = value
    }
  }
  return result
}

export function createJSONMergePatch(source: Record<string, unknown>, target: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(source), ...Object.keys(target)])) {
    if (!(key in target)) {
      patch[key] = null
    } else if (!(key in source)) {
      patch[key] = target[key]
    } else if (isRecord(source[key]) && isRecord(target[key])) {
      const child = createJSONMergePatch(source[key], target[key])
      if (Object.keys(child).length) patch[key] = child
    } else if (JSON.stringify(source[key]) !== JSON.stringify(target[key])) {
      patch[key] = target[key]
    }
  }
  return patch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
