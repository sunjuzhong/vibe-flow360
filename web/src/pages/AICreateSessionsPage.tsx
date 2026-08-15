import { AlertCircle, CheckCircle2, Clock3, ExternalLink, Folder, Loader2, MessageSquare, RefreshCw, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type AICreateResult, type AICreateSession, type Flow360Status } from '../api/client'
import AICreateModal from '../components/AICreateModal'
import AICreateSessionContext from '../components/AICreateSessionContext'
import TopBar from '../components/TopBar'
import { useI18n } from '../i18n'
import './AICreateSessionsPage.css'

function phaseTone(phase: string) {
  if (phase === 'completed') return 'complete'
  if (phase === 'failed') return 'failed'
  if (phase === 'needs_input') return 'paused'
  return 'active'
}

export default function AICreateSessionsPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [sessions, setSessions] = useState<AICreateSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openSession, setOpenSession] = useState<AICreateSession | null>(null)
  const selected = useMemo(() => sessions.find((session) => session.id === sessionId) ?? null, [sessions, sessionId])

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.aiCreateSessions()
      setSessions(response.sessions)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
    void load()
  }, [])

  const openProject = (projectId: string) => navigate(`/projects/${encodeURIComponent(projectId)}`)
  const acceptCreated = (result: AICreateResult) => openProject(result.project_id)

  return <div className="ai-session-route">
    <TopBar status={status} title={t('AI Create sessions')} />
    <main className="ai-session-library">
      <header>
        <div><p className="eyebrow">{t('PERSISTED AI WORK')}</p><h1><MessageSquare size={25} /> {t('AI Create sessions')}</h1><p>{t('Resume failed work, refine completed designs, and open the Flow360 Projects created by each conversation.')}</p></div>
        <button type="button" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={14} /> {t('Refresh')}</button>
      </header>
      {error && <div className="ai-session-error"><AlertCircle size={15} /> {t(error)}</div>}
      {loading && !sessions.length && <div className="ai-session-empty"><Loader2 className="spin" size={22} /> {t('Loading AI Create sessions…')}</div>}
      {!loading && !sessions.length && <div className="ai-session-empty"><Sparkles size={25} /><strong>{t('No AI Create sessions yet')}</strong><p>{t('Start AI Create from a workspace folder. Every new conversation will appear here automatically.')}</p></div>}
      {sessions.length > 0 && <div className="ai-session-layout">
        <aside aria-label={t('AI Create session list')}>
          {sessions.map((session) => <Link key={session.id} className={session.id === selected?.id ? 'active' : ''} to={`/sessions/${encodeURIComponent(session.id)}`}>
            <span className={`ai-session-state ${phaseTone(session.phase)}`}>{session.phase === 'completed' ? <CheckCircle2 size={13} /> : session.phase === 'failed' ? <AlertCircle size={13} /> : <Clock3 size={13} />}</span>
            <span><strong>{session.original_request || session.messages?.[0]?.content || session.intent}</strong><small>{t(session.phase.replaceAll('_', ' '))} · {new Date(session.updated_at).toLocaleString()}</small></span>
          </Link>)}
        </aside>
        <section className="ai-session-detail">
          {!selected && <div className="ai-session-empty"><MessageSquare size={24} /><strong>{t('Select a session')}</strong><p>{t('Review its conversation, checkpoint status, and linked Project.')}</p></div>}
          {selected && <>
            <div className="ai-session-detail-heading"><div><p className="eyebrow">{t('AI CREATE SESSION')}</p><h2>{selected.original_request || selected.messages?.[0]?.content || selected.intent}</h2><small>{selected.id}</small></div><span className={`ai-session-phase ${phaseTone(selected.phase)}`}>{t(selected.phase.replaceAll('_', ' '))}</span></div>
            <div className="ai-session-meta">
              <span><Clock3 size={12} /><small>{t('Updated')}</small><strong>{new Date(selected.updated_at).toLocaleString()}</strong></span>
              <span><Folder size={12} /><small>{t('Destination folder')}</small><strong>{selected.folder_id}</strong></span>
              {selected.project_id && <Link to={`/projects/${encodeURIComponent(selected.project_id)}`}><ExternalLink size={12} /><small>{t('Project')}</small><strong>{selected.project_id}</strong></Link>}
              {selected.draft_id && <span><CheckCircle2 size={12} /><small>{t('Draft')}</small><strong>{selected.draft_id}</strong></span>}
            </div>
            {selected.last_error && <div className="ai-session-error"><AlertCircle size={15} /><span><strong>{t('The last run stopped')}</strong>{t(selected.last_error)}</span></div>}
            <AICreateSessionContext session={selected} />
            <footer>
              {selected.project_id && <button className="secondary" type="button" onClick={() => openProject(selected.project_id!)}>{t('Open Project')} <ExternalLink size={13} /></button>}
              <button type="button" onClick={() => setOpenSession(selected)}><Sparkles size={14} /> {t(selected.phase === 'completed' ? 'Continue conversation' : 'Resume session')}</button>
            </footer>
          </>}
        </section>
      </div>}
    </main>
    {openSession && <AICreateModal
      folder={{ id: openSession.folder_id, name: openSession.folder_id, subfolders: [] }}
      environment={status?.environment}
      initialSession={openSession}
      onClose={() => { setOpenSession(null); void load() }}
      onCreated={acceptCreated}
      onOpenProject={openProject}
    />}
  </div>
}
