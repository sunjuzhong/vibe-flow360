import { Box, CheckCircle2, CircleDashed, GitPullRequestDraft, Ruler, ScanLine, Shapes } from 'lucide-react'
import type { ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'

function findFirst(value: unknown, keys: Set<string>): unknown {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirst(item, keys)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key.toLowerCase()) && child !== null && child !== '') return child
    const found = findFirst(child, keys)
    if (found !== undefined) return found
  }
  return undefined
}

function displayValue(value: unknown) {
  if (value === undefined) return 'Not reported'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && value && 'value' in value) {
    const record = value as { value?: unknown; units?: unknown }
    return `${record.value ?? '—'}${record.units ? ` ${record.units}` : ''}`
  }
  return JSON.stringify(value)
}

export default function GeometryWorkspace({
  detail,
  onPlanSurfaceMesh,
}: {
  detail: ResourceDetail | null
  onPlanSurfaceMesh: () => void
}) {
  const unit = findFirst(detail?.info, new Set(['length_unit', 'lengthunit', 'unit']))
    ?? findFirst(detail?.simulation_params, new Set(['length_unit', 'lengthunit']))
  const entityCount = findFirst(detail?.summary, new Set(['face_count', 'surface_count', 'entity_count', '_count']))
  const status = resourceStatus(detail)
  const checks = [
    { label: 'Geometry processing is complete', ready: ['completed', 'processed', 'success'].includes(status.toLowerCase()) },
    { label: 'Simulation parameters are available', ready: Boolean(detail?.simulation_params && Object.keys(detail.simulation_params).length) },
    { label: 'Flow360 returned no partial-read errors', ready: !detail?.errors || Object.keys(detail.errors).length === 0 },
  ]

  return (
    <section className="geometry-workspace">
      <div className="geometry-viewport">
        <div className="geometry-viewport-grid" aria-hidden="true" />
        <div className="geometry-model-mark" aria-hidden="true"><Box size={48} /></div>
        <div className="geometry-viewport-copy">
          <span><ScanLine size={14} /> Geometry inspection</span>
          <strong>3D asset adapter is not connected yet</strong>
          <small>Metadata and SimulationParams below are live. A renderable geometry artifact will replace this preview when the Flow360 asset endpoint is available.</small>
        </div>
      </div>
      <div className="geometry-preflight">
        <div className="geometry-preflight-heading">
          <div><span>GEOMETRY PREFLIGHT</span><strong>Ready for surface meshing?</strong></div>
          <Shapes size={20} />
        </div>
        <dl className="geometry-facts">
          <div><dt><Ruler size={13} /> Length unit</dt><dd>{displayValue(unit)}</dd></div>
          <div><dt><Shapes size={13} /> Reported entities</dt><dd>{displayValue(entityCount)}</dd></div>
        </dl>
        <div className="geometry-checks">
          {checks.map((check) => (
            <div className={check.ready ? 'ready' : ''} key={check.label}>
              {check.ready ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
              <span>{check.label}</span>
            </div>
          ))}
        </div>
        <button className="geometry-plan-action" onClick={onPlanSurfaceMesh}>
          <GitPullRequestDraft size={15} />
          Plan Surface Mesh
        </button>
      </div>
    </section>
  )
}
