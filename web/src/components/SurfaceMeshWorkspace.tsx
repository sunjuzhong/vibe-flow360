import {
  Activity,
  CheckCircle2,
  CircleDashed,
  GitPullRequestDraft,
  Grid3X3,
  Ruler,
  ScanLine,
  Triangle,
} from 'lucide-react'
import type { ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'

function findMetric(value: unknown, aliases: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findMetric(item, aliases)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const [key, child] of Object.entries(value)) {
    if (aliases.includes(key.toLowerCase())) return child
    const found = findMetric(child, aliases)
    if (found !== undefined) return found
  }
  return undefined
}

function metricText(value: unknown) {
  if (value === undefined || value === null || value === '') return 'Not reported'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'value' in value) {
    const metric = value as { value?: unknown; units?: unknown }
    return `${metric.value ?? '—'}${metric.units ? ` ${metric.units}` : ''}`
  }
  return JSON.stringify(value)
}

export default function SurfaceMeshWorkspace({
  detail,
  onPlanVolumeMesh,
}: {
  detail: ResourceDetail | null
  onPlanVolumeMesh: () => void
}) {
  const source = detail?.summary ?? detail?.state ?? detail?.simulation_params
  const status = resourceStatus(detail)
  const terminal = ['completed', 'processed', 'success', 'failed', 'error'].includes(status.toLowerCase())
  const metrics = [
    {
      label: 'Surface elements',
      value: findMetric(source, ['face_count', 'surface_element_count', 'element_count', 'num_faces']),
      icon: Grid3X3,
    },
    {
      label: 'Minimum edge',
      value: findMetric(source, ['min_edge_length', 'minimum_edge_length', 'min_length']),
      icon: Ruler,
    },
    {
      label: 'Maximum aspect ratio',
      value: findMetric(source, ['max_aspect_ratio', 'maximum_aspect_ratio', 'aspect_ratio']),
      icon: Triangle,
    },
    {
      label: 'Maximum skewness',
      value: findMetric(source, ['max_skewness', 'maximum_skewness', 'skewness']),
      icon: ScanLine,
    },
  ]
  const checks = [
    { label: 'Surface mesh reached a terminal success state', ready: ['completed', 'processed', 'success'].includes(status.toLowerCase()) },
    { label: 'Simulation parameters are available', ready: Boolean(detail?.simulation_params && Object.keys(detail.simulation_params).length) },
    { label: 'No partial Flow360 reads were reported', ready: !detail?.errors || Object.keys(detail.errors).length === 0 },
  ]

  return (
    <section className="surface-mesh-workspace">
      <div className="mesh-workspace-heading">
        <div>
          <span>SURFACE MESH WORKSPACE</span>
          <strong>Quality and volume-mesh readiness</strong>
          <small>{terminal ? 'The resource is terminal. Review quality before planning the volume mesh.' : 'Processing status refreshes automatically every 10 seconds.'}</small>
        </div>
        <Activity size={21} />
      </div>
      <div className="mesh-quality-grid">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div key={label}>
            <Icon size={15} />
            <span>{label}</span>
            <strong>{metricText(value)}</strong>
          </div>
        ))}
      </div>
      <div className="mesh-readiness-row">
        <div className="geometry-checks">
          {checks.map((check) => (
            <div className={check.ready ? 'ready' : ''} key={check.label}>
              {check.ready ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
              <span>{check.label}</span>
            </div>
          ))}
        </div>
        <button className="geometry-plan-action" onClick={onPlanVolumeMesh}>
          <GitPullRequestDraft size={15} />
          Plan Volume Mesh
        </button>
      </div>
    </section>
  )
}
