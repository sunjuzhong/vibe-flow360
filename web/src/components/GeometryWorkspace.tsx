import { Box, CheckCircle2, CircleDashed, GitPullRequestDraft, Ruler, ScanLine, Shapes } from 'lucide-react'
import { useState } from 'react'
import type { ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'
import { LazyViewer3D, type ViewerSelection } from './viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'

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
  resourceId,
  onPlanSurfaceMesh,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  onPlanSurfaceMesh: () => void
}) {
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const { manifest, state: viewerState } = useResourcePreview(
    detail ? 'Geometry' : null,
    resourceId ?? detail?.id ?? null,
  )
  const unit = findFirst(detail?.info, new Set(['length_unit', 'lengthunit', 'project_length_unit', 'unit']))
    ?? findFirst(detail?.simulation_params, new Set(['length_unit', 'lengthunit', 'project_length_unit']))
  const entityCount = findFirst(detail?.summary, new Set(['face_count', 'surface_count', 'entity_count', '_count']))
    ?? manifest?.groups.length
  const status = resourceStatus(detail)
  const checks = [
    { label: 'Geometry processing is complete', ready: ['completed', 'processed', 'success'].includes(status.toLowerCase()) },
    { label: 'Simulation parameters are available', ready: Boolean(detail?.simulation_params && Object.keys(detail.simulation_params).length) },
    { label: 'Flow360 returned no partial-read errors', ready: !detail?.errors || Object.keys(detail.errors).length === 0 },
  ]

  return (
    <section className="geometry-workspace">
      <div className="viewer-section">
        <LazyViewer3D
          manifest={manifest}
          state={viewerState}
          selection={viewerSelection}
          onSelectionChange={setViewerSelection}
        />
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
