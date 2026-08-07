import { AlertTriangle, Box, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent } from 'react'
import { api, type ProjectMutationResult, type ProjectRecord } from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'
import type { ProjectMutationMode } from './ProjectActions'

function ModeIcon({ mode }: { mode: ProjectMutationMode }) {
  return mode === 'rename' ? <Pencil size={18} /> : <Trash2 size={18} />
}

export default function ProjectMutationDialog({
  mode,
  project,
  onClose,
  onComplete,
}: {
  mode: ProjectMutationMode
  project: ProjectRecord
  onClose: () => void
  onComplete: (result: ProjectMutationResult) => void | Promise<void>
}) {
  const titleId = useId()
  const [name, setName] = useState(project.name)
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose, 'button.project-dialog-close')

  useEffect(() => {
    setName(project.name)
    setDeleteConfirmed(false)
    setError('')
  }, [mode, project])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const result = mode === 'rename'
        ? await api.renameProject(project.id, name.trim())
        : await api.deleteProject(project.id, deleteConfirmed)
      await onComplete(result)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'rename' ? 'Rename project' : 'Delete project'
  const submitDisabled = busy || (mode === 'rename' ? !name.trim() : !deleteConfirmed)

  return (
    <div className="folder-dialog-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <div ref={dialogRef} className={`folder-dialog project-dialog mode-${mode}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <span><ModeIcon mode={mode} /></span>
          <div><small>FLOW360 PROJECT</small><h2 id={titleId}>{title}</h2></div>
          <button type="button" className="project-dialog-close icon-button" onClick={onClose} disabled={busy} aria-label="Close project dialog">
            <X size={17} />
          </button>
        </header>
        <form onSubmit={submit}>
          <p>{mode === 'rename'
            ? 'Change the display name of this Flow360 project.'
            : 'Permanently delete this Flow360 project and its remote resource history.'}</p>
          <div className="folder-dialog-target">
            <small>Target</small>
            <strong><Box size={13} /> {project.name}</strong>
            <code>{project.id}</code>
          </div>

          {mode === 'rename' && (
            <label>
              Project name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={128} autoFocus />
            </label>
          )}

          {mode === 'delete' && (
            <label className="folder-delete-confirm">
              <input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} />
              <span><AlertTriangle size={16} /><strong>{`I understand this permanently deletes “${project.name}”.`}</strong></span>
            </label>
          )}

          {error && <div className="folder-dialog-error"><AlertTriangle size={14} />{error}</div>}

          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={mode === 'delete' ? 'danger' : 'primary'} disabled={submitDisabled}>
              {busy ? <Loader2 size={15} className="spin" /> : <ModeIcon mode={mode} />}
              {busy ? 'Working…' : title}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
