import { Ruler } from 'lucide-react'
import type { DistanceToolModel } from '../../../hooks/useDistanceTool'
import { formatDistance } from './distanceTool'

function vector(value: readonly number[]): string {
  return value.map((part) => Number(part).toPrecision(7)).join(', ')
}

export function DistanceToolPanel({ model }: { model: DistanceToolModel }) {
  if (!model.active && model.session.status !== 'saved') return null
  const { result } = model
  return (
    <section className="geometry-inspection-card" aria-live="polite">
      <div className="geometry-section-title"><Ruler size={13} /> Distance measurement</div>
      {model.session.status === 'armed' && <p>Select first surface point. Press Esc to cancel.</p>}
      {model.session.status === 'collecting' && <p>Select second surface point. Press Esc to cancel.</p>}
      {model.session.status === 'saving' && <p>Saving distance annotation…</p>}
      {model.error && <p className="surface-review-warning">{model.error}</p>}
      {result && (
        <div className="geometry-measurement-result">
          <strong>{formatDistance(result.length)} {result.unit}</strong>
          <dl>
            <div><dt>ΔX / ΔY / ΔZ</dt><dd>{vector(result.deltaXYZ)}</dd></div>
            <div><dt>Start</dt><dd>{vector(result.endpoints[0].position)}</dd></div>
            <div><dt>End</dt><dd>{vector(result.endpoints[1].position)}</dd></div>
          </dl>
        </div>
      )}
      {(model.session.status === 'complete-draft' || model.session.status === 'error') && (
        <div className="surface-advanced-toolbar" role="group" aria-label="Distance draft actions">
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
      {model.session.status === 'saved' && (
        <div className="surface-advanced-toolbar">
          <span>Saved to project annotations.</span>
          <button type="button" onClick={model.retry}>Measure again</button>
          <button type="button" onClick={model.discard}>Close</button>
        </div>
      )}
    </section>
  )
}
