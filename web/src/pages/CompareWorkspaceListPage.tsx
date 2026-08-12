import { AlertCircle, Archive, ArchiveRestore, ArrowLeft, Copy, GitCompare, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CompareWorkspace, type Flow360Status } from '../api/client'
import TopBar from '../components/TopBar'
import { useI18n } from '../i18n'

export default function CompareWorkspaceListPage() {
  const { t } = useI18n()
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [workspaces, setWorkspaces] = useState<CompareWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionId, setActionId] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    api.compareWorkspaces()
      .then((response) => setWorkspaces(response.workspaces))
      .catch((cause) => setError(String(cause).replace('Error: ', '')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
    load()
  }, [])

  const updateStatus = async (workspace: CompareWorkspace) => {
    setActionId(workspace.id)
    setError('')
    try {
      const updated = await api.updateCompareWorkspaceStatus(workspace.id, workspace.status === 'archived' ? 'active' : 'archived')
      setWorkspaces((current) => current.map((item) => item.id === updated.id ? { ...item, ...updated } : item))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setActionId('')
    }
  }

  const duplicate = async (workspace: CompareWorkspace) => {
    setActionId(workspace.id)
    setError('')
    try {
      const copied = await api.duplicateCompareWorkspace(workspace.id, `${workspace.name} ${t('copy')}`)
      setWorkspaces((current) => [copied, ...current])
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setActionId('')
    }
  }

  const remove = async (workspace: CompareWorkspace) => {
    if (!window.confirm(t('Delete this saved comparison? Its evidence snapshot, view settings, and AI sessions will be removed.'))) return
    setActionId(workspace.id)
    setError('')
    try {
      await api.deleteCompareWorkspace(workspace.id)
      setWorkspaces((current) => current.filter((item) => item.id !== workspace.id))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setActionId('')
    }
  }

  return (
    <div className="compare-page compare-library-page">
      <TopBar status={status} />
      <header className="compare-header">
        <div className="compare-header-inner">
          <Link to="/"><ArrowLeft size={15} />{t('Workspace')}</Link>
          <div><p className="eyebrow">{t('DECISION HISTORY')}</p><h1><GitCompare size={24} />{t('Saved comparisons')}</h1><p>{t('Resume saved evidence, visualization settings, and AI analysis sessions.')}</p></div>
          <button type="button" className="compare-library-refresh" onClick={load} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} />{t('Refresh')}</button>
        </div>
      </header>
      <main className="compare-library">
        {error && <div className="project-cache-warning"><AlertCircle size={14} />{error}</div>}
        {loading && <div className="project-load-state"><RefreshCw className="spin" />{t('Loading saved comparisons…')}</div>}
        {!loading && workspaces.length === 0 && <section className="compare-empty"><GitCompare size={26} /><strong>{t('No saved comparisons yet')}</strong><p>{t('Run a Case comparison and choose Save comparison to preserve its evidence and view settings.')}</p></section>}
        {!loading && workspaces.length > 0 && <div className="compare-library-grid">{workspaces.map((workspace) => (
          <article className={`compare-library-card ${workspace.status === 'archived' ? 'is-archived' : ''}`} key={workspace.id}>
            <Link className="compare-library-card-link" to={`/compares/${encodeURIComponent(workspace.id)}`}>
              <div><span>{workspace.status === 'archived' ? t('ARCHIVED COMPARE') : t('COMPARE WORKSPACE')}</span><strong>{workspace.name}</strong></div>
              <ul>{[...workspace.participants].sort((left, right) => left.position - right.position).map((participant) => <li key={participant.case_id}><em>{participant.role === 'baseline' ? t('Baseline') : t('Candidate')}</em><span>{participant.case_name_snapshot}</span><small>{participant.project_name_snapshot || participant.project_id}</small></li>)}</ul>
              <footer><span>{t('{count} Cases').replace('{count}', String(workspace.participants.length))}</span><time>{workspace.updated_at ? new Date(workspace.updated_at).toLocaleString() : ''}</time></footer>
            </Link>
            <div className="compare-library-actions">
              <button type="button" disabled={actionId === workspace.id} onClick={() => void updateStatus(workspace)}>{workspace.status === 'archived' ? <ArchiveRestore size={13} /> : <Archive size={13} />}{workspace.status === 'archived' ? t('Restore') : t('Archive')}</button>
              <button type="button" disabled={actionId === workspace.id} onClick={() => void duplicate(workspace)}><Copy size={13} />{t('Duplicate')}</button>
              <button type="button" className="danger" disabled={actionId === workspace.id} onClick={() => void remove(workspace)}><Trash2 size={13} />{t('Delete')}</button>
            </div>
          </article>
        ))}</div>}
      </main>
    </div>
  )
}
