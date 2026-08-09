import { AlertCircle, ArrowRight, CheckCircle2, Code2, Eye, ListTree, Play, RefreshCw, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type DraftParameterValidationResponse, type DynamicFormSchema, type ProjectInfo, type ResourceNode } from '../api/client'
import { useI18n } from '../i18n'
import JsonEditor, { jsonSyntaxIssue } from './JsonEditor'
import JsonPreview from './JsonPreview'
import { applyJSONMergePatch, diffParameterValues } from './PlanParameterReview'
import { hydrateSchemaValue, SchemaFormFields, serializeValue, type ExpressionValidator } from './SchemaForm'

type EditorMode = 'form' | 'json' | 'preview'

type Props = {
  draftId: string
  parameters?: Record<string, unknown>
  onSaved?: (parameters: Record<string, unknown>) => void
  onReviewRun?: () => void
  project?: ProjectInfo
  resource?: ResourceNode
  readOnly?: boolean
}

export default function DraftParameterEditor({ draftId, parameters, onSaved, onReviewRun, project, resource, readOnly = false }: Props) {
  const { t } = useI18n()
  const initialBaseline = useMemo(() => parameters ?? {}, [parameters])
  const [baseline, setBaseline] = useState<Record<string, unknown>>(initialBaseline)
  const [schema, setSchema] = useState<DynamicFormSchema | null>(null)
  const [mode, setMode] = useState<EditorMode>('form')
  const [formValue, setFormValue] = useState<unknown>(initialBaseline)
  const [jsonValue, setJSONValue] = useState(() => JSON.stringify(initialBaseline, null, 2))
  const [previewValue, setPreviewValue] = useState<unknown>(initialBaseline)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [failedSyncFingerprint, setFailedSyncFingerprint] = useState('')
  const [validation, setValidation] = useState<DraftParameterValidationResponse | null>(null)
  const [validating, setValidating] = useState(false)
  const [validatedFingerprint, setValidatedFingerprint] = useState('')
  const [aiPrompt, setAIPrompt] = useState('')
  const [aiLoading, setAILoading] = useState(false)
  const [aiMessage, setAIMessage] = useState('')
  const latestFingerprintRef = useRef('')
  const currentDraftIdRef = useRef(draftId)
  const onSavedRef = useRef(onSaved)

  currentDraftIdRef.current = draftId
  onSavedRef.current = onSaved

  useEffect(() => {
    setSyncError('')
    setFailedSyncFingerprint('')
    setSaving(false)
    setAILoading(false)
    setAIPrompt('')
    setAIMessage('')
  }, [draftId])

  useEffect(() => {
    let active = true
    if (readOnly) {
      setLoading(false)
      setPreviewValue(initialBaseline)
      return () => { active = false }
    }
    setLoading(true)
    setError('')
    setDirty(false)
    setJSONValue(JSON.stringify(initialBaseline, null, 2))
    api.draftParameterSchema(draftId)
      .then((response) => {
        if (!active) return
        const canonical = response.baseline
        setBaseline(canonical)
        setSchema(response.schema)
        setFormValue(hydrateSchemaValue(response.schema, canonical, true))
        setJSONValue(JSON.stringify(canonical, null, 2))
        setPreviewValue(canonical)
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
  }, [draftId, readOnly])

  const candidateResult = useMemo(() => {
    try {
      const value = mode === 'json'
        ? parseParameterJSON(jsonValue)
        : mode === 'preview'
          ? isRecord(previewValue) ? previewValue : baseline
          : schema ? buildDraftParameters(schema, formValue) : baseline
      return { value, fingerprint: JSON.stringify(value), error: '' }
    } catch (cause) {
      return { value: null, fingerprint: '', error: cleanError(cause) }
    }
  }, [baseline, formValue, jsonValue, mode, previewValue, schema])

  const changes = useMemo(
    () => candidateResult.value ? diffParameterValues(baseline, candidateResult.value) : [],
    [baseline, candidateResult.value],
  )

  latestFingerprintRef.current = candidateResult.fingerprint

  useEffect(() => {
    if (loading || readOnly || !candidateResult.value || !candidateResult.fingerprint) return
    let active = true
    const timer = window.setTimeout(() => {
      setValidating(true)
      api.validateDraftParameters(draftId, candidateResult.value!)
        .then((response) => {
          if (!active) return
          setValidation(response)
          setValidatedFingerprint(candidateResult.fingerprint)
        })
        .catch((cause) => {
          if (!active) return
          setValidation(null)
          setValidatedFingerprint('')
          setError(cleanError(cause))
        })
        .finally(() => active && setValidating(false))
    }, dirty ? 500 : 0)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [candidateResult.fingerprint, draftId, dirty, loading, readOnly])

  const selectMode = (nextMode: EditorMode) => {
    if (nextMode === mode) return
    try {
      if (nextMode === 'json') {
        if (mode === 'form') {
          if (!schema) return
          const next = buildDraftParameters(schema, formValue)
          setJSONValue(JSON.stringify(next, null, 2))
        }
      } else if (nextMode === 'form') {
        if (!schema) throw new Error('The Flow360 form schema is unavailable.')
        const next = parseParameterJSON(jsonValue)
        setFormValue(hydrateSchemaValue(schema, next, true))
      } else {
        const next = mode === 'form'
          ? schema ? buildDraftParameters(schema, formValue) : baseline
          : parseParameterJSON(jsonValue)
        setPreviewValue(next)
        setJSONValue(JSON.stringify(next, null, 2))
      }
      setError('')
      setMode(nextMode)
    } catch (cause) {
      setError(cleanError(cause))
    }
  }

  const validateExpression: ExpressionValidator = useCallback(async (path) => {
    if (!schema) return { valid: false, message: 'The Flow360 form schema is unavailable.' }
    const candidate = buildDraftParameters(schema, formValue)
    const result = await api.validateDraftParameters(draftId, candidate, [path])
    return {
      valid: result.valid,
      message: result.valid ? 'Valid with the installed Flow360 schema.' : result.issues[0]?.message,
    }
  }, [draftId, formValue, schema])

  const applyCandidate = (next: Record<string, unknown>) => {
    setJSONValue(JSON.stringify(next, null, 2))
    setPreviewValue(next)
    if (schema) setFormValue(hydrateSchemaValue(schema, next, true))
    setDirty(true)
    setSyncError('')
    setFailedSyncFingerprint('')
    setValidation(null)
    setValidatedFingerprint('')
  }

  const fillWithAI = async () => {
    if (!project || !resource || !candidateResult.value || !aiPrompt.trim() || aiLoading) return
    const requestDraftId = draftId
    setAILoading(true)
    setAIMessage('')
    setError('')
    try {
      const response = await api.assistPlanForm({
        project_id: project.id,
        project_name: project.name,
        source_id: resource.id,
        source_type: resource.type,
        source_name: resource.name,
        draft_id: draftId,
        target: 'case',
        intent: aiPrompt.trim(),
        prompt: aiPrompt.trim(),
        patch: createJSONMergePatch(baseline, candidateResult.value),
        autonomous: true,
      })
      if (currentDraftIdRef.current !== requestDraftId) return
      if (!response.proposal) throw new Error(response.action.message || t('AI did not return parameter changes.'))
      applyCandidate(applyJSONMergePatch(baseline, response.proposal.patch))
      setAIMessage(response.action.message)
    } catch (cause) {
      if (currentDraftIdRef.current !== requestDraftId) return
      setError(cleanError(cause))
    } finally {
      if (currentDraftIdRef.current === requestDraftId) setAILoading(false)
    }
  }

  const persistCandidate = useCallback(async (next: Record<string, unknown>, fingerprint: string) => {
    const requestDraftId = draftId
    try {
      setSaving(true)
      setSyncError('')
      setFailedSyncFingerprint('')
      const response = await api.updateDraftParameters(draftId, next, project?.id)
      if (currentDraftIdRef.current !== requestDraftId) return
      const canonical = response.simulation_params
      setBaseline(canonical)
      if (latestFingerprintRef.current === fingerprint) {
        setJSONValue(JSON.stringify(canonical, null, 2))
        setPreviewValue(canonical)
        if (schema) setFormValue(hydrateSchemaValue(schema, canonical, true))
        setDirty(false)
        onSavedRef.current?.(canonical)
      }
    } catch (cause) {
      if (currentDraftIdRef.current !== requestDraftId) return
      setSyncError(cleanError(cause))
      setFailedSyncFingerprint(fingerprint)
    } finally {
      if (currentDraftIdRef.current === requestDraftId) setSaving(false)
    }
  }, [draftId, project?.id, schema])

  const save = async () => {
    const next = candidateResult.value
    if (!next) {
      setSyncError(candidateResult.error || t('Draft SimulationParams are invalid.'))
      return
    }
    let currentValidation = validation
    if (!currentValidation || validatedFingerprint !== candidateResult.fingerprint) {
      try {
        setValidating(true)
        currentValidation = await api.validateDraftParameters(draftId, next)
        setValidation(currentValidation)
        setValidatedFingerprint(candidateResult.fingerprint)
      } catch (cause) {
        setSyncError(cleanError(cause))
        return
      } finally {
        setValidating(false)
      }
    }
    await persistCandidate(next, candidateResult.fingerprint)
  }

  useEffect(() => {
    if (!draftAutoSyncReady({
      dirty,
      saving,
      validating,
      candidate: candidateResult.value,
      fingerprint: candidateResult.fingerprint,
      validatedFingerprint,
      hasValidation: Boolean(validation),
      failedSyncFingerprint,
    })) return
    const next = candidateResult.value!
    const fingerprint = candidateResult.fingerprint
    const timer = window.setTimeout(() => void persistCandidate(next, fingerprint), 300)
    return () => window.clearTimeout(timer)
  }, [candidateResult.fingerprint, candidateResult.value, dirty, failedSyncFingerprint, persistCandidate, saving, validatedFingerprint, validating, validation])

  const reviewRunReady = draftReviewRunReady({
    dirty,
    saving,
    syncError,
    validationValid: validation?.valid === true,
    fingerprint: candidateResult.fingerprint,
    validatedFingerprint,
  })
  const firstValidationError = validation?.issues.find((issue) => issue.level === 'error')?.message
  const reviewRunStatus = syncError
    ? t('Retry Draft sync before Review & Run.')
    : dirty || saving
      ? t('Review & Run is available after the latest changes finish syncing.')
      : !validation || validatedFingerprint !== candidateResult.fingerprint
        ? t('Waiting for Flow360 validation before Review & Run.')
        : !validation.valid
          ? firstValidationError || t('Resolve the Flow360 validation errors before Review & Run.')
          : t('Latest Draft parameters are synced and ready for review.')

  if (readOnly) {
    return <JsonPreview value={previewValue} empty={t('Flow360 did not return simulation parameters.')} className="draft-json-preview" />
  }

  if (loading) {
    return <div className="detail-empty"><RefreshCw size={15} className="spin" /> {t('Loading the installed Flow360 schema…')}</div>
  }

  return (
    <div className="draft-parameter-editor">
      {project && resource && (
        <section className="draft-ai-config">
          <div><Sparkles size={15} /><span><strong>{t('Change this Draft with AI')}</strong><small>{t('Describe the engineering change. AI updates the same unsaved candidate shown in the form and JSON editor.')}</small></span></div>
          <div>
            <textarea value={aiPrompt} onChange={(event) => setAIPrompt(event.target.value)} placeholder={t('For example: change angle of attack to 5° and keep the current solver settings.')} />
            <button type="button" onClick={() => void fillWithAI()} disabled={aiLoading || !aiPrompt.trim()}>
              {aiLoading ? <RefreshCw size={13} className="spin" /> : <Sparkles size={13} />}
              {aiLoading ? t('Preparing changes…') : t('Apply AI changes')}
            </button>
          </div>
          {aiMessage && <small className="draft-ai-config-result"><CheckCircle2 size={13} />{aiMessage}</small>}
        </section>
      )}

      <div className="draft-parameter-toolbar">
        <div className="draft-editor-modes" role="tablist" aria-label={t('Draft parameter editor mode')}>
          <button type="button" role="tab" aria-selected={mode === 'form'} className={mode === 'form' ? 'active' : ''} disabled={!schema} onClick={() => selectMode('form')}>
            <ListTree size={13} /> {t('Form')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'json'} className={mode === 'json' ? 'active' : ''} onClick={() => selectMode('json')}>
            <Code2 size={13} /> {t('JSON')}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'active' : ''} onClick={() => selectMode('preview')}>
            <Eye size={13} /> {t('Preview')}
          </button>
        </div>
        <span className={`draft-unsaved-state ${syncError ? 'error' : saving ? 'syncing' : dirty ? 'dirty' : 'saved'}`}>
          {syncError ? t('Draft sync failed') : saving ? t('Syncing changes to Flow360…') : dirty ? t('Changes waiting to sync') : t('Draft is synced with Flow360')}
        </span>
      </div>

      {error && <div className="draft-parameter-message error" role="alert"><AlertCircle size={14} />{error}</div>}
      {syncError && <div className="draft-parameter-message error" role="alert"><AlertCircle size={14} />{syncError}</div>}
      {mode === 'form' && schema && (
        <div className="draft-parameter-form" role="tabpanel">
          <SchemaFormFields
            schema={schema}
            value={formValue}
            sparse
            showAll
            addLabel={t('Add')}
            removeLabel={t('Remove')}
            rootTabs
            collapsibleObjects
            expressionValidator={validateExpression}
            onChange={(next) => {
              setFormValue(next)
              setDirty(true)
              setSyncError('')
              setFailedSyncFingerprint('')
            }}
          />
        </div>
      )}
      {mode === 'json' && (
        <div role="tabpanel">
          <div className="draft-json-label">{t('Complete SimulationParams JSON')}</div>
          <JsonEditor
            ariaLabel={`Draft ${draftId} SimulationParams JSON`}
            value={jsonValue}
            onChange={(next) => {
              setJSONValue(next)
              setDirty(true)
              setSyncError('')
              setFailedSyncFingerprint('')
            }}
          />
        </div>
      )}
      {mode === 'preview' && (
        <div role="tabpanel">
          <JsonPreview value={previewValue} empty={t('No Draft parameters to preview.')} className="draft-json-preview" />
        </div>
      )}

      {(validating || (validation && !validation.valid)) && (
        <section className={`draft-validation-summary ${validating ? 'checking' : 'error'}`} aria-live="polite">
          {validating ? <RefreshCw size={15} className="spin" /> : <AlertCircle size={15} />}
          <span>
            <strong>{validating ? t('Checking changes…') : t('Fix these before running')}</strong>
            <small>{validating ? t('Flow360 is checking the latest Draft values.') : firstValidationError || t('Resolve the Flow360 validation errors before Review & Run.')}</small>
          </span>
        </section>
      )}
      {validation && !validation.valid && (
        <div className="draft-validation-issues">
          {validation.issues.filter((issue) => issue.level === 'error').map((issue, index) => (
            <div key={`${issue.path}-${issue.code}-${index}`}><code>{issue.path || 'SimulationParams'}</code><span>{issue.message}</span></div>
          ))}
        </div>
      )}

      {changes.length > 0 && <section className="draft-change-summary">
        <header><strong>{t('Unsaved parameter changes')}</strong><span>{changes.length}</span></header>
        {changes.slice(0, 20).map((change) => (
          <div key={change.path}><code>{change.path}</code><small>{compactValue(change.before)}</small><ArrowRight size={11} /><small>{compactValue(change.after)}</small></div>
        ))}
        {changes.length > 20 && <p>{t('{count} additional changes').replace('{count}', String(changes.length - 20))}</p>}
      </section>}

      <footer className="draft-config-actions">
        <span>{reviewRunStatus}</span>
        {syncError && <button
          type="button"
          className="draft-parameter-save"
          disabled={saving || validating || !candidateResult.value || Boolean(candidateResult.error) || (mode === 'json' && Boolean(jsonSyntaxIssue(jsonValue)))}
          onClick={() => void save()}
        >
          <RefreshCw size={13} className={saving ? 'spin' : ''} />
          {saving ? t('Syncing…') : t('Retry sync')}
        </button>}
        {onReviewRun && (
          <button type="button" className="draft-review-run" disabled={!reviewRunReady} title={reviewRunStatus} onClick={onReviewRun}><Play size={13} />{t('Run this Draft')}</button>
        )}
      </footer>
    </div>
  )
}

export function draftAutoSyncReady({
  dirty,
  saving,
  validating,
  candidate,
  fingerprint,
  validatedFingerprint,
  hasValidation,
  failedSyncFingerprint,
}: {
  dirty: boolean
  saving: boolean
  validating: boolean
  candidate: Record<string, unknown> | null
  fingerprint: string
  validatedFingerprint: string
  hasValidation: boolean
  failedSyncFingerprint: string
}) {
  return dirty
    && !saving
    && !validating
    && Boolean(candidate)
    && Boolean(fingerprint)
    && hasValidation
    && validatedFingerprint === fingerprint
    && failedSyncFingerprint !== fingerprint
}

export function draftReviewRunReady({
  dirty,
  saving,
  syncError,
  validationValid,
  fingerprint,
  validatedFingerprint,
}: {
  dirty: boolean
  saving: boolean
  syncError: string
  validationValid: boolean
  fingerprint: string
  validatedFingerprint: string
}) {
  return !dirty
    && !saving
    && !syncError
    && validationValid
    && Boolean(fingerprint)
    && validatedFingerprint === fingerprint
}

export function configuredExpressionPaths(schema: DynamicFormSchema, value: unknown, path = ''): string[] {
  if (schema.type === 'expression') {
    return isRecord(value) && value.type_name === 'expression' && typeof value.expression === 'string'
      ? [path]
      : []
  }
  if (schema.type === 'object') {
    if (!isRecord(value)) return []
    return Object.entries(schema.properties ?? {}).flatMap(([key, child]) => (
      Object.prototype.hasOwnProperty.call(value, key)
        ? configuredExpressionPaths(child, value[key], path ? `${path}.${key}` : key)
        : []
    ))
  }
  if (schema.type === 'array') {
    return Array.isArray(value)
      ? value.flatMap((item, index) => configuredExpressionPaths(schema.items ?? { type: 'json' }, item, `${path}.${index}`))
      : []
  }
  if (schema.type === 'union') {
    const variant = (schema.variants ?? []).find((candidate) => schemaValueMatchesForValidation(candidate, value))
    return variant ? configuredExpressionPaths(variant, value, path) : []
  }
  return []
}

function schemaValueMatchesForValidation(schema: DynamicFormSchema, value: unknown): boolean {
  if (schema.type === 'expression') return isRecord(value) && value.type_name === 'expression'
  if (schema.type === 'quantity') return isRecord(value) && 'value' in value && 'units' in value
  if (schema.type === 'object') return isRecord(value)
  if (schema.type === 'array') return Array.isArray(value)
  if (schema.type === 'string') return typeof value === 'string'
  if (schema.type === 'boolean') return typeof value === 'boolean'
  if (schema.type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (schema.type === 'number') return typeof value === 'number'
  return false
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

export function createJSONMergePatch(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.prototype.hasOwnProperty.call(after, key)) {
      patch[key] = null
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(before, key)) {
      patch[key] = after[key]
      continue
    }
    const previous = before[key]
    const next = after[key]
    if (isRecord(previous) && isRecord(next)) {
      const child = createJSONMergePatch(previous, next)
      if (Object.keys(child).length) patch[key] = child
    } else if (JSON.stringify(previous) !== JSON.stringify(next)) {
      patch[key] = next
    }
  }
  return patch
}

function compactValue(value: unknown) {
  if (value === undefined) return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 100 ? `${text.slice(0, 100)}…` : text
}
