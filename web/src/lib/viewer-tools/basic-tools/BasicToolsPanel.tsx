import type { ViewerToolsModel } from '../../../hooks/useViewerTools'
import type { BasicToolId } from './geometry'
import { basicToolResultSummary } from './geometry'

export function BasicToolsPanel({
  model,
  onToggle = model.toggle,
}: {
  readonly model: ViewerToolsModel
  readonly onToggle?: (toolId: BasicToolId) => void
}) {
  return (
    <section className="geometry-inspection-card" aria-label="Viewer drawing and measurement tools" aria-live="polite">
      <div className="geometry-section-title">Drawing and measurement tools</div>
      <div className="surface-advanced-toolbar" role="toolbar" aria-label="Viewer tools">
        {model.tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            aria-pressed={model.active && model.activeToolId === tool.id}
            onClick={() => onToggle(tool.id as typeof model.activeToolId)}
          >
            {tool.label}
          </button>
        ))}
      </div>

      {model.active && (
        <div>
          <strong>{model.definition.label}</strong>
          {model.prompt && <p>{model.prompt}</p>}
          {model.notice && <p role="status">{model.notice}</p>}
          {model.error && <p className="surface-review-warning" role="alert">{model.error}</p>}
          {model.resultSummary && <p>{model.resultSummary}</p>}
          {(model.session.status === 'complete-draft' || model.session.status === 'error') && (
            <div className="surface-advanced-toolbar" role="group" aria-label={`${model.definition.label} draft actions`}>
              {model.session.status === 'complete-draft' && (
                <button type="button" onClick={() => { void model.save() }}>Save</button>
              )}
              {model.session.status === 'error' && model.session.cause === 'save' && (
                <button type="button" onClick={model.resumeDraft}>Return to draft</button>
              )}
              <button type="button" onClick={model.retry}>Retry</button>
              <button type="button" onClick={model.discard}>Discard</button>
            </div>
          )}
          {model.session.status === 'saving' && <p>Saving {model.definition.label.toLowerCase()}…</p>}
        </div>
      )}

      {model.session.status === 'saved' && (
        <div className="surface-advanced-toolbar">
          <span>Saved to project annotations.</span>
          <button type="button" onClick={() => model.activate(model.activeToolId)}>Create another</button>
          <button type="button" onClick={model.discard}>Close</button>
        </div>
      )}

      {model.savedAnnotations.length > 0 && (
        <div>
          <strong>Saved on this resource</strong>
          <ul>
            {model.savedAnnotations.map((annotation) => (
              <li key={annotation.id}>
                {annotation.name?.trim() || annotation.toolId}: {basicToolResultSummary(annotation.result)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
