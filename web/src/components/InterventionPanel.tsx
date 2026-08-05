import { AlertCircle, ChevronRight, Loader2, Sparkles, X, CheckCircle2, AlertTriangle, RefreshCw, Send } from 'lucide-react'
import { FormEvent, useEffect, useState } from 'react'
import { api, type Intervention } from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'
import AgentClarificationDialog, { type ClarificationAnswers } from './AgentClarificationDialog'

const stateLabels: Record<string, string> = {
  observation: 'Observing',
  diagnosis: 'Diagnosing',
  missing_input: 'Needs input',
  proposal: 'Awaiting selection',
  user_feedback: 'Awaiting feedback',
  patch_compile: 'Compiling patch',
  validation: 'Validating',
  resolved: 'Resolved',
  failed: 'Failed',
  closed: 'Closed',
}

const stateColors: Record<string, string> = {
  observation: 'state-observation',
  diagnosis: 'state-diagnosis',
  missing_input: 'state-feedback',
  proposal: 'state-proposal',
  user_feedback: 'state-feedback',
  patch_compile: 'state-compile',
  validation: 'state-validation',
  resolved: 'state-resolved',
  failed: 'state-failed',
  closed: 'state-closed',
}

const typeLabels: Record<string, string> = {
  preflight_error: 'Preflight error',
  mesh_failure: 'Mesh failure',
  solver_failure: 'Solver failure',
  convergence_anomaly: 'Convergence anomaly',
  remote_error: 'Remote error',
}

export function chooseIntervention(
  interventions: Intervention[] | null | undefined,
  planId?: string,
  currentId?: string,
): Intervention | null {
  if (!interventions?.length) return null
  if (currentId) {
    const current = interventions.find((item) => item.id === currentId)
    if (current) return current
  }
  return interventions.find((item) => item.plan_id === planId)
    ?? interventions.find((item) => item.state !== 'resolved' && item.state !== 'closed')
    ?? interventions[0]
    ?? null
}

export default function InterventionPanel({
  open,
  onClose,
  projectId,
  resourceId,
  planId,
}: {
  open: boolean
  onClose: () => void
  projectId: string
  resourceId?: string
  planId?: string
}) {
  const [interventions, setInterventions] = useState<Intervention[]>([])
  const [selected, setSelected] = useState<Intervention | null>(null)
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [clarificationOpen, setClarificationOpen] = useState(false)
  const panelRef = useFocusTrap(open, onClose, 'textarea,button.primary,button:not(.icon-button)')

  const loadInterventions = async () => {
    try {
      const response = await api.interventions(projectId)
      const items = response.interventions ?? []
      setInterventions(items)
      setSelected((current) => chooseIntervention(items, planId, current?.id))
    } catch {
      setError('Failed to load interventions')
    }
  }

  useEffect(() => {
    if (!open) return
    void loadInterventions()
    const timer = window.setInterval(() => void loadInterventions(), 2000)
    return () => window.clearInterval(timer)
  }, [open, projectId, planId])

  useEffect(() => {
    setClarificationOpen(Boolean(selected?.state === 'missing_input' && selected.pending_questions?.length))
  }, [selected?.id, selected?.state])

  const handleDiagnose = async () => {
    if (!selected || loading) return
    setLoading(true)
    setAction('diagnose')
    setError('')
    try {
      const result = await api.diagnoseIntervention(selected.id)
      setSelected(result)
      updateIntervention(result)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  const handleGenerateProposals = async () => {
    if (!selected || loading) return
    setLoading(true)
    setAction('proposals')
    setError('')
    try {
      const result = await api.generateInterventionProposals(selected.id)
      setSelected(result)
      updateIntervention(result)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  const handleClarification = async (answers: ClarificationAnswers) => {
    if (!selected || loading) return
    setLoading(true)
    setAction('clarification')
    setError('')
    try {
      const result = await api.answerInterventionQuestions(selected.id, answers)
      setSelected(result)
      updateIntervention(result)
      setClarificationOpen(Boolean(result.state === 'missing_input' && result.pending_questions?.length))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  const handleSelectProposal = async (proposalId: string) => {
    if (!selected || loading) return
    setLoading(true)
    setAction('select')
    setError('')
    try {
      const result = await api.selectInterventionProposal(selected.id, proposalId, feedback)
      setSelected(result)
      updateIntervention(result)
      setFeedback('')
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  const handleCompile = async () => {
    if (!selected || loading) return
    setLoading(true)
    setAction('compile')
    setError('')
    try {
      const result = await api.compileInterventionPatch(selected.id, feedback)
      setSelected(result)
      updateIntervention(result)
      setFeedback('')
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  const handleValidate = async () => {
    if (!selected || loading) return
    setLoading(true)
    setAction('validate')
    setError('')
    try {
      const result = await api.validateIntervention(selected.id)
      setSelected(result)
      updateIntervention(result)
      window.dispatchEvent(new Event('vibesim:plans-refresh'))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  const handleClose = async () => {
    if (!selected || loading) return
    setLoading(true)
    setError('')
    try {
      const result = await api.closeIntervention(selected.id)
      setSelected(result)
      updateIntervention(result)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setLoading(false)
    }
  }

  const updateIntervention = (updated: Intervention) => {
    setInterventions((current) => current.map((item) => item.id === updated.id ? updated : item))
  }

  const onFeedbackSubmit = (event: FormEvent) => {
    event.preventDefault()
  }

  if (!open) return null

  const activeInterventions = interventions.filter((i) => i.state !== 'closed' && i.state !== 'resolved')
  const resolvedInterventions = interventions.filter((i) => i.state === 'resolved' || i.state === 'closed')

  return (
    <div className="intervention-overlay" role="presentation">
      <section
        ref={panelRef}
        className="intervention-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Agent intervention recovery"
      >
        <header className="panel-header">
          <span className="panel-header-icon"><Sparkles size={18} /></span>
          <div><strong>Agent Recovery</strong><span>Automated issue diagnosis and resolution</span></div>
          <button className="icon-button" onClick={onClose} aria-label="Close intervention"><X size={18} /></button>
        </header>

        <div className="panel-layout">
          <aside className="panel-history">
            <p>ACTIVE INTERVENTIONS</p>
            {activeInterventions.length > 0 ? (
              activeInterventions.map((intervention) => (
                <button
                  className={selected?.id === intervention.id ? 'active' : ''}
                  key={intervention.id}
                  onClick={() => { setSelected(intervention); setError('') }}
                >
                  <span>
                    <strong>{typeLabels[intervention.type] || intervention.type}</strong>
                    <small className={stateColors[intervention.state]}>
                      {stateLabels[intervention.state] || intervention.state}
                    </small>
                  </span>
                  <span className="confidence-chip">
                    {Math.round(intervention.confidence * 100)}%
                  </span>
                </button>
              ))
            ) : (
              <div className="panel-history-empty">No active interventions.</div>
            )}

            {resolvedInterventions.length > 0 && (
              <>
                <p>RESOLVED</p>
                {resolvedInterventions.map((intervention) => (
                  <button
                    className={selected?.id === intervention.id ? 'active' : ''}
                    key={intervention.id}
                    onClick={() => { setSelected(intervention); setError('') }}
                  >
                    <span>
                      <strong>{typeLabels[intervention.type] || intervention.type}</strong>
                      <small className={stateColors[intervention.state]}>
                        {stateLabels[intervention.state] || intervention.state}
                      </small>
                    </span>
                  </button>
                ))}
              </>
            )}
          </aside>

          <main className="panel-main">
            {selected ? (
              <div className="intervention-detail">
                <div className="intervention-header">
                  <div>
                    <h2>{typeLabels[selected.type] || selected.type}</h2>
                    <p>{selected.reason}</p>
                  </div>
                  <span className={`intervention-state ${stateColors[selected.state]}`}>
                    {stateLabels[selected.state] || selected.state}
                  </span>
                </div>

                <div className="confidence-bar">
                  <span>Confidence</span>
                  <div className="confidence-track">
                    <div className="confidence-fill" style={{ width: `${selected.confidence * 100}%` }} />
                  </div>
                  <strong>{Math.round(selected.confidence * 100)}%</strong>
                </div>

                {selected.diagnosis && (
                  <section className="intervention-section">
                    <h3><AlertTriangle size={15} /> Diagnosis</h3>
                    <div className="diagnosis-card">
                      <p><strong>Root cause:</strong> {selected.diagnosis.root_cause}</p>
                      <p><strong>Category:</strong> {selected.diagnosis.category}</p>
                      <p><strong>Severity:</strong> {selected.diagnosis.severity}</p>
                      {selected.diagnosis.contributing_factors && selected.diagnosis.contributing_factors.length > 0 && (
                        <>
                          <small><strong>Contributing factors:</strong></small>
                          <ul>
                            {selected.diagnosis.contributing_factors.map((factor, index) => (
                              <li key={index}>{factor}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </div>
                  </section>
                )}

                {selected.clarification_history?.map((record, index) => (
                  <section className="intervention-section" key={`${record.created_at}-${index}`}>
                    <h3>Clarification record</h3>
                    <pre className="agent-clarification-record">{record.summary}</pre>
                    <small>{new Date(record.created_at).toLocaleString()}</small>
                  </section>
                ))}

                {selected.proposals && selected.proposals.length > 0 && (
                  <section className="intervention-section">
                    <h3><Sparkles size={15} /> Fix Proposals ({selected.proposals.length})</h3>
                    <div className="proposal-list">
                      {selected.proposals.map((proposal) => (
                        <div key={proposal.id} className="proposal-card">
                          <div className="proposal-header">
                            <strong>{proposal.name}</strong>
                            <span>{proposal.target}</span>
                          </div>
                          <p>{proposal.intent}</p>
                          {proposal.fields && proposal.fields.length > 0 && (
                            <div className="proposal-fields">
                              {proposal.fields.map((field, index) => (
                                <span key={index} className={`field-chip provenance-${field.provenance}`}>
                                  {field.key}: {String(field.value)}
                                </span>
                              ))}
                            </div>
                          )}
                          {proposal.validation_hints && proposal.validation_hints.length > 0 && (
                            <div className="proposal-hints">
                              {proposal.validation_hints.map((hint, index) => (
                                <small key={index}>⚠️ {hint}</small>
                              ))}
                            </div>
                          )}
                          <button
                            className="primary"
                            disabled={loading}
                            onClick={() => handleSelectProposal(proposal.id)}
                          >
                            {loading && action === 'select'
                              ? <><Loader2 size={14} className="spin" /> Selecting...</>
                              : <><ChevronRight size={14} /> Select this proposal</>}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {selected.requires_confirmation && selected.requires_confirmation.length > 0 && (
                  <section className="intervention-section">
                    <h3><CheckCircle2 size={15} /> Required Confirmations</h3>
                    <ul>
                      {selected.requires_confirmation.map((req, index) => (
                        <li key={index}>{req}</li>
                      ))}
                    </ul>
                  </section>
                )}

                {selected.state === 'user_feedback' && (
                  <section className="intervention-section">
                    <h3>Your Feedback</h3>
                    <form onSubmit={onFeedbackSubmit}>
                      <textarea
                        value={feedback}
                        onChange={(event) => setFeedback(event.target.value)}
                        placeholder="Add feedback or modification requests..."
                      />
                    </form>
                  </section>
                )}

                {selected.validation && (
                  <section className="intervention-section">
                    <h3>Validation Result</h3>
                    {selected.validation.valid ? (
                      <div className="validation-success">
                        <CheckCircle2 size={16} />
                        <span>Configuration is valid and ready for execution</span>
                      </div>
                    ) : (
                      <div className="validation-failed">
                        <AlertCircle size={16} />
                        <span>Validation failed</span>
                        {selected.validation.errors && selected.validation.errors.length > 0 && (
                          <ul>
                            {selected.validation.errors.map((err, index) => (
                              <li key={index}>{err}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </section>
                )}

                {error && <div className="error-message"><AlertCircle size={14} />{error}</div>}

                <div className="intervention-actions">
                  {selected.state === 'observation' && (
                    <button
                      className="primary"
                      disabled={loading}
                      onClick={() => void handleDiagnose()}
                    >
                      {loading && action === 'diagnose'
                        ? <><Loader2 size={14} className="spin" /> Diagnosing...</>
                        : <><Sparkles size={14} /> Start Diagnosis</>}
                    </button>
                  )}

                  {selected.state === 'diagnosis' && (
                    <button
                      className="primary"
                      disabled={loading}
                      onClick={() => void handleGenerateProposals()}
                    >
                      {loading && action === 'proposals'
                        ? <><Loader2 size={14} className="spin" /> Generating proposals...</>
                        : <><Sparkles size={14} /> Generate Fix Proposals</>}
                    </button>
                  )}

                  {selected.state === 'missing_input' && (
                    <button className="primary" disabled={loading} onClick={() => setClarificationOpen(true)}>
                      <Sparkles size={14} /> Answer engineering questions
                    </button>
                  )}

                  {selected.state === 'user_feedback' && selected.selected_proposal && (
                    <button
                      className="primary"
                      disabled={loading}
                      onClick={() => void handleCompile()}
                    >
                      {loading && action === 'compile'
                        ? <><Loader2 size={14} className="spin" /> Compiling patch...</>
                        : <><Send size={14} /> Compile & Validate</>}
                    </button>
                  )}

                  {selected.state === 'patch_compile' && (
                    <button
                      className="primary"
                      disabled={loading}
                      onClick={() => void handleValidate()}
                    >
                      {loading && action === 'validate'
                        ? <><Loader2 size={14} className="spin" /> Validating...</>
                        : <><RefreshCw size={14} /> Run Validation</>}
                    </button>
                  )}

                  {(selected.state === 'failed' || selected.state === 'resolved') && (
                    <button
                      onClick={() => void handleClose()}
                      disabled={loading}
                    >
                      {loading ? 'Closing...' : 'Close Intervention'}
                    </button>
                  )}

                  {(selected.state === 'user_feedback' || selected.state === 'proposal') && (
                    <button onClick={() => void handleClose()} disabled={loading}>
                      Dismiss
                    </button>
                  )}
                </div>

                <div className="intervention-timestamps">
                  <small>Created {new Date(selected.created_at).toLocaleString()}</small>
                  <small>Updated {new Date(selected.updated_at).toLocaleString()}</small>
                </div>
              </div>
            ) : (
              <div className="no-selection">
                <Sparkles size={48} />
                <h3>Agent Recovery</h3>
                <p>Select an intervention from the list to view details and run the recovery process.</p>
                <p>The agent will diagnose issues, generate fix proposals, and guide you through resolution.</p>
              </div>
            )}
          </main>
        </div>
        <AgentClarificationDialog
          open={clarificationOpen}
          title="Recovery details required"
          message={selected?.clarification_message}
          questions={selected?.pending_questions ?? []}
          busy={loading && action === 'clarification'}
          onClose={() => setClarificationOpen(false)}
          onSubmit={(answers: ClarificationAnswers) => void handleClarification(answers)}
        />
      </section>
    </div>
  )
}
