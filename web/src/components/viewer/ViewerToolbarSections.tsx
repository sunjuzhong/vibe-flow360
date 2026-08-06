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
          {goal}
        </div>
      )}
      {actions && (
        <div className="viewer-toolbar-section viewer-action-toolbar" role="group" aria-label="Viewer actions">
          {actions}
        </div>
      )}
    </div>
  )
}
