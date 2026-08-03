import { useState, type FormEvent } from 'react'
import type { ProjectAnnotationsModel } from '../../hooks/useProjectAnnotations'
import type { JsonValue, ViewerAnnotation } from '../../lib/viewer-tools/types'
import './AnnotationPanel.css'

export interface AnnotationPanelProps<TResult extends JsonValue = JsonValue> {
  readonly model: Pick<
    ProjectAnnotationsModel<TResult>,
    | 'annotations'
    | 'loading'
    | 'error'
    | 'savingIds'
    | 'retry'
    | 'rename'
    | 'setVisible'
    | 'remove'
  >
  readonly onFocus: (annotation: ViewerAnnotation<TResult>) => void
  readonly confirmDelete?: (message: string) => boolean
}

function annotationLabel(annotation: ViewerAnnotation): string {
  return annotation.name?.trim() || `${annotation.toolId} annotation`
}

export function annotationSummary(result: JsonValue): string {
  if (typeof result === 'string') return result
  if (typeof result === 'number' || typeof result === 'boolean') return String(result)
  if (result === null) return 'No result'
  const summary = JSON.stringify(result)
  return summary.length > 120 ? `${summary.slice(0, 117)}…` : summary
}

function formattedDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function AnnotationRow<TResult extends JsonValue>({
  annotation,
  saving,
  onFocus,
  onRename,
  onVisibility,
  onDelete,
}: {
  readonly annotation: ViewerAnnotation<TResult>
  readonly saving: boolean
  readonly onFocus: () => void
  readonly onRename: (name: string) => Promise<boolean>
  readonly onVisibility: (visible: boolean) => Promise<boolean>
  readonly onDelete: () => Promise<boolean>
}) {
  const label = annotationLabel(annotation)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(annotation.name ?? '')

  const submitRename = async (event: FormEvent) => {
    event.preventDefault()
    const nextName = name.trim()
    if (!nextName) return
    if (await onRename(nextName)) setEditing(false)
  }

  return (
    <li className="annotation-panel__item" aria-busy={saving}>
      <header>
        <strong>{label}</strong>
        <span>{annotation.toolId}</span>
      </header>
      <dl>
        <div>
          <dt>Source</dt>
          <dd>{annotation.resourceRef.type}: {annotation.resourceRef.id}</dd>
        </div>
        <div>
          <dt>Summary</dt>
          <dd>{annotationSummary(annotation.result)}</dd>
        </div>
        <div>
          <dt>Visible</dt>
          <dd>{annotation.visible ? 'Shown' : 'Hidden'}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd><time dateTime={annotation.updatedAt}>{formattedDate(annotation.updatedAt)}</time></dd>
        </div>
      </dl>

      {editing ? (
        <form onSubmit={(event) => void submitRename(event)}>
          <label htmlFor={`annotation-name-${annotation.id}`}>Name for {label}</label>
          <input
            id={`annotation-name-${annotation.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={saving}
            autoFocus
          />
          <button type="submit" disabled={saving || !name.trim()} aria-label={`Save name for ${label}`}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} aria-label={`Cancel renaming ${label}`}>
            Cancel
          </button>
        </form>
      ) : null}

      <div className="annotation-panel__actions">
        <button type="button" onClick={onFocus} aria-label={`Focus ${label}`}>
          Focus
        </button>
        <button
          type="button"
          onClick={() => void onVisibility(!annotation.visible)}
          disabled={saving}
          aria-label={`${annotation.visible ? 'Hide' : 'Show'} ${label}`}
        >
          {annotation.visible ? 'Hide' : 'Show'}
        </button>
        <button type="button" onClick={() => setEditing(true)} disabled={saving} aria-label={`Rename ${label}`}>
          Rename
        </button>
        <button type="button" onClick={() => void onDelete()} disabled={saving} aria-label={`Delete ${label}`}>
          Delete
        </button>
      </div>
    </li>
  )
}

export function AnnotationPanel<TResult extends JsonValue = JsonValue>({
  model,
  onFocus,
  confirmDelete = (message) => window.confirm(message),
}: AnnotationPanelProps<TResult>) {
  if (model.loading) {
    return <section className="annotation-panel" aria-label="Project annotations" aria-busy="true">Loading annotations…</section>
  }

  return (
    <section className="annotation-panel" aria-label="Project annotations">
      <header>
        <h2>Annotations</h2>
        <span>{model.annotations.length}</span>
      </header>
      {model.error ? (
        <div role="alert">
          <span>{model.error}</span>
          <button type="button" onClick={() => void model.retry()} aria-label="Retry loading project annotations">
            Retry
          </button>
        </div>
      ) : null}
      {model.annotations.length === 0 ? (
        <p>No annotations in this project.</p>
      ) : (
        <ul>
          {model.annotations.map((annotation) => {
            const label = annotationLabel(annotation)
            return (
              <AnnotationRow
                key={annotation.id}
                annotation={annotation}
                saving={model.savingIds.includes(annotation.id)}
                onFocus={() => onFocus(annotation)}
                onRename={(name) => model.rename(annotation.id, name)}
                onVisibility={(visible) => model.setVisible(annotation.id, visible)}
                onDelete={async () => {
                  if (!confirmDelete(`Delete ${label}? This action cannot be undone.`)) return false
                  return model.remove(annotation.id)
                }}
              />
            )
          })}
        </ul>
      )}
    </section>
  )
}
