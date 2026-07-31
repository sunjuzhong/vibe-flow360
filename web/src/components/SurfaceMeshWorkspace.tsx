import {
  Activity,
  Box,
  CheckCircle2,
  CircleDashed,
  GitPullRequestDraft,
  Grid3X3,
  Layers3,
  Palette,
  Ruler,
  ScanLine,
  Triangle,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ResourceDetail } from '../api/client'
import { resourceStatus } from './ResourceDetailPanel'
import { LazyViewer3D, type ViewerSelection } from './viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import type { UVFFieldInfo } from '../lib/uvf-three'
import {
  buildSurfaceBoundaryInventory,
  classifySurfaceMeshQualityFields,
  surfaceMeshParameterSummary,
} from '../lib/surfaceMeshReview'

type SurfaceViewMode = 'plain' | 'boundaries' | 'quality'

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
  const [viewMode, setViewMode] = useState<SurfaceViewMode>('boundaries')
  const [qualityFields, setQualityFields] = useState<UVFFieldInfo[]>([])
  const [selectedQualityField, setSelectedQualityField] = useState<string | null>(null)

  const { manifest, state: viewerState, source: previewSource, primaryError } = useResourcePreview(
    detail ? 'SurfaceMesh' : null,
    resourceId ?? detail?.id ?? null,
    detail && geometryResourceId ? 'Geometry' : null,
    geometryResourceId ?? null,
  )
  const boundaryInventory = useMemo(
    () => buildSurfaceBoundaryInventory(manifest?.groups ?? [], detail?.simulation_params),
    [detail?.simulation_params, manifest?.groups],
  )
  const surfaceParameters = useMemo(
    () => surfaceMeshParameterSummary(detail?.simulation_params),
    [detail?.simulation_params],
  )
  const selectedBoundary = boundaryInventory.find((row) => row.id === viewerSelection.groupId)
  const selectedFieldInfo = qualityFields.find((field) => field.name === selectedQualityField)
  const assignedBoundaryCount = boundaryInventory.filter((row) => row.status === 'assigned').length
  const boundaryConflictCount = boundaryInventory.filter((row) => row.status === 'conflict').length
  const handleFieldsDiscovered = (fields: UVFFieldInfo[]) => {
    const nextQualityFields = classifySurfaceMeshQualityFields(fields)
    setQualityFields(nextQualityFields)
    setSelectedQualityField((current) => (
      current && nextQualityFields.some((field) => field.name === current)
        ? current
        : nextQualityFields[0]?.name ?? null
    ))
  }
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
      <div className={`viewer-section cfd-stage-viewer surface-mode-${viewMode}`}>
        <LazyViewer3D
          manifest={manifest}
          state={viewerState}
          selection={viewerSelection}
          onSelectionChange={setViewerSelection}
          selectedField={viewMode === 'quality' ? selectedQualityField : null}
          onSelectedFieldChange={setSelectedQualityField}
          onFieldsDiscovered={handleFieldsDiscovered}
          showFieldPanel={viewMode === 'quality'}
          showEntityLegend={viewMode === 'boundaries'}
          toolbar={(
            <div className="surface-view-modes" role="group" aria-label="Surface mesh display mode">
              <button
                type="button"
                className={viewMode === 'plain' ? 'active' : ''}
                aria-pressed={viewMode === 'plain'}
                onClick={() => setViewMode('plain')}
              >
                <Box size={11} /> Plain
              </button>
              <button
                type="button"
                className={viewMode === 'boundaries' ? 'active' : ''}
                aria-pressed={viewMode === 'boundaries'}
                onClick={() => setViewMode('boundaries')}
              >
                <Layers3 size={11} /> Boundaries
              </button>
              <button
                type="button"
                className={viewMode === 'quality' ? 'active' : ''}
                aria-pressed={viewMode === 'quality'}
                onClick={() => setViewMode('quality')}
              >
                <Palette size={11} /> Mesh Quality
              </button>
            </div>
          )}
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
          <div className="surface-review-section">
            <div className="surface-review-heading">
              <span>
                {viewMode === 'quality'
                  ? 'QUALITY FIELDS'
                  : viewMode === 'boundaries' ? 'BOUNDARY ASSIGNMENTS' : 'DISPLAY SUMMARY'}
              </span>
              {viewMode === 'quality'
                ? <strong>{qualityFields.length} available</strong>
                : viewMode === 'boundaries'
                  ? <strong>{assignedBoundaryCount}/{boundaryInventory.length} assigned</strong>
                  : <strong>{manifest?.elements?.toLocaleString() ?? '—'} elements</strong>}
            </div>
            {viewMode === 'quality' ? (
              selectedFieldInfo ? (
                <button
                  type="button"
                  className="surface-quality-field active"
                  onClick={() => setViewMode('quality')}
                >
                  <span>{selectedFieldInfo.name}</span>
                  <small>{selectedFieldInfo.kind} · {selectedFieldInfo.min.toPrecision(4)} – {selectedFieldInfo.max.toPrecision(4)}</small>
                </button>
              ) : (
                <p>No area, aspect-ratio, skewness, or other surface-quality field is present in this manifest.</p>
              )
            ) : viewMode === 'boundaries' ? (
              <div className="surface-boundary-list">
                {boundaryInventory.length > 0 ? boundaryInventory.slice(0, 8).map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    className={`${row.status} ${viewerSelection.groupId === row.id ? 'selected' : ''}`}
                    onClick={() => setViewerSelection({ groupId: row.id })}
                  >
                    <span>{row.name}</span>
                    <small>
                      {row.assignments.length > 0
                        ? row.assignments.map((assignment) => assignment.modelName).join(', ')
                        : 'Unassigned'}
                    </small>
                  </button>
                )) : <p>No Face entities are present in the current render asset.</p>}
              </div>
            ) : (
              <p>
                Plain mode shows the unclassified surface discretization without boundary colors or diagnostic fields.
                Use it to inspect silhouette, feature capture, and local element density.
              </p>
            )}
            {viewMode === 'boundaries' && selectedBoundary && (
              <p className="surface-selected-detail">
                Selected: {selectedBoundary.name} · {selectedBoundary.triangles?.toLocaleString() ?? '—'} triangles
              </p>
            )}
            {viewMode === 'boundaries' && boundaryConflictCount > 0 && (
              <p className="surface-review-warning">{boundaryConflictCount} face group(s) have multiple model assignments.</p>
            )}
          </div>
          <details className="surface-parameter-summary">
            <summary>Surface meshing parameters <span>{surfaceParameters.length}</span></summary>
            {surfaceParameters.length > 0 ? (
              <dl>
                {surfaceParameters.map((parameter) => (
                  <div key={parameter.path}>
                    <dt title={parameter.path}>{parameter.label}</dt>
                    <dd>{parameter.value}</dd>
                  </div>
                ))}
              </dl>
            ) : <p>No SurfaceMesh-specific parameters were found.</p>}
          </details>
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
