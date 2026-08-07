import { Eye, EyeOff } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import type { ProjectAnnotationsModel } from '../../hooks/useProjectAnnotations'
import type { JsonValue, ViewerAnnotation } from '../../lib/viewer-tools/types'
import './AnnotationPanel.css'

export interface AnnotationPanelProps<TResult extends JsonValue = JsonValue> {
  readonly model: Pick<
    ProjectAnnotationsModel<TResult>,
    | 'annotations'
    | 'loading'
    | 'stale'
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

export type AnnotationVisibilityFilter = 'all' | 'visible' | 'hidden'

function resourceKey(annotation: ViewerAnnotation): string {
  return JSON.stringify([annotation.resourceRef.type, annotation.resourceRef.id])
}

function toolLabel(toolId: string): string {
  return toolId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export function filterAnnotations<TResult extends JsonValue>(
  annotations: readonly ViewerAnnotation<TResult>[],
  visibility: AnnotationVisibilityFilter,
  toolId: string,
  resource: string,
): readonly ViewerAnnotation<TResult>[] {
  return annotations.filter((annotation) => {
    if (visibility === 'visible' && !annotation.visible) return false
    if (visibility === 'hidden' && annotation.visible) return false
    if (toolId && annotation.toolId !== toolId) return false
    if (resource && resourceKey(annotation) !== resource) return false
    return true
  })
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
    <li
      className={`annotation-panel__item ${annotation.visible ? 'is-visible' : 'is-hidden'}`}
      aria-busy={saving}
    >
      <header>
        <div className="annotation-panel__title">
          <strong>{label}</strong>
          <span className="annotation-panel__tool">{toolLabel(annotation.toolId)}</span>
        </div>
        <span className={`annotation-panel__status ${annotation.visible ? 'is-visible' : 'is-hidden'}`}>
          {annotation.visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
          {annotation.visible ? 'Visible' : 'Hidden'}
        </span>
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
          <dt>Updated</dt>
          <dd><time dateTime={annotation.updatedAt}>{formattedDate(annotation.updatedAt)}</time></dd>
        </div>
      </dl>

      {editing ? (
        <form onSubmit={(event) => void submitRename(event)}>
          <label htmlFor={`annotation-name-${annotation.id}`}>{`Name for ${label}`}</label>
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
          className="annotation-panel__visibility"
          onClick={() => void onVisibility(!annotation.visible)}
          disabled={saving}
          aria-label={`${annotation.visible ? 'Hide' : 'Show'} ${label}`}
          aria-pressed={annotation.visible}
        >
          {annotation.visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
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
  const [visibility, setVisibility] = useState<AnnotationVisibilityFilter>('all')
  const [toolId, setToolId] = useState('')
  const [resource, setResource] = useState('')

  const toolIds = useMemo(
    () => [...new Set(model.annotations.map((annotation) => annotation.toolId))].sort(),
    [model.annotations],
  )
  const resources = useMemo(() => {
    const unique = new Map<string, ViewerAnnotation['resourceRef']>()
    model.annotations.forEach((annotation) => unique.set(resourceKey(annotation), annotation.resourceRef))
    return [...unique.entries()].sort((left, right) => {
      const leftLabel = `${left[1].type} ${left[1].id}`
      const rightLabel = `${right[1].type} ${right[1].id}`
      return leftLabel.localeCompare(rightLabel)
    })
  }, [model.annotations])
  const filteredAnnotations = useMemo(
    () => filterAnnotations(model.annotations, visibility, toolId, resource),
    [model.annotations, resource, toolId, visibility],
  )

  if (model.loading && model.annotations.length === 0) {
    return <section className="annotation-panel" aria-label="Project annotations" aria-busy="true">Loading annotations…</section>
  }

  return (
    <section className="annotation-panel" aria-label="Project annotations" aria-busy={model.loading}>
      <header>
        <h2>Annotations</h2>
        <span aria-label={`${filteredAnnotations.length} of ${model.annotations.length} annotations`}>
          {filteredAnnotations.length} / {model.annotations.length}
        </span>
      </header>
      {model.loading ? (
        <div className="annotation-panel__sync-status" role="status">
          Refreshing annotations from the local server…
        </div>
      ) : null}
      {model.error ? (
        <div className="annotation-panel__load-error" role="alert">
          <span>
            {model.error}
            {model.stale ? ' Showing the last data loaded from the local server.' : ''}
          </span>
          <button type="button" onClick={() => void model.retry()} aria-label="Retry loading project annotations">
            Retry
          </button>
        </div>
      ) : null}
      {model.annotations.length > 0 ? (
        <div className="annotation-panel__filters" aria-label="Annotation filters">
          <div className="annotation-panel__visibility-filter" role="group" aria-label="Filter by visibility">
            {(['all', 'visible', 'hidden'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={visibility === option ? 'is-active' : undefined}
                aria-pressed={visibility === option}
                onClick={() => setVisibility(option)}
              >
                {toolLabel(option)}
              </button>
            ))}
          </div>
          <label>
            <span>Tool</span>
            <select value={toolId} onChange={(event) => setToolId(event.target.value)}>
              <option value="">All tools</option>
              {toolIds.map((value) => <option key={value} value={value}>{toolLabel(value)}</option>)}
            </select>
          </label>
          <label>
            <span>Resource</span>
            <select value={resource} onChange={(event) => setResource(event.target.value)}>
              <option value="">All resources</option>
              {resources.map(([key, resourceRef]) => (
                <option key={key} value={key}>{resourceRef.type} · {resourceRef.id}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {model.annotations.length === 0 ? (
        <p>No annotations in this project.</p>
      ) : filteredAnnotations.length === 0 ? (
        <p className="annotation-panel__empty">No annotations match the selected filters.</p>
      ) : (
        <ul>
          {filteredAnnotations.map((annotation) => {
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
