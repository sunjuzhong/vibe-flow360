import { Clock3, Database, Loader2, RefreshCw, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type ChatMessage, type ResultInterpretationRequest, type ResultInterpretationResponse } from '../api/client'
import { useI18n } from '../i18n'

export function ResultMarkdown({ children }: { children: string }) {
  return (
    <div className="result-ai-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
      }}>{children}</ReactMarkdown>
    </div>
  )
}

export function resultConversationMessages(messages: ChatMessage[], pendingQuestion: string): ChatMessage[] {
  if (!pendingQuestion) return messages
  return [...messages, { role: 'user', content: pendingQuestion }]
}

export function resultInterpretationErrorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

export function ResultAIInterpretationDialog({ open, input, onClose }: {
  open: boolean
  input: ResultInterpretationRequest | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const titleId = useId()
  const conversationEndRef = useRef<HTMLDivElement | null>(null)
  const loadedFingerprintRef = useRef('')
  const lastRequestRef = useRef<{ mode: ResultInterpretationRequest['mode']; question: string }>({ mode: 'load', question: '' })
  const [response, setResponse] = useState<ResultInterpretationResponse | null>(null)
  const [question, setQuestion] = useState('')
  const [pendingQuestion, setPendingQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const request = async (mode: ResultInterpretationRequest['mode'], nextQuestion = '') => {
    if (!input || busy) return
    setBusy(true)
    setError('')
    lastRequestRef.current = { mode, question: nextQuestion }
    try {
      const result = await api.interpretResult({ ...input, mode, question: nextQuestion || undefined })
      setResponse(result)
      if (mode === 'ask') setPendingQuestion('')
    } catch (failure) {
      setError(resultInterpretationErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open || !input) return
    const identity = `${input.path}:${input.fingerprint}:${input.language}`
    if (loadedFingerprintRef.current === identity) return
    loadedFingerprintRef.current = identity
    setResponse(null)
    setQuestion('')
    setPendingQuestion('')
    setError('')
    void request('load')
    // input is immutable for a specific CSV fingerprint; request is intentionally started once per identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, open])

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [busy, pendingQuestion, response?.messages.length])

  if (!open) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = question.trim()
    if (!trimmed) return
    setPendingQuestion(trimmed)
    setQuestion('')
    void request('ask', trimmed)
  }

  const regenerate = () => {
    if (!window.confirm(t('Regenerate the interpretation and clear this conversation?'))) return
    setPendingQuestion('')
    void request('regenerate')
  }

  const clearConversation = () => {
    if (!window.confirm(t('Clear this AI conversation?'))) return
    setPendingQuestion('')
    void request('clear')
  }

  const conversationMessages = resultConversationMessages(response?.messages ?? [], pendingQuestion)

  return (
    <aside className="result-ai-panel" role="complementary" aria-labelledby={titleId}>
      <section className="result-ai-dialog">
        <header className="result-ai-dialog-header">
          <div><Sparkles size={18} /><span><strong id={titleId}>{t('AI interpretation')}</strong><small>{input?.path ?? t('Preparing data fingerprint…')}</small></span></div>
          <button type="button" onClick={onClose} aria-label={t('Close AI interpretation')}><X size={17} /></button>
        </header>

        {response && (
          <div className="result-ai-dialog-meta">
            <span><Database size={11} />{t(response.cached ? 'Cached interpretation' : 'Fresh interpretation')}</span>
            <span>{response.model}</span>
            <span><Clock3 size={11} />{new Date(response.generated_at).toLocaleString()}</span>
            <div>
              <button type="button" onClick={regenerate} disabled={busy}><RefreshCw size={12} />{t('Regenerate')}</button>
              <button type="button" onClick={clearConversation} disabled={busy || response.messages.length === 0}><Trash2 size={12} />{t('Clear conversation')}</button>
            </div>
          </div>
        )}

        <main className="result-ai-dialog-body">
          {!input && <div className="result-ai-dialog-state"><Loader2 className="spin" size={18} />{t('Preparing data fingerprint…')}</div>}
          {input && !response && busy && <div className="result-ai-dialog-state"><Loader2 className="spin" size={18} />{t('Interpreting CFD result…')}</div>}
          {error && <div className="result-ai-dialog-error" role="alert">{t(error)}<button type="button" onClick={() => void request(lastRequestRef.current.mode, lastRequestRef.current.question)} disabled={busy}>{t('Retry')}</button></div>}
          {response && (
            <>
              <article className="result-ai-base-answer">
                <div className="result-ai-answer-label"><Sparkles size={13} />{t('CFD interpretation')}</div>
                <ResultMarkdown>{response.interpretation}</ResultMarkdown>
              </article>
              {conversationMessages.length > 0 && <div className="result-ai-conversation-divider"><span>{t('Follow-up conversation')}</span></div>}
              <div className="result-ai-conversation" aria-live="polite">
                {conversationMessages.map((message, index) => (
                  <article className={`result-ai-message ${message.role}`} key={`${message.role}-${index}`}>
                    <strong>{t(message.role === 'user' ? 'You' : 'AI')}</strong>
                    {message.role === 'assistant' ? <ResultMarkdown>{message.content}</ResultMarkdown> : <p>{message.content}</p>}
                  </article>
                ))}
                {busy && pendingQuestion && <div className="result-ai-thinking"><Loader2 className="spin" size={14} />{t('Analyzing your question…')}</div>}
                <div ref={conversationEndRef} />
              </div>
            </>
          )}
        </main>

        <form className="result-ai-question-form" onSubmit={submit}>
          <textarea className="result-ai-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={t('Ask about fields, convergence, anomalies, or next checks…')} maxLength={4000} rows={2} disabled={!response || busy || Boolean(pendingQuestion)} />
          <button type="submit" disabled={!response || busy || Boolean(pendingQuestion) || !question.trim()} aria-label={t('Send follow-up question')}><Send size={16} /></button>
        </form>
      </section>
    </aside>
  )
}
