import { AlertCircle, ArrowRight, ArrowUp, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { PlanAssistMode } from '../api/client'
import { useI18n } from '../i18n'
import type { ParameterChange } from './PlanParameterReview'

export type DraftAISessionMessage = {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  changes?: ParameterChange[]
}

type Props = {
  messages: DraftAISessionMessage[]
  prompt: string
  mode: PlanAssistMode
  loading: boolean
  onPromptChange: (value: string) => void
  onQuickPrompt: (mode: PlanAssistMode, prompt: string) => void
  onSubmit: () => void
  onClose: () => void
}

export default function DraftAISession({ messages, prompt, mode, loading, onPromptChange, onQuickPrompt, onSubmit, onClose }: Props) {
  const { t } = useI18n()
  const conversationEndRef = useRef<HTMLDivElement | null>(null)
  const quickPrompts: Array<{ mode: PlanAssistMode; label: string; prompt: string }> = [
    {
      mode: 'edit',
      label: t('Modify parameters'),
      prompt: t('Modify the current Draft parameters. Describe the parameter names or paths and the values to set.'),
    },
    {
      mode: 'repair',
      label: t('Fix validation'),
      prompt: t('Make the current Draft pass Flow360 validation. Change only the fields required by the current validation issues.'),
    },
    {
      mode: 'explain',
      label: t('Explain a parameter'),
      prompt: t('Explain a Draft parameter without modifying any parameter values. Parameter name or path:'),
    },
  ]

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [loading, messages])

  return (
    <aside className="draft-ai-session" aria-label={t('AI Draft session')}>
      <header className="draft-ai-session-header">
        <span><Sparkles size={15} /></span>
        <div>
          <strong>{t('AI Draft session')}</strong>
          <small>{t('Draft change history')}</small>
        </div>
        <button type="button" onClick={onClose} aria-label={t('Close AI Draft session')}><X size={15} /></button>
      </header>

      <div className="draft-ai-conversation" aria-live="polite">
        {!messages.length && !loading && (
          <div className="draft-ai-empty">
            <span><Sparkles size={18} /></span>
            <strong>{t('No AI changes yet')}</strong>
            <p>{t('Ask AI to modify the current unsaved Draft. Each request and its parameter changes will stay in this session.')}</p>
          </div>
        )}
        {messages.map((message) => (
          <article className={`draft-ai-message ${message.role}`} key={message.id}>
            <strong>{t(message.role === 'user' ? 'You' : message.role === 'assistant' ? 'AI' : 'AI change failed')}</strong>
            <p>{message.content}</p>
            {message.changes && message.changes.length > 0 && (
              <div className="draft-ai-message-changes">
                <span>{t('{count} parameter changes').replace('{count}', String(message.changes.length))}</span>
                {message.changes.slice(0, 8).map((change) => (
                  <div key={change.path}>
                    <code>{change.path}</code>
                    <small>{compactValue(change.before)}</small>
                    <ArrowRight size={10} />
                    <small>{compactValue(change.after)}</small>
                  </div>
                ))}
                {message.changes.length > 8 && <em>{t('{count} additional changes').replace('{count}', String(message.changes.length - 8))}</em>}
              </div>
            )}
          </article>
        ))}
        {loading && (
          <div className="draft-ai-thinking">
            <RefreshCw size={14} className="spin" />
            <span>{t('AI is preparing a Draft update…')}</span>
          </div>
        )}
        <div ref={conversationEndRef} />
      </div>

      <form className="draft-ai-composer" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
        <div className="draft-ai-quick-prompts" aria-label={t('Quick prompts')}>
          {quickPrompts.map((action) => (
            <button
              type="button"
              key={action.mode}
              className={mode === action.mode ? 'active' : undefined}
              aria-pressed={mode === action.mode}
              onClick={() => onQuickPrompt(action.mode, action.prompt)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={t('For example: lower CFL to 3, or switch to the k-omega SST turbulence model.')}
          aria-label={t('Describe the Draft change')}
        />
        <div className="draft-ai-composer-footer">
          <span>{t('AI changes use the current unsaved Form or JSON candidate.')}</span>
          <button type="submit" disabled={loading || !prompt.trim()} aria-label={t('Send Draft change')}>
            {loading ? <RefreshCw size={14} className="spin" /> : <ArrowUp size={15} />}
          </button>
        </div>
      </form>
    </aside>
  )
}

function compactValue(value: unknown) {
  if (value === undefined) return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 54 ? `${text.slice(0, 54)}…` : text
}
