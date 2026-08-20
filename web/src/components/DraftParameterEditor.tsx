import { AlertCircle, CheckCircle2, Code2, Eye, ListTree, Play, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { APIError, api, type DraftParameterValidationResponse, type DynamicFormSchema, type ProjectInfo, type ResourceNode } from '../api/client'
import { useI18n } from '../i18n'
import JsonEditor, { jsonSyntaxIssue } from './JsonEditor'
import JsonPreview from './JsonPreview'
import DraftAISession, { type DraftAISessionMessage } from './DraftAISession'
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
  const [canonicalCandidate, setCanonicalCandidate] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [failedSyncFingerprint, setFailedSyncFingerprint] = useState('')
  const [validation, setValidation] = useState<DraftParameterValidationResponse | null>(null)
  const [validating, setValidating] = useState(false)
  const [validatedDraftId, setValidatedDraftId] = useState('')
  const [validatedFingerprint, setValidatedFingerprint] = useState('')
  const [aiPrompt, setAIPrompt] = useState('')
  const [aiLoading, setAILoading] = useState(false)
  const [aiOpen, setAIOpen] = useState(false)
  const [aiMessages, setAIMessages] = useState<DraftAISessionMessage[]>([])
  const aiMessageIDRef = useRef(0)
  const latestFingerprintRef = useRef('')
  const validationRequestRef = useRef(0)
  const validationTimerRef = useRef<number | null>(null)
  const immediateValidationFingerprintRef = useRef('')
  const currentDraftIdRef = useRef(draftId)
  const onSavedRef = useRef(onSaved)

  currentDraftIdRef.current = draftId
  onSavedRef.current = onSaved

  useEffect(() => {
    setSyncError('')
    setFailedSyncFingerprint('')
    setSaving(false)
    setAILoading(false)
    setAIOpen(false)
    setAIPrompt('')
    setAIMessages([])
    setCanonicalCandidate(null)
    aiMessageIDRef.current = 0
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
        setCanonicalCandidate(null)
        setMode('form')
      })
      .catch((cause) => {
        if (!active) return
        setSchema(null)
        setMode('json')
        setError(`The Flow360 form schema is unavailable. You can still edit valid JSON. ${draftParameterErrorMessage(cause, t)}`)
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [draftId, readOnly])

  const candidateResult = useMemo(() => {
    try {
      const value = canonicalCandidate ?? (mode === 'json'
        ? parseParameterJSON(jsonValue)
        : mode === 'preview'
          ? isRecord(previewValue) ? previewValue : baseline
          : schema ? buildDraftParameters(schema, formValue) : baseline)
      return { value, fingerprint: JSON.stringify(value), error: '' }
    } catch (cause) {
      return { value: null, fingerprint: '', error: draftParameterErrorMessage(cause, t) }
    }
  }, [baseline, canonicalCandidate, formValue, jsonValue, mode, previewValue, schema])

  latestFingerprintRef.current = candidateResult.fingerprint

  const validateCandidate = useCallback(async (candidate: Record<string, unknown>, fingerprint: string) => {
    const requestDraftId = draftId
    const requestID = ++validationRequestRef.current
    setValidating(true)
    setValidation(null)
    setValidatedDraftId('')
    setValidatedFingerprint('')
    setError('')
    try {
      const response = await api.validateDraftParameters(draftId, candidate)
      if (
        currentDraftIdRef.current !== requestDraftId
        || validationRequestRef.current !== requestID
        || latestFingerprintRef.current !== fingerprint
      ) return null
      setValidation(response)
      setValidatedDraftId(requestDraftId)
      setValidatedFingerprint(fingerprint)
      return response
    } catch (cause) {
      if (
        currentDraftIdRef.current === requestDraftId
        && validationRequestRef.current === requestID
        && latestFingerprintRef.current === fingerprint
      ) {
        setValidation(null)
        setValidatedDraftId('')
        setValidatedFingerprint('')
        setError(draftParameterErrorMessage(cause, t))
      }
      return null
    } finally {
      if (currentDraftIdRef.current === requestDraftId && validationRequestRef.current === requestID) {
        setValidating(false)
      }
    }
  }, [draftId, t])

  useEffect(() => {
    validationRequestRef.current += 1
    setValidation(null)
    setValidatedDraftId('')
    setValidatedFingerprint('')
    setValidating(false)
    if (validationTimerRef.current !== null) window.clearTimeout(validationTimerRef.current)
    if (loading || readOnly || !candidateResult.value || !candidateResult.fingerprint) return
    const validateImmediately = immediateValidationFingerprintRef.current === candidateResult.fingerprint
    if (validateImmediately) immediateValidationFingerprintRef.current = ''
    validationTimerRef.current = window.setTimeout(() => {
      validationTimerRef.current = null
      void validateCandidate(candidateResult.value!, candidateResult.fingerprint)
    }, draftValidationDelay(dirty, validateImmediately))
    return () => {
      if (validationTimerRef.current !== null) {
        window.clearTimeout(validationTimerRef.current)
        validationTimerRef.current = null
      }
    }
  }, [candidateResult.fingerprint, candidateResult.value, dirty, loading, readOnly, validateCandidate])

  const selectMode = (nextMode: EditorMode) => {
    if (nextMode === mode) return
    try {
      if (nextMode === 'json') {
        if (canonicalCandidate) {
          setJSONValue(JSON.stringify(canonicalCandidate, null, 2))
        } else if (mode === 'form') {
          if (!schema) return
          const next = buildDraftParameters(schema, formValue)
          setJSONValue(JSON.stringify(next, null, 2))
        }
      } else if (nextMode === 'form') {
        if (!schema) throw new Error('The Flow360 form schema is unavailable.')
        const next = parseParameterJSON(jsonValue)
        setFormValue(hydrateSchemaValue(schema, next, true))
      } else {
        const next = canonicalCandidate ?? (mode === 'form'
          ? schema ? buildDraftParameters(schema, formValue) : baseline
          : parseParameterJSON(jsonValue))
        setPreviewValue(next)
        setJSONValue(JSON.stringify(next, null, 2))
      }
      setError('')
      setMode(nextMode)
    } catch (cause) {
      setError(draftParameterErrorMessage(cause, t))
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
    immediateValidationFingerprintRef.current = JSON.stringify(next)
    setCanonicalCandidate(next)
    setJSONValue(JSON.stringify(next, null, 2))
    setPreviewValue(next)
    if (schema) setFormValue(hydrateSchemaValue(schema, next, true))
    setError('')
    setDirty(true)
    setSyncError('')
    setFailedSyncFingerprint('')
    setValidation(null)
    setValidatedDraftId('')
    setValidatedFingerprint('')
  }

  const fillWithAI = async () => {
    if (!project || !resource || !aiPrompt.trim() || aiLoading) return
    const requestDraftId = draftId
    const prompt = aiPrompt.trim()
    const candidate = candidateResult.value ?? baseline
    const userMessageID = `${requestDraftId}-${++aiMessageIDRef.current}`
    setAIMessages((current) => [...current, { id: userMessageID, role: 'user', content: prompt }])
    setAIPrompt('')
    setAILoading(true)
    try {
      const response = await api.assistPlanForm({
        project_id: project.id,
        project_name: project.name,
        source_id: resource.id,
        source_type: resource.type,
        source_name: resource.name,
        draft_id: draftId,
        target: 'case',
        intent: prompt,
        prompt,
        patch: draftAIAssistPatch(baseline, candidate),
        history: draftAIConversationHistory(aiMessages),
        autonomous: true,
      })
      if (currentDraftIdRef.current !== requestDraftId) return
      if (!response.proposal) throw new Error(response.action.message || t('AI did not return parameter changes.'))
      const next = applyDraftAIProposal(baseline, candidate, response.proposal.patch)
      const aiChanges = diffParameterValues(candidate, next)
      const assistantMessageID = `${requestDraftId}-${++aiMessageIDRef.current}`
      applyCandidate(next)
      setAIMessages((current) => [...current, {
        id: assistantMessageID,
        role: 'assistant',
        content: response.action.message,
        changes: aiChanges,
      }])
    } catch (cause) {
      if (currentDraftIdRef.current !== requestDraftId) return
      const errorMessageID = `${requestDraftId}-${++aiMessageIDRef.current}`
      setAIMessages((current) => [...current, { id: errorMessageID, role: 'error', content: draftParameterErrorMessage(cause, t) }])
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
        setCanonicalCandidate(null)
        setJSONValue(JSON.stringify(canonical, null, 2))
        setPreviewValue(canonical)
        if (schema) setFormValue(hydrateSchemaValue(schema, canonical, true))
        setDirty(false)
        onSavedRef.current?.(canonical)
      }
    } catch (cause) {
      if (currentDraftIdRef.current !== requestDraftId) return
      setSyncError(draftParameterErrorMessage(cause, t))
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
        setValidatedDraftId(draftId)
        setValidatedFingerprint(candidateResult.fingerprint)
      } catch (cause) {
        setSyncError(draftParameterErrorMessage(cause, t))
        return
      } finally {
        setValidating(false)
      }
    }
    await persistCandidate(next, candidateResult.fingerprint)
  }

  const validateNow = () => {
    if (!candidateResult.value || !candidateResult.fingerprint || validating) return
    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current)
      validationTimerRef.current = null
    }
    void validateCandidate(candidateResult.value, candidateResult.fingerprint)
  }

  useEffect(() => {
    if (!draftAutoSyncReady({
      dirty,
      saving,
      validating,
      candidate: candidateResult.value,
      fingerprint: candidateResult.fingerprint,
      draftId,
      validatedDraftId,
      validatedFingerprint,
      hasValidation: Boolean(validation),
      validationValid: validation?.valid === true,
      failedSyncFingerprint,
    })) return
    const next = candidateResult.value!
    const fingerprint = candidateResult.fingerprint
    const timer = window.setTimeout(() => void persistCandidate(next, fingerprint), 300)
    return () => window.clearTimeout(timer)
  }, [candidateResult.fingerprint, candidateResult.value, dirty, draftId, failedSyncFingerprint, persistCandidate, saving, validatedDraftId, validatedFingerprint, validating, validation])

  const reviewRunReady = draftReviewRunReady({
    dirty,
    saving,
    syncError,
    validationValid: validation?.valid === true,
    draftId,
    validatedDraftId,
    fingerprint: candidateResult.fingerprint,
    validatedFingerprint,
  })
  const validationIsCurrent = draftValidationIsCurrent(
    draftId,
    validatedDraftId,
    candidateResult.fingerprint,
    validatedFingerprint,
    Boolean(validation),
  )
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

  const validationStatusClass = validating ? 'checking' : validationIsCurrent && validation?.valid ? 'ready' : validationIsCurrent && validation ? 'error' : 'idle'
  const validationStatusIcon = validating
    ? <RefreshCw size={14} className="spin" />
    : validationIsCurrent && validation?.valid
      ? <CheckCircle2 size={14} />
      : validationIsCurrent && validation
        ? <AlertCircle size={14} />
        : <ShieldCheck size={14} />
  const validationStatusTitle = validating
    ? t('Validating current parameters…')
    : validationIsCurrent && validation?.valid
      ? t('Flow360 validation passed')
      : validationIsCurrent && validation
        ? t('Flow360 validation needs attention')
        : t('Waiting for Flow360 validation')
  const validationStatusDetail = syncError
    ? syncError
    : saving
      ? t('Validation passed. Syncing these parameters to the Draft…')
      : dirty
        ? t('After validation passes, changes sync automatically to the Draft.')
        : validationIsCurrent && validation?.valid
          ? t('Latest Draft parameters are synced and ready for review.')
          : validationIsCurrent && validation && firstValidationError
            ? firstValidationError
            : t('Flow360 checks the current candidate before it is saved to the Draft.')

  if (readOnly) {
    return <JsonPreview value={previewValue} empty={t('Flow360 did not return simulation parameters.')} className="draft-json-preview" />
  }

  if (loading) {
    return <div className="detail-empty"><RefreshCw size={15} className="spin" /> {t('Loading the installed Flow360 schema…')}</div>
  }

  return (
    <div className={`draft-config-workspace${aiOpen ? ' ai-open' : ''}`}>
      <div className="draft-parameter-editor">
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
        <div className="draft-parameter-toolbar-actions">
          <details className={`draft-validation-popover ${validationStatusClass}`}>
            <summary aria-label={validationStatusTitle} title={validationStatusTitle}>
              {validationStatusIcon}
              <span>{validationStatusTitle}</span>
            </summary>
            <div>
              <strong>{syncError ? t('Draft sync failed') : saving ? t('Syncing changes to Flow360…') : dirty ? t('Changes waiting to sync') : t('Draft is synced with Flow360')}</strong>
              <p>{validationStatusDetail}</p>
              {validationIsCurrent && validation && !validation.valid && (
                <div className="draft-validation-popover-issues">
                  {validation.issues.filter((issue) => issue.level === 'error').slice(0, 6).map((issue, index) => (
                    <div key={`${issue.path}-${issue.code}-${index}`}><code>{issue.path || 'SimulationParams'}</code><span>{issue.message}</span></div>
                  ))}
                </div>
              )}
            </div>
          </details>
          {project && resource && <label className={`draft-ai-toggle${aiOpen ? ' active' : ''}`}>
            <input type="checkbox" checked={aiOpen} onChange={(event) => setAIOpen(event.target.checked)} aria-label={t(aiOpen ? 'Close AI Draft session' : 'Open AI Draft session')} />
            <span aria-hidden="true"><i /></span>
            <Sparkles size={13} />
            {t('AI modification')}
          </label>}
        </div>
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
              setCanonicalCandidate(null)
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
              setCanonicalCandidate(null)
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

      <footer className="draft-config-actions">
        <span>{reviewRunStatus}</span>
        <button
          type="button"
          className="draft-parameter-validate"
          disabled={validating || aiLoading || !candidateResult.value || Boolean(candidateResult.error) || (mode === 'json' && Boolean(jsonSyntaxIssue(jsonValue)))}
          onClick={validateNow}
        >
          {validating ? <RefreshCw size={13} className="spin" /> : <ShieldCheck size={13} />}
          {validating ? t('Validating current parameters…') : validationIsCurrent ? t('Validate again') : t('Validate')}
        </button>
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
      {project && resource && aiOpen && <DraftAISession
        messages={aiMessages}
        prompt={aiPrompt}
        loading={aiLoading}
        onPromptChange={setAIPrompt}
        onSubmit={() => void fillWithAI()}
        onClose={() => setAIOpen(false)}
      />}
    </div>
  )
}

export function draftAutoSyncReady({
  dirty,
  saving,
  validating,
  candidate,
  fingerprint,
  draftId,
  validatedDraftId,
  validatedFingerprint,
  hasValidation,
  validationValid,
  failedSyncFingerprint,
}: {
  dirty: boolean
  saving: boolean
  validating: boolean
  candidate: Record<string, unknown> | null
  fingerprint: string
  draftId: string
  validatedDraftId: string
  validatedFingerprint: string
  hasValidation: boolean
  validationValid: boolean
  failedSyncFingerprint: string
}) {
  return dirty
    && !saving
    && !validating
    && Boolean(candidate)
    && Boolean(draftId)
    && validatedDraftId === draftId
    && Boolean(fingerprint)
    && hasValidation
    && validationValid
    && validatedFingerprint === fingerprint
    && failedSyncFingerprint !== fingerprint
}

export function draftValidationDelay(dirty: boolean, immediate: boolean) {
  return immediate ? 0 : dirty ? 500 : 0
}

export function draftValidationIsCurrent(
  draftId: string,
  validatedDraftId: string,
  fingerprint: string,
  validatedFingerprint: string,
  hasValidation: boolean,
) {
  return hasValidation
    && Boolean(draftId)
    && validatedDraftId === draftId
    && Boolean(fingerprint)
    && validatedFingerprint === fingerprint
}

export function draftReviewRunReady({
  dirty,
  saving,
  syncError,
  validationValid,
  draftId,
  validatedDraftId,
  fingerprint,
  validatedFingerprint,
}: {
  dirty: boolean
  saving: boolean
  syncError: string
  validationValid: boolean
  draftId: string
  validatedDraftId: string
  fingerprint: string
  validatedFingerprint: string
}) {
  return !dirty
    && !saving
    && !syncError
    && validationValid
    && Boolean(draftId)
    && validatedDraftId === draftId
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
  if (schema.type === 'multi_select') return isRecord(value)
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

export function draftParameterErrorMessage(cause: unknown, t: (text: string) => string = (text) => text): string {
  if (cause instanceof APIError) {
    if (cause.code === 'flow360_release_not_supported') {
      return t('This Project uses Flow360 {cloudVersion} parameters. Upgrade Vibe Flow360 to a release that supports Flow360 {supportedRelease}.')
        .replace('{cloudVersion}', String(cause.details.cloud_version || ''))
        .replace('{supportedRelease}', String(cause.details.supported_release || ''))
    }
    if (cause.code === 'flow360_compatible_upgrade_failed') {
      return t('Vibe Flow360 could not update its Flow360 {supportedRelease} compatibility components automatically. Check the network connection and retry.')
        .replace('{supportedRelease}', String(cause.details.supported_release || ''))
    }
  }
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

export function draftAIAssistPatch(
  baseline: Record<string, unknown>,
  candidate: Record<string, unknown> | null,
) {
  return createJSONMergePatch(baseline, candidate ?? baseline)
}

export function draftAIConversationHistory(messages: DraftAISessionMessage[]) {
  return messages.flatMap((message) => (
    message.role === 'error' || !message.content.trim()
      ? []
      : [{ role: message.role, content: message.content }]
  ))
}

export function applyDraftAIProposal(
  baseline: Record<string, unknown>,
  candidate: Record<string, unknown> | null,
  proposalPatch: Record<string, unknown>,
) {
  return applyJSONMergePatch(candidate ?? baseline, proposalPatch)
}
