import {
  Activity,
  CheckCircle2,
  CircleDashed,
  GitPullRequestDraft,
  Grid3X3,
  Ruler,
  ScanLine,
  Triangle,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useState, useCallback } from 'react'
import type { ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'
import { LazyViewer3D, type ViewerSelection } from './viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import type { UVFFieldInfo } from '../lib/uvf-three'

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
  resourceId,
  geometryResourceId,
  onPlanVolumeMesh,
}: {
  detail: ResourceDetail | null
  resourceId?: string
  geometryResourceId?: string | null
  onPlanVolumeMesh: () => void
}) {
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection>({ groupId: null })
  const [hiddenBoundaries, setHiddenBoundaries] = useState<Set<string>>(new Set())
  const [boundaryGroups, setBoundaryGroups] = useState<string[]>([])
  const [showAllBoundaries, setShowAllBoundaries] = useState(true)

  const handleFieldsDiscovered = useCallback((fields: UVFFieldInfo[]) => {
    const meshQualityFields = fields.filter((f) =>
      /aspect|skew|ortho|quality|size|curvature/i.test(f.name),
    )
    setBoundaryGroups(meshQualityFields.map((f) => f.name))
  }, [])

  const { manifest, state: viewerState, source: previewSource, primaryError } = useResourcePreview(
    detail ? 'SurfaceMesh' : null,
    resourceId ?? detail?.id ?? null,
    detail && geometryResourceId ? 'Geometry' : null,
    geometryResourceId ?? null,
  )
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
    <section className="surface-mesh-workspace cfd-stage-workspace">
      <div className="viewer-section cfd-stage-viewer">
        <LazyViewer3D
          manifest={manifest}
          state={viewerState}
          selection={viewerSelection}
          onSelectionChange={setViewerSelection}
          onFieldsDiscovered={handleFieldsDiscovered}
          toolbar={
            boundaryGroups.length > 0 ? (
              <>
                <button
                  className={showAllBoundaries ? 'active' : ''}
                  onClick={() => {
                    setShowAllBoundaries(!showAllBoundaries)
                    setHiddenBoundaries(new Set())
                  }}
                  aria-label="Toggle all boundaries"
                >
                  {showAllBoundaries ? <Eye size={10} /> : <EyeOff size={10} />}
                  All boundaries
                </button>
                {boundaryGroups.slice(0, 4).map((name) => (
                  <button
                    key={name}
                    className={hiddenBoundaries.has(name) ? '' : 'active'}
                    onClick={() => {
                      const next = new Set(hiddenBoundaries)
                      if (next.has(name)) next.delete(name)
                      else next.add(name)
                      setHiddenBoundaries(next)
                      setShowAllBoundaries(false)
                    }}
                  >
                    {name}
                  </button>
                ))}
              </>
            ) : undefined
          }
        />
        <div className={`cfd-viewer-source ${previewSource === 'fallback' ? 'context' : ''}`} role="status" aria-live="polite">
          <ScanLine size={13} />
          <div>
            <strong id="surface-source-heading">{previewSource === 'fallback' ? 'Geometry context' : 'Surface mesh'}</strong>
            <span id="surface-source-detail">
              {previewSource === 'fallback'
                ? 'The SurfaceMesh render asset is unavailable; this is the parent Geometry, not the mesh.'
                : 'Inspect surface topology, boundaries, and element quality.'}
            </span>
          </div>
        </div>
        <aside className="cfd-decision-panel">
          <div className="mesh-workspace-heading">
            <div>
              <span>SURFACE MESH REVIEW</span>
              <strong>Is the surface discretization trustworthy?</strong>
              <small>{terminal ? `Flow360 status: ${status}` : 'Processing status refreshes automatically.'}</small>
            </div>
            <Activity size={20} />
          </div>
          <div className="mesh-quality-grid cfd-quality-strip">
            {metrics.map(({ label, value, icon: Icon }) => (
              <div key={label}>
                <Icon size={14} />
                <span>{label}</span>
                <strong>{metricText(value)}</strong>
              </div>
            ))}
          </div>
          <div className="geometry-checks">
            {checks.map((check) => (
              <div className={check.ready ? 'ready' : ''} key={check.label}>
                {check.ready ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}
                <span>{check.label}</span>
              </div>
            ))}
            {previewSource === 'fallback' && (
              <div>
                <CircleDashed size={14} />
                <span>Surface diagnostics asset is not available in the current CLI snapshot</span>
              </div>
            )}
          </div>
          <button className="geometry-plan-action" onClick={onPlanVolumeMesh}>
            <GitPullRequestDraft size={15} />
            Plan Volume Mesh
          </button>
          {primaryError && previewSource === 'fallback' && (
            <small className="cfd-source-detail" title={primaryError}>Spatial context fallback is active</small>
          )}
        </aside>
      </div>
      <div className="cfd-stage-guidance">
        <strong>CFD review order</strong>
        <span>1. Feature capture</span>
        <span>2. Boundary grouping</span>
        <span>3. Area / aspect ratio / skewness</span>
        <span>4. Local refinement and boundary-layer intent</span>
      </div>
    </section>
  )
}
