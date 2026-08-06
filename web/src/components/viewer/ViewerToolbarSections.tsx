import type { ReactNode } from 'react'

export function ViewerToolbarSections({
  goal,
  actions,
}: {
  goal?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="viewer-toolbar-sections">
      {goal && (
        <div className="viewer-toolbar-section viewer-goal-toolbar" role="group" aria-label="Target workflow controls">
          <span className="viewer-toolbar-section-label">Review</span>
          {goal}
        </div>
      )}
      {actions && (
        <div className="viewer-toolbar-section viewer-action-toolbar" role="group" aria-label="Viewer actions">
          <span className="viewer-toolbar-section-label">Actions</span>
          {actions}
        </div>
      )}
    </div>
  )
}
