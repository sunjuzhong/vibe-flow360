import { AlertCircle, CheckCircle2, Code2, Eye, ListTree, Play, Redo2, RefreshCw, RotateCcw, Save, ShieldCheck, Sparkles, TriangleAlert, Undo2 } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { APIError, api, type DraftParameterValidationResponse, type DynamicFormSchema, type ProjectInfo, type ResourceNode } from '../api/client'
import { useI18n } from '../i18n'
import { candidateFingerprint, localDraftValidation, normalizeDraftValidation, type DraftValidationIssue } from '../lib/draftValidation'
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
  externalPatch?: { id: number; draftId: string; patch: Record<string, unknown> } | null
  onExternalPatchApplied?: (id: number) => void
  onDirtyChange?: (dirty: boolean) => void
  onCandidateChange?: (parameters: Record<string, unknown>) => void
  onRunReadinessChange?: (ready: boolean) => void
}

export type DraftParameterEditorHandle = {
  discard: () => void
  save: () => Promise<boolean>
}

type DraftEditorHistory = {
  past: Record<string, unknown>[]
  present: Record<string, unknown>
  future: Record<string, unknown>[]
}

const DraftParameterEditor = forwardRef<DraftParameterEditorHandle, Props>(function DraftParameterEditor({
  draftId,
  parameters,
  onSaved,
  onReviewRun,
  project,
  resource,
  readOnly = false,
  externalPatch,
  onExternalPatchApplied,
  onDirtyChange,
  onCandidateChange,
  onRunReadinessChange,
}, ref) {
  const { t } = useI18n()
  const initialBaseline = useMemo(() => parameters ?? {}, [parameters])
  const [baseline, setBaseline] = useState<Record<string, unknown>>(initialBaseline)
  const [schema, setSchema] = useState<DynamicFormSchema | null>(null)
  const [mode, setMode] = useState<EditorMode>('form')
  const [formValue, setFormValue] = useState<unknown>(initialBaseline)
  const [jsonValue, setJSONValue] = useState(() => JSON.stringify(initialBaseline, null, 2))
  const [previewValue, setPreviewValue] = useState<unknown>(initialBaseline)
  const [canonicalCandidate, setCanonicalCandidate] = useState<Record<string, unknown> | null>(null)
  const [history, setHistory] = useState<DraftEditorHistory>(() => ({ past: [], present: initialBaseline, future: [] }))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')
  const [schemaError, setSchemaError] = useState('')
  const [schemaLoadNonce, setSchemaLoadNonce] = useState(0)
  const [syncError, setSyncError] = useState('')
  const [validation, setValidation] = useState<DraftParameterValidationResponse | null>(null)
  const [validationError, setValidationError] = useState<{ kind: 'network' | 'schema'; message: string } | null>(null)
  const [validating, setValidating] = useState(false)
  const [validatedDraftId, setValidatedDraftId] = useState('')
  const [validatedFingerprint, setValidatedFingerprint] = useState('')
  const [focusedValidationIssue, setFocusedValidationIssue] = useState<{ id: string; path?: string; request: number } | null>(null)
  const [aiPrompt, setAIPrompt] = useState('')
  const [aiLoading, setAILoading] = useState(false)
  const [aiOpen, setAIOpen] = useState(false)
  const [aiMessages, setAIMessages] = useState<DraftAISessionMessage[]>([])
  const aiMessageIDRef = useRef(0)
  const jsonValueRef = useRef(jsonValue)
  const schemaLoadedDraftRef = useRef('')
  const latestFingerprintRef = useRef('')
  const validationRequestRef = useRef(0)
  const validationTimerRef = useRef<number | null>(null)
  const immediateValidationFingerprintRef = useRef('')
  const currentDraftIdRef = useRef(draftId)
  const onSavedRef = useRef(onSaved)
  const candidateValueRef = useRef<Record<string, unknown>>(initialBaseline)
  const saveRequestRef = useRef(0)
  const saveOperationRef = useRef(false)
  const initialValidationDoneRef = useRef(false)

  currentDraftIdRef.current = draftId
  onSavedRef.current = onSaved
  jsonValueRef.current = jsonValue

  useEffect(() => {
    setSyncError('')
    setSchemaError('')
    setValidationError(null)
    saveRequestRef.current += 1
    saveOperationRef.current = false
    setSaving(false)
    setAILoading(false)
    setAIOpen(false)
    setAIPrompt('')
    setAIMessages([])
    setCanonicalCandidate(null)
    aiMessageIDRef.current = 0
    initialValidationDoneRef.current = false
  }, [draftId])

  useEffect(() => {
    let active = true
    if (readOnly) {
      setLoading(false)
      setPreviewValue(initialBaseline)
      return () => { active = false }
    }
    const retrying = schemaLoadedDraftRef.current === draftId
    schemaLoadedDraftRef.current = draftId
    setLoading(true)
    setError('')
    setSchemaError('')
    if (!retrying) {
      setDirty(false)
      setJSONValue(JSON.stringify(initialBaseline, null, 2))
    }
    api.draftParameterSchema(draftId)
      .then((response) => {
        if (!active) return
        const canonical = response.baseline
        let editorCandidate = canonical
        if (retrying) {
          try {
            editorCandidate = parseParameterJSON(jsonValueRef.current)
          } catch { /* Invalid JSON remains in JSON mode; Form safely uses the synced baseline. */ }
        }
        setBaseline(canonical)
        setHistory({ past: [], present: editorCandidate, future: [] })
        setSchema(response.schema)
        setFormValue(hydrateSchemaValue(response.schema, editorCandidate, true))
        if (!retrying) setJSONValue(JSON.stringify(canonical, null, 2))
        setPreviewValue(editorCandidate)
        setCanonicalCandidate(null)
        if (!retrying || editorCandidate !== canonical) setMode('form')
      })
      .catch((cause) => {
        if (!active) return
        setSchema(null)
        setMode('json')
        setSchemaError(draftParameterErrorMessage(cause, t))
      })
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [draftId, readOnly, schemaLoadNonce])

  const candidateResult = useMemo(() => {
    try {
      const value = canonicalCandidate ?? (mode === 'json'
        ? parseParameterJSON(jsonValue)
        : mode === 'preview'
          ? isRecord(previewValue) ? previewValue : baseline
          : schema ? buildDraftParameters(schema, formValue) : baseline)
      return { value, fingerprint: candidateFingerprint(value), error: '' }
    } catch (cause) {
      return { value: null, fingerprint: '', error: draftParameterErrorMessage(cause, t) }
    }
  }, [baseline, canonicalCandidate, formValue, jsonValue, mode, previewValue, schema])

  latestFingerprintRef.current = candidateResult.fingerprint
  const localValidation = useMemo(
    () => localDraftValidation(schema, candidateResult.value, candidateResult.error),
    [candidateResult.error, candidateResult.value, schema],
  )
  if (candidateResult.value) candidateValueRef.current = candidateResult.value

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])
  useEffect(() => {
    if (candidateResult.value) onCandidateChange?.(candidateResult.value)
  }, [candidateResult.fingerprint, candidateResult.value, onCandidateChange])

  const validateCandidate = useCallback(async (candidate: Record<string, unknown>, fingerprint: string) => {
    const requestDraftId = draftId
    const requestID = ++validationRequestRef.current
    setValidating(true)
    setValidation(null)
    setValidatedDraftId('')
    setValidatedFingerprint('')
    setError('')
    setValidationError(null)
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
        setValidationError({ kind: draftValidationFailureKind(cause), message: draftParameterErrorMessage(cause, t) })
      }
      return null
    } finally {
      if (currentDraftIdRef.current === requestDraftId && validationRequestRef.current === requestID) {
        setValidating(false)
      }
    }
  }, [draftId, t])

  useEffect(() => {
    if (loading || readOnly || !candidateResult.value || !candidateResult.fingerprint || localValidation.blocking) return
    const validateImmediately = immediateValidationFingerprintRef.current === candidateResult.fingerprint
    if (validateImmediately) immediateValidationFingerprintRef.current = ''
    if (!validateImmediately && initialValidationDoneRef.current) return
    initialValidationDoneRef.current = true
    validationRequestRef.current += 1
    setValidatedDraftId('')
    setValidatedFingerprint('')
    setValidating(false)
    setValidation(null)
    setValidationError(null)
    if (validationTimerRef.current !== null) window.clearTimeout(validationTimerRef.current)
    const candidate = candidateValueRef.current
    validationTimerRef.current = window.setTimeout(() => {
      validationTimerRef.current = null
      void validateCandidate(candidate, candidateResult.fingerprint)
    }, draftValidationDelay(dirty, validateImmediately))
    return () => {
      if (validationTimerRef.current !== null) {
        window.clearTimeout(validationTimerRef.current)
        validationTimerRef.current = null
      }
    }
  }, [candidateResult.fingerprint, dirty, loading, localValidation.blocking, readOnly, validateCandidate])

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

  const moveModeFocus = (event: KeyboardEvent<HTMLButtonElement>, currentMode: 'form' | 'json') => {
    const availableModes: Array<'form' | 'json'> = schema ? ['form', 'json'] : ['json']
    const currentIndex = Math.max(0, availableModes.indexOf(currentMode))
    let nextMode: 'form' | 'json' | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextMode = availableModes[(currentIndex + 1) % availableModes.length]
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextMode = availableModes[(currentIndex - 1 + availableModes.length) % availableModes.length]
    if (event.key === 'Home') nextMode = availableModes[0]
    if (event.key === 'End') nextMode = availableModes.at(-1)
    if (!nextMode) return
    event.preventDefault()
    selectMode(nextMode)
    document.getElementById(`draft-editor-mode-${nextMode}`)?.focus()
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

  const replaceCandidate = useCallback((next: Record<string, unknown>, jsonText?: string) => {
    setCanonicalCandidate(next)
    setJSONValue(jsonText ?? JSON.stringify(next, null, 2))
    setPreviewValue(next)
    if (schema) setFormValue(hydrateSchemaValue(schema, next, true))
    setError('')
    setDirty(candidateFingerprint(next) !== candidateFingerprint(baseline))
    setSyncError('')
  }, [baseline, schema])

  const applyCandidate = useCallback((next: Record<string, unknown>, jsonText?: string) => {
    setHistory((current) => {
      if (candidateFingerprint(current.present) === candidateFingerprint(next)) return current
      return { past: [...current.past, current.present].slice(-100), present: next, future: [] }
    })
    replaceCandidate(next, jsonText)
  }, [replaceCandidate])

  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current.past.at(-1)
      if (!previous) return current
      replaceCandidate(previous)
      return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] }
    })
  }, [replaceCandidate])

  const redo = useCallback(() => {
    setHistory((current) => {
      const next = current.future[0]
      if (!next) return current
      replaceCandidate(next)
      return { past: [...current.past, current.present], present: next, future: current.future.slice(1) }
    })
  }, [replaceCandidate])

  const discard = useCallback(() => {
    setHistory({ past: [], present: baseline, future: [] })
    replaceCandidate(baseline)
    setCanonicalCandidate(null)
    setDirty(false)
    setSyncError('')
  }, [baseline, replaceCandidate])

  useEffect(() => {
    if (loading || !externalPatch || externalPatch.draftId !== draftId) return
    applyCandidate(applyJSONMergePatch(candidateValueRef.current, externalPatch.patch))
    onExternalPatchApplied?.(externalPatch.id)
  }, [applyCandidate, draftId, externalPatch, loading, onExternalPatchApplied])

  const fillWithAI = async () => {
    if (!project || !resource || !aiPrompt.trim() || aiLoading) return
    const requestDraftId = draftId
    const prompt = aiPrompt.trim()
    const candidate = candidateResult.value ?? baseline
    const requestFingerprint = candidateFingerprint(candidate)
    const userMessageID = `${requestDraftId}-${++aiMessageIDRef.current}`
    setAIMessages((current) => [...current, { id: userMessageID, role: 'user', content: prompt }])
    setAIPrompt('')
    setAILoading(true)
    try {
      const target = resourceTargetType(resource.type)
      const response = await api.assistPlanForm({
        project_id: project.id,
        project_name: project.name,
        source_id: resource.id,
        source_type: resource.type,
        source_name: resource.name,
        draft_id: draftId,
        target,
        intent: prompt,
        prompt,
        patch: draftAIAssistPatch(baseline, candidate),
        history: draftAIConversationHistory(aiMessages),
        autonomous: true,
      })
      if (currentDraftIdRef.current !== requestDraftId) return
      if (latestFingerprintRef.current !== requestFingerprint) throw new Error(t('The Draft changed while AI was preparing a response. Review the latest candidate and ask again.'))
      if (!response.proposal) throw new Error(response.action.message || t('AI did not return parameter changes.'))
      const next = applyDraftAIProposal(baseline, candidate, response.proposal.patch)
      const aiChanges = diffParameterValues(candidate, next)
      const assistantMessageID = `${requestDraftId}-${++aiMessageIDRef.current}`
      immediateValidationFingerprintRef.current = candidateFingerprint(next)
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
    const requestID = ++saveRequestRef.current
    try {
      setSaving(true)
      setSyncError('')
      const response = await api.updateDraftParameters(draftId, next, project?.id)
      if (currentDraftIdRef.current !== requestDraftId || saveRequestRef.current !== requestID) return false
      const canonical = response.simulation_params
      setBaseline(canonical)
      if (latestFingerprintRef.current === fingerprint) {
        setHistory({ past: [], present: canonical, future: [] })
        setCanonicalCandidate(null)
        setJSONValue(JSON.stringify(canonical, null, 2))
        setPreviewValue(canonical)
        if (schema) setFormValue(hydrateSchemaValue(schema, canonical, true))
        setDirty(false)
        onSavedRef.current?.(canonical)
        return true
      }
      return false
    } catch (cause) {
      if (currentDraftIdRef.current !== requestDraftId || saveRequestRef.current !== requestID) return false
      setSyncError(draftParameterErrorMessage(cause, t))
      return false
    } finally {
      if (currentDraftIdRef.current === requestDraftId && saveRequestRef.current === requestID) setSaving(false)
    }
  }, [draftId, project?.id, schema])

  const save = useCallback(async () => {
    if (saveOperationRef.current) return false
    saveOperationRef.current = true
    try {
      const next = candidateResult.value
      const fingerprint = candidateResult.fingerprint
      if (!next) {
        setSyncError(candidateResult.error || t('Draft SimulationParams are invalid.'))
        return false
      }
      const currentValidation = await validateCandidate(next, fingerprint)
      if (!currentValidation || latestFingerprintRef.current !== fingerprint) return false
      const normalized = normalizeDraftValidation(currentValidation, schema)
      if (normalized.blocking) return false
      return await persistCandidate(next, fingerprint)
    } finally {
      saveOperationRef.current = false
    }
  }, [candidateResult.error, candidateResult.fingerprint, candidateResult.value, persistCandidate, schema, t, validateCandidate])

  useImperativeHandle(ref, () => ({ discard, save }), [discard, save])

  const validateNow = () => {
    if (!candidateResult.value || !candidateResult.fingerprint || validating) return
    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current)
      validationTimerRef.current = null
    }
    void validateCandidate(candidateResult.value, candidateResult.fingerprint)
  }

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
  useEffect(() => onRunReadinessChange?.(reviewRunReady), [onRunReadinessChange, reviewRunReady])
  const validationIsCurrent = draftValidationIsCurrent(
    draftId,
    validatedDraftId,
    candidateResult.fingerprint,
    validatedFingerprint,
    Boolean(validation),
  )
  const normalizedValidation = useMemo(
    () => normalizeDraftValidation(validationIsCurrent ? validation : null, schema),
    [schema, validation, validationIsCurrent],
  )
  const validationIssues = normalizedValidation.issues.map((issue) => ({ ...issue, message: t(issue.message) }))
  const validationErrors = validationIssues.filter((issue) => issue.severity === 'error')
  const validationWarnings = validationIssues.filter((issue) => issue.severity === 'warning')
  const localizedLocalIssues = localValidation.issues.map((issue) => ({ ...issue, message: t(issue.message) }))
  const displayedIssues = [...localizedLocalIssues, ...validationIssues]
  const displayedErrors = displayedIssues.filter((issue) => issue.severity === 'error')
  const displayedWarnings = displayedIssues.filter((issue) => issue.severity === 'warning')
  const globalIssues = displayedIssues.filter((issue) => issue.mapping === 'global')
  const goToValidationError = (index: number) => {
    if (validationErrors.length === 0) return
    const normalizedIndex = (index + validationErrors.length) % validationErrors.length
    goToValidationIssue(validationErrors[normalizedIndex])
  }
  const goToValidationIssue = (issue: DraftValidationIssue) => {
    if (issue.mapping === 'global' || !issue.path || !schema) {
      selectMode('json')
    } else {
      selectMode('form')
    }
    setFocusedValidationIssue((current) => ({
      id: issue.id,
      path: issue.path,
      request: (current?.request ?? 0) + 1,
    }))
  }

  useEffect(() => {
    setFocusedValidationIssue(null)
  }, [draftId, validatedFingerprint])
  const focusedErrorIndex = validationErrors.findIndex((issue) => issue.id === focusedValidationIssue?.id)
  const reviewRunStatus = syncError
    ? t('Retry saving this Draft before Review & Run.')
    : dirty || saving
      ? t('Save the current candidate before running this Draft.')
      : !validation || validatedFingerprint !== candidateResult.fingerprint
        ? t('Waiting for Flow360 validation before Review & Run.')
        : !validation.valid
          ? t('Resolve the Flow360 validation errors before Review & Run.')
          : t('The current Draft version is saved, validated, and ready to run.')

  const validationStatusClass = validating
    ? 'checking'
    : localValidation.blocking || validationError || validationIsCurrent && normalizedValidation.blocking
      ? 'error'
      : validationIsCurrent && validationWarnings.length
        ? 'warning'
        : validationIsCurrent && validation?.valid
          ? 'ready'
          : 'idle'
  const validationStatusIcon = validating
    ? <RefreshCw size={14} className="spin" />
    : localValidation.blocking || validationError || validationIsCurrent && normalizedValidation.blocking
        ? <AlertCircle size={14} />
        : validationIsCurrent && validationWarnings.length
          ? <TriangleAlert size={14} />
          : validationIsCurrent && validation?.valid
            ? <CheckCircle2 size={14} />
            : <ShieldCheck size={14} />
  const validationStatusTitle = validating
    ? t('Validating current parameters…')
    : localValidation.blocking
        ? t('Fix local input errors')
        : validationError
          ? validationError.kind === 'network' ? t('Validation connection failed') : t('Flow360 schema validation is unavailable')
          : validationIsCurrent && normalizedValidation.blocking
            ? t('Flow360 validation needs attention')
            : validationIsCurrent && validationWarnings.length
              ? t('Flow360 validation passed with warnings')
              : validationIsCurrent && validation?.valid
                ? t('Flow360 validation passed')
                : t('Waiting for Flow360 validation')
  const validationStatusDetail = syncError
    ? syncError
    : localValidation.issues[0]?.message
      ? localValidation.issues[0].message
      : validationError?.message
        ? validationError.message
        : saving
          ? t('Validation passed. Saving this exact version to the Draft…')
          : dirty
            ? t('Changes remain local until you choose Save to Draft.')
            : validationIsCurrent && normalizedValidation.blocking
              ? t('{count} Flow360 validation errors need attention.').replace('{count}', String(validationErrors.length))
              : validationIsCurrent && validationWarnings.length
                ? t('Warnings are shown explicitly but do not block saving. Review them before continuing.')
                : validationIsCurrent && validation?.valid
                  ? dirty ? t('Validation passed. Save this exact version when ready.') : t('The current Draft version is saved and validated.')
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
          <button id="draft-editor-mode-form" type="button" role="tab" aria-controls="draft-editor-panel-form" aria-selected={mode === 'form'} tabIndex={mode === 'json' ? -1 : 0} className={mode === 'form' ? 'active' : ''} disabled={!schema} onKeyDown={(event) => moveModeFocus(event, 'form')} onClick={() => selectMode('form')}>
            <ListTree size={13} /> {t('Form')}
          </button>
          <button id="draft-editor-mode-json" type="button" role="tab" aria-controls="draft-editor-panel-json" aria-selected={mode === 'json'} tabIndex={mode === 'json' ? 0 : -1} className={mode === 'json' ? 'active' : ''} onKeyDown={(event) => moveModeFocus(event, 'json')} onClick={() => selectMode('json')}>
            <Code2 size={13} /> {t('JSON')}
          </button>
        </div>
        <div className="draft-parameter-toolbar-actions">
          <button type="button" onClick={undo} disabled={history.past.length === 0 || saving} aria-label={t('Undo Draft change')} title={t('Undo Draft change')}><Undo2 size={13} />{t('Undo')}</button>
          <button type="button" onClick={redo} disabled={history.future.length === 0 || saving} aria-label={t('Redo Draft change')} title={t('Redo Draft change')}><Redo2 size={13} />{t('Redo')}</button>
          <button type="button" className={`draft-preview-action${mode === 'preview' ? ' active' : ''}`} aria-pressed={mode === 'preview'} onClick={() => selectMode(mode === 'preview' ? 'form' : 'preview')}>
            <Eye size={13} /> {mode === 'preview' ? t('Return to edit') : t('Preview')}
          </button>
          <details className={`draft-validation-popover ${validationStatusClass}`}>
            <summary aria-label={validationStatusTitle} title={validationStatusTitle}>
              {validationStatusIcon}
              <span>{validationStatusTitle}</span>
            </summary>
            <div aria-label={t('Draft validation summary')}>
              <strong>{syncError ? t('Draft save failed') : saving ? t('Saving changes to Flow360…') : dirty ? t('Unsaved local changes') : t('Draft matches the saved Flow360 version')}</strong>
              <p>{validationStatusDetail}</p>
              {displayedIssues.length > 0 && (
                <>
                  <div className="draft-validation-popover-navigation">
                    <span>{displayedErrors.length} {t('errors')} · {displayedWarnings.length} {t('warnings')}</span>
                    {validationErrors.length > 0 && <button type="button" onClick={() => goToValidationError(0)}>{t('First error')}</button>}
                    {validationErrors.length > 0 && <button type="button" onClick={() => goToValidationError(focusedErrorIndex + 1)}>{t('Next error')}</button>}
                  </div>
                  {globalIssues.length > 0 && <div className="draft-validation-popover-issues">
                    {globalIssues.map((issue) => (
                      <button
                        type="button"
                        className={`${issue.severity}${focusedValidationIssue?.id === issue.id ? ' active' : ''}`}
                        key={issue.id}
                        onClick={() => goToValidationIssue(issue)}
                      >
                        <code>{t('General Draft issue')}</code>
                        <span><b>{issue.severity === 'warning' ? t('Warning') : t('Error')}</b>{issue.message}</span>
                        <small>{t('No matching form field. Open JSON to inspect the complete candidate.')}</small>
                      </button>
                    ))}
                  </div>}
                </>
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

      <span className="sr-only" role="status" aria-live="polite">{validationStatusTitle}. {validationStatusDetail}</span>
      {error && <div className="draft-parameter-message error" role="alert"><AlertCircle size={14} />{error}</div>}
      {schemaError && <div className="draft-parameter-recovery error" role="alert">
        <AlertCircle size={15} />
        <span><strong>{t('Flow360 form schema is unavailable')}</strong><small>{schemaError} {t('You can keep editing complete JSON while the form schema is unavailable.')}</small></span>
        <button type="button" onClick={() => setSchemaLoadNonce((current) => current + 1)}><RefreshCw size={13} />{t('Retry schema')}</button>
      </div>}
      {validationError && <div className="draft-parameter-recovery error" role="alert">
        <AlertCircle size={15} />
        <span><strong>{validationError.kind === 'network' ? t('Validation connection failed') : t('Flow360 schema validation is unavailable')}</strong><small>{validationError.message} {t('Your candidate is still local and has not been overwritten.')}</small></span>
        <button type="button" disabled={!candidateResult.value} onClick={validateNow}><RefreshCw size={13} />{t('Retry validation')}</button>
      </div>}
      {syncError && <div className="draft-parameter-recovery error" role="alert">
        <AlertCircle size={15} />
        <span><strong>{t('Draft save failed')}</strong><small>{syncError} {t('The candidate and its edit history remain local. Retry when the connection is available.')}</small></span>
      </div>}
      {localValidation.issues.some((issue) => issue.code === 'json_syntax') && <div className="draft-parameter-recovery error" role="alert">
        <Code2 size={15} />
        <span><strong>{t('JSON syntax needs attention')}</strong><small>{localValidation.issues[0].message} {t('Fix the JSON syntax before Flow360 validation can run.')}</small></span>
        <button type="button" onClick={() => {
          discard()
        }}>{t('Discard changes')}</button>
      </div>}
      {mode === 'form' && schema && (
        <div id="draft-editor-panel-form" className="draft-parameter-form" role="tabpanel" aria-labelledby="draft-editor-mode-form">
          <SchemaFormFields
            schema={schema}
            value={formValue}
            baseline={baseline}
            sparse
            showAll
            addLabel={t('Add')}
            removeLabel={t('Remove')}
            rootTabs
            collapsibleObjects
            expressionValidator={validateExpression}
            issues={[...localizedLocalIssues, ...validationIssues]
              .filter((issue) => Boolean(issue.path))
              .map((issue) => ({ path: issue.path, message: issue.message, level: issue.severity }))}
            focusIssuePath={focusedValidationIssue?.path}
            focusIssueRequest={focusedValidationIssue?.request}
            onChange={(next) => {
              applyCandidate(buildDraftParameters(schema, next))
            }}
          />
        </div>
      )}
      {mode === 'json' && (
        <div id="draft-editor-panel-json" role="tabpanel" aria-labelledby="draft-editor-mode-json">
          <div className="draft-json-label">{t('Complete SimulationParams JSON')}</div>
          <JsonEditor
            ariaLabel={`Draft ${draftId} SimulationParams JSON`}
            value={jsonValue}
            onChange={(next) => {
              setCanonicalCandidate(null)
              setJSONValue(next)
              setDirty(true)
              setSyncError('')
              try {
                applyCandidate(parseParameterJSON(next), next)
              } catch { /* Keep invalid JSON local without replacing the last valid history entry. */ }
            }}
          />
        </div>
      )}
      {mode === 'preview' && (
        <div role="region" aria-label={t('Draft parameter preview')}>
          <JsonPreview value={previewValue} empty={t('No Draft parameters to preview.')} className="draft-json-preview" />
        </div>
      )}

      <footer className="draft-config-actions">
        <span>{reviewRunStatus}</span>
        <button
          type="button"
          className="draft-parameter-validate"
          disabled={validating || aiLoading || !candidateResult.value || localValidation.blocking || (mode === 'json' && Boolean(jsonSyntaxIssue(jsonValue)))}
          onClick={validateNow}
        >
          {validating ? <RefreshCw size={13} className="spin" /> : <ShieldCheck size={13} />}
          {validating ? t('Validating current parameters…') : validationIsCurrent ? t('Validate again') : t('Validate')}
        </button>
        <button type="button" className="draft-parameter-discard" disabled={!dirty || saving} onClick={discard}>
          <RotateCcw size={13} />{t('Discard changes')}
        </button>
        <button
          type="button"
          className="draft-parameter-save"
          disabled={!dirty || saving || validating || !candidateResult.value || Boolean(candidateResult.error) || localValidation.blocking || (mode === 'json' && Boolean(jsonSyntaxIssue(jsonValue)))}
          onClick={() => void save()}
        >
          {saving ? <RefreshCw size={13} className="spin" /> : <Save size={13} />}
          {saving ? t('Saving…') : syncError ? t('Retry save') : t('Save to Draft')}
        </button>
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
})

export default DraftParameterEditor

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
  const message = (cause instanceof Error ? cause.message : String(cause)).replace(/^Error:\s*/, '')
  if (message.includes('Draft metadata is unavailable')) {
    return t('Draft metadata is still loading. Please wait a moment and try again.')
  }
  return message
}

export function draftValidationFailureKind(cause: unknown): 'network' | 'schema' {
  if (cause instanceof TypeError || /failed to fetch|network|connection|offline/i.test(cause instanceof Error ? cause.message : String(cause))) {
    return 'network'
  }
  if (cause instanceof APIError && (cause.status === 408 || cause.status === 429)) return 'network'
  return 'schema'
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

function resourceTargetType(resourceType: string): string {
  const normalized = resourceType.toLowerCase().replace(/[_\s]/g, '-')
  const targetMap: Record<string, string> = {
    'geometry': 'case',
    'surface-mesh': 'volume-mesh',
    'surfacemesh': 'volume-mesh',
    'volume-mesh': 'case',
    'volumemesh': 'case',
    'case': 'case',
  }
  return targetMap[normalized] || 'case'
}
