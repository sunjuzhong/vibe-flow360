import { ArrowUp, MessageSquareText, Sparkles, X } from 'lucide-react'
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { api, type AgentState } from '../api/client'
import { readSSE } from '../lib/sse'

type Message = {
  role: 'user' | 'assistant'
  content: string
  error?: boolean
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

  useEffect(() => {
    api.agentState().then(setAgent).catch(() => setAgent(null))
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
          setMessages((current) => current.map((message, index) =>
            index === current.length - 1 ? { role: 'assistant', content: accumulated } : message
          ))
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
      className={`copilot-panel ${open ? 'open' : ''}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="copilot-header">
        <span className="ai-avatar"><Sparkles size={17} /></span>
        <div><strong>Simulation Copilot</strong><span>{agent?.mode === 'ai' ? agent.model : 'Local planning mode'}</span></div>
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
