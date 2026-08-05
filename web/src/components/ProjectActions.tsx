import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ProjectRecord } from '../api/client'

export type ProjectMutationMode = 'rename' | 'delete'

export default function ProjectActions({
  project,
  onAction,
}: {
  project: ProjectRecord
  onAction: (mode: ProjectMutationMode, project: ProjectRecord) => void
}) {
  const [open, setOpen] = useState(false)

  const run = (mode: ProjectMutationMode) => {
    setOpen(false)
    onAction(mode, project)
  }

  return (
    <div className="project-actions">
      <button
        type="button"
        className="project-actions-trigger"
        aria-label={`Manage ${project.name}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="project-actions-menu" role="menu" aria-label={`Project actions for ${project.name}`}>
          <button type="button" role="menuitem" onClick={() => run('rename')}><Pencil size={13} /> Rename</button>
          <button type="button" role="menuitem" className="danger" onClick={() => run('delete')}><Trash2 size={13} /> Delete</button>
        </div>
      )}
    </div>
  )
}
