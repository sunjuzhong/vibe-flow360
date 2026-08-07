import { AlertCircle, ArrowUp, CheckCircle2, ChevronRight, Loader2, MessageSquareText, Sparkles, X } from 'lucide-react'
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api, type ActionPlanResult, type AgentAction, type AgentState, type ChatMessage, type SimulationPlan } from '../api/client'
import { readSSE } from '../lib/sse'
import { useFocusTrap } from '../lib/useFocusTrap'
import AgentClarificationDialog, { type ClarificationAnswers } from './AgentClarificationDialog'

type Message = ChatMessage & {
  error?: boolean
  action?: AgentAction
  conversion?: ActionPlanResult
  conversionError?: string
}

export function shouldShowCopilotClarification(panelOpen: boolean, action: AgentAction | null) {
  return panelOpen && action?.kind === 'request-missing-input' && Boolean(action.questions?.length)
}

export const copilotHorizontalContainment = { overflowX: 'hidden' } as const

export function actionPlanConversionSummary(result: ActionPlanResult) {
  return `${result.created}/${result.total} Draft review${result.total === 1 ? '' : 's'} ready`
}

export type CopilotScopeType = 'project' | 'resource' | 'draft'

export function copilotScopeLabel(scopeType: CopilotScopeType) {
  if (scopeType === 'draft') return 'Draft session'
  if (scopeType === 'resource') return 'Resource session'
  return 'Project session'
}

export default function CopilotPanel({
  open,
  onClose,
  contextLabel,
  context,
  projectId,
  projectName,
  scopeType,
  scopeId,
  resourceId,
  resourceType,
  resourceName,
  onOpenPlan,
  suggestions = [],
}: {
  open: boolean
  onClose: () => void
  contextLabel: string
  context: string
  projectId: string
  projectName?: string
  scopeType: CopilotScopeType
  scopeId?: string
  resourceId?: string
  resourceType?: string
  resourceName?: string
  onOpenPlan: (plan: SimulationPlan) => void
  suggestions?: string[]
}) {
  const [agent, setAgent] = useState<AgentState | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionLoading, setSessionLoading] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const scopeRef = useRef('')
  const panelRef = useFocusTrap(open, onClose, 'textarea')

  const [convertingIndex, setConvertingIndex] = useState<number | null>(null)
  const [clarificationAction, setClarificationAction] = useState<AgentAction | null>(null)

  useEffect(() => {
    api.agentState().then(setAgent).catch(() => setAgent(null))
  }, [])

  useEffect(() => {
    const scope = `${projectId}\u0000${scopeType}\u0000${scopeId ?? ''}`
    scopeRef.current = scope
    setMessages([])
    setConvertingIndex(null)
    setSessionLoading(true)
    api.agentChatSession(projectId, scopeType, scopeId, resourceId)
      .then((session) => {
        if (scopeRef.current === scope) {
          const restored = session.messages.map((message) => ({
            ...message,
            action: message.role === 'assistant' ? extractAction(message.content) ?? undefined : undefined,
          }))
          setMessages(restored)
          setClarificationAction(null)
        }
      })
      .catch(() => {
        if (scopeRef.current === scope) setMessages([])
      })
      .finally(() => {
        if (scopeRef.current === scope) setSessionLoading(false)
      })
  }, [projectId, resourceId, scopeId, scopeType])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!open) setClarificationAction(null)
  }, [open])

  const extractAction = (text: string): AgentAction | null => {
    const patterns = [
      /```json\s*([\s\S]*?)```/g,
      /```\s*([\s\S]*?)```/g,
    ]
    for (const pattern of patterns) {
      const match = pattern.exec(text)
      if (!match) continue
      try {
        const parsed = JSON.parse(match[1].trim())
        if (parsed && parsed.kind && parsed.message) {
          return parsed as AgentAction
        }
      } catch { /* not JSON */ }
    }
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1))
        if (parsed && parsed.kind && parsed.message) return parsed as AgentAction
      } catch { /* not a complete JSON object */ }
    }
    return null
  }

  const convertToPlans = async (messageIndex: number) => {
    const msg = messages[messageIndex]
    if (!msg.action || convertingIndex !== null || msg.conversion) return
    const scope = scopeRef.current
    setConvertingIndex(messageIndex)
    setMessages((current) => current.map((message, index) => index === messageIndex
      ? { ...message, conversionError: undefined }
      : message))
    try {
      const result = await api.planFromAction(msg.action, {
        project_id: projectId,
        project_name: projectName,
        source_id: resourceId,
        source_type: resourceType,
        source_name: resourceName,
      })
      setMessages((current) => scopeRef.current !== scope ? current : current.map((message, index) => index === messageIndex
        ? { ...message, conversion: result, conversionError: undefined }
        : message))
      window.dispatchEvent(new Event('vibesim:plans-refresh'))
    } catch (err) {
      const conversionError = String(err).replace(/^Error:\s*/, '')
      setMessages((current) => scopeRef.current !== scope ? current : current.map((message, index) => index === messageIndex
        ? { ...message, conversionError }
        : message))
    } finally {
      if (scopeRef.current === scope) setConvertingIndex(null)
    }
  }

  const submit = async (submittedText?: string) => {
    const text = (submittedText ?? input).trim()
    if (!text || busy || sessionLoading) return
    const scope = `${projectId}\u0000${scopeType}\u0000${scopeId ?? ''}`
    const history = messages.map(({ role, content }) => ({ role, content }))
    setInput('')
    setBusy(true)
    setMessages((current) => [...current, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    let accumulated = ''

    try {
      const response = await fetch('/api/agent/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({
          message: text,
          history,
          context,
          project_id: projectId,
          resource_id: resourceId,
          scope_type: scopeType,
          scope_id: scopeId,
        }),
      })
      if (!response.ok) throw new Error(await response.text())
      await readSSE(response, (event) => {
        if (event.type === 'delta') {
          accumulated += event.delta ?? ''
          setMessages((current) => scopeRef.current !== scope ? current : current.map((message, index) => {
            if (index !== current.length - 1) return message
            const action = extractAction(accumulated)
            return { role: 'assistant', content: accumulated, action: action ?? undefined }
          }))
        }
        if (event.type === 'error') throw new Error(event.error || 'AI service unavailable')
      })
    } catch (error) {
      setMessages((current) => scopeRef.current !== scope ? current : current.map((message, index) =>
        index === current.length - 1
          ? { role: 'assistant', content: `Request failed: ${String(error)}`, error: true }
          : message
      ))
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <aside
      ref={panelRef}
      style={copilotHorizontalContainment}
      className={`copilot-panel ${open ? 'open' : ''}`}
      aria-hidden={!open}
      aria-modal={open}
      aria-label="Simulation Copilot"
      role="dialog"
      inert={!open}
    >
      <div className="copilot-header">
        <span className="ai-avatar"><Sparkles size={17} /></span>
        <div>
          <strong>Simulation Copilot</strong>
          <span>
            {agent?.mode === 'codex'
              ? `External Codex · ${agent.model}`
              : agent?.mode === 'ai'
                ? `Built-in · ${agent.model}`
                : agent?.mode === 'configuration-error'
                  ? 'Agent configuration error'
                  : 'Built-in local planning mode'}
          </span>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close AI assistant"><X size={18} /></button>
      </div>
      <div className="copilot-context" aria-label={`${copilotScopeLabel(scopeType)}: ${contextLabel}`}>
        <MessageSquareText size={14} />
        <strong>{copilotScopeLabel(scopeType)}</strong>
        <span>{contextLabel}</span>
        <small>Project-wide context</small>
      </div>
      <div className="copilot-messages" style={copilotHorizontalContainment}>
        {sessionLoading && !messages.length && (
          <div className="copilot-empty"><Loader2 className="spin" size={22} /><p>Loading this conversation…</p></div>
        )}
        {!sessionLoading && !messages.length && (
          <div className="copilot-empty">
            <Sparkles size={23} />
            <h3>Ask in context</h3>
            <p>{`I’ll use this ${scopeType} as the primary context and can reference other Resources and Drafts in this Project.`}</p>
            {suggestions.length > 0 && (
              <div className="copilot-suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => setInput(suggestion)}>{suggestion}</button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((message, index) => (
          <div className={`message ${message.role} ${message.error ? 'error' : ''}`} key={index}>
            {message.role === 'assistant' && <span className="message-avatar"><Sparkles size={12} /></span>}
            <div className="message-body">
              {message.role === 'assistant'
                ? message.action
                  ? <ReactMarkdown>{message.action.message}</ReactMarkdown>
                  : message.content
                  ? <ReactMarkdown>{message.content}</ReactMarkdown>
                  : <div className="thinking"><span /><span /><span /></div>
                : message.content}
              {message.action && message.action.kind === 'create-plan' && (
                <div className="action-plan-card">
                  <div className="action-plan-header">
                    <strong>📋 Draft proposal</strong>
                    <span className="action-plan-count">{message.action.proposals?.length ?? 0} proposals</span>
                  </div>
                  {message.action.warnings && message.action.warnings.length > 0 && (
                    <ul className="action-plan-warnings">
                      {message.action.warnings.map((w, i) => <li key={i}>⚠️ {w}</li>)}
                    </ul>
                  )}
                  <div className="action-plan-proposals">
                    {message.action.proposals?.map((p) => (
                      <div key={p.id} className="action-proposal">
                        <span className="proposal-target">{p.target}</span>
                        <span className="proposal-name">{p.name}</span>
                        {p.fields.length > 0 && (
                          <span className="proposal-fields">
                            {p.fields.map((f, i) => (
                              <span key={i} className={`field-chip provenance-${f.provenance}`}>{f.key}: {String(f.value)}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {message.conversion ? (
                    <div className={`action-plan-conversion ${message.conversion.failed ? 'partial' : 'success'}`}>
                      <div className="action-plan-conversion-summary">
                        {message.conversion.failed ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
                        <span>
                          <strong>{actionPlanConversionSummary(message.conversion)}</strong>
                          <small>Nothing was run in Flow360. Continue chatting, or review the proposed parameter changes.</small>
                        </span>
                      </div>
                      <div className="action-plan-conversion-results">
                        {message.conversion.results.map((item) => item.plan ? (
                          <button type="button" key={item.id} onClick={() => onOpenPlan(item.plan!)} aria-label={`Review parameter changes for ${item.plan.name}`}>
                            <CheckCircle2 size={14} />
                            <span><strong>{item.plan.name}</strong><small>Parameter changes · nothing will run</small></span>
                            <b>Review changes</b>
                            <ChevronRight size={14} />
                          </button>
                        ) : (
                          <div className="failed" key={item.id}>
                            <AlertCircle size={14} />
                            <span><strong>{item.id}</strong><small>{item.error || 'Draft conversion failed'}</small></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      {message.conversionError && (
                        <div className="action-plan-conversion-error"><AlertCircle size={14} /><span><strong>Could not create the Draft review</strong><small>{message.conversionError}</small></span></div>
                      )}
                      <button
                        className="action-plan-convert"
                        disabled={convertingIndex !== null}
                        onClick={() => convertToPlans(index)}
                      >
                        {convertingIndex === index ? <><Loader2 className="spin" size={14} /> Creating Draft reviews…</> : <><ChevronRight size={14} /> {message.conversionError ? 'Try conversion again' : 'Convert to Draft'}</>}
                      </button>
                    </>
                  )}
                </div>
              )}
              {message.action?.kind === 'request-missing-input' && Boolean(message.action.questions?.length) && (
                <button className="action-plan-convert" type="button" onClick={() => setClarificationAction(message.action ?? null)}>
                  <ChevronRight size={14} /> Input required · Answer {message.action.questions?.length} engineering question{message.action.questions?.length === 1 ? '' : 's'}
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="copilot-composer" onSubmit={onSubmit}>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask about this context…"
          aria-label="Ask Simulation Copilot"
        />
        <div><span>Review before running</span><button className="send-button" disabled={!input.trim() || busy || sessionLoading}><ArrowUp size={16} /></button></div>
      </form>
      <AgentClarificationDialog
        open={shouldShowCopilotClarification(open, clarificationAction)}
        message={clarificationAction?.message}
        questions={clarificationAction?.questions ?? []}
        busy={busy}
        onClose={() => setClarificationAction(null)}
        onSubmit={(_answers: ClarificationAnswers, summary) => {
          setClarificationAction(null)
          void submit(summary)
        }}
      />
    </aside>
  )
}
