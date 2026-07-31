import { ArrowUp, ChevronRight, Loader2, MessageSquareText, Sparkles, X } from 'lucide-react'
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api, type AgentAction, type AgentState } from '../api/client'
import { readSSE } from '../lib/sse'
import { useFocusTrap } from '../lib/useFocusTrap'

type Message = {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
  action?: AgentAction
  actionExecuted?: boolean
}

export default function CopilotPanel({
  open,
  onClose,
  contextLabel,
  context,
  suggestions = [],
}: {
  open: boolean
  onClose: () => void
  contextLabel: string
  context: string
  suggestions?: string[]
}) {
  const [agent, setAgent] = useState<AgentState | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const panelRef = useFocusTrap(open, onClose, 'textarea')

  const [converting, setConverting] = useState(false)

  useEffect(() => {
    api.agentState().then(setAgent).catch(() => setAgent(null))
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    return null
  }

  const convertToPlans = async (messageIndex: number) => {
    const msg = messages[messageIndex]
    if (!msg.action) return
    setConverting(true)
    try {
      const result = await api.planFromAction(msg.action)
      setMessages((current) => {
        const next = [...current]
        next[messageIndex] = {
          ...msg,
          content: msg.content + `\n\n✅ 已创建 ${result.created}/${result.total} 个计划${result.failed > 0 ? `（${result.failed} 个失败）` : ''}。`,
          actionExecuted: true,
        }
        return next
      })
    } catch (err) {
      setMessages((current) => {
        const next = [...current]
        next[messageIndex] = {
          ...msg,
          content: msg.content + `\n\n❌ 创建计划失败: ${String(err)}`,
          actionExecuted: true,
        }
        return next
      })
    } finally {
      setConverting(false)
    }
  }

  const submit = async () => {
    const text = input.trim()
    if (!text || busy) return
    const history = messages.map(({ role, content }) => ({ role, content }))
    setInput('')
    setBusy(true)
    setMessages((current) => [...current, { role: 'user', content: text }, { role: 'assistant', content: '' }])
    let accumulated = ''

    try {
      const response = await fetch('/api/agent/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ message: text, history, context, session: 'web:workspace' }),
      })
      if (!response.ok) throw new Error(await response.text())
      await readSSE(response, (event) => {
        if (event.type === 'delta') {
          accumulated += event.delta ?? ''
          setMessages((current) => current.map((message, index) => {
            if (index !== current.length - 1) return message
            const action = extractAction(accumulated)
            return { role: 'assistant', content: accumulated, action: action ?? undefined }
          }))
        }
        if (event.type === 'error') throw new Error(event.error || 'AI service unavailable')
      })
    } catch (error) {
      setMessages((current) => current.map((message, index) =>
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
      <div className="copilot-context"><MessageSquareText size={14} /><span>{contextLabel}</span></div>
      <div className="copilot-messages">
        {!messages.length && (
          <div className="copilot-empty">
            <Sparkles size={23} />
            <h3>Ask in context</h3>
            <p>我会基于当前 workspace、project 或 resource 回答，并在执行任何远程操作前展示计划。</p>
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
                ? message.content
                  ? <ReactMarkdown>{message.content}</ReactMarkdown>
                  : <div className="thinking"><span /><span /><span /></div>
                : message.content}
              {message.action && message.action.kind === 'create-plan' && !message.actionExecuted && (
                <div className="action-plan-card">
                  <div className="action-plan-header">
                    <strong>📋 仿真计划</strong>
                    <span className="action-plan-count">{message.action.proposals?.length ?? 0} 个提案</span>
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
                  <button
                    className="action-plan-convert"
                    disabled={converting}
                    onClick={() => convertToPlans(index)}
                  >
                    {converting ? <><Loader2 size={14} /> 转换中...</> : <><ChevronRight size={14} /> 转换为计划</>}
                  </button>
                </div>
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
          aria-label="向 Simulation Copilot 提问"
        />
        <div><span>Review before running</span><button className="send-button" disabled={!input.trim() || busy}><ArrowUp size={16} /></button></div>
      </form>
    </aside>
  )
}
