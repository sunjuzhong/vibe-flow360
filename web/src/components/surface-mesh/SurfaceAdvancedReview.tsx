import { Camera, GitCompare, Ruler, Scissors, Sparkles } from 'lucide-react'
import type { ProjectItem } from '../../api/client'
import type { UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe } from '../../lib/uvf-three'
import type {
  SurfaceParameterDifference,
  SurfaceRemediationRecommendation,
} from '../../lib/surfaceMeshAdvanced'

export function SurfaceAdvancedToolbar({
  clipping,
  measuring,
  onToggleClipping,
  onToggleMeasuring,
  onCapture,
}: {
  clipping: boolean
  measuring: boolean
  onToggleClipping: () => void
  onToggleMeasuring: () => void
  onCapture: () => void
}) {
  return (
    <div className="surface-advanced-toolbar" role="group" aria-label="Advanced surface review tools">
      <button
        type="button"
        className={clipping ? 'active' : ''}
        aria-pressed={clipping}
        onClick={onToggleClipping}
      >
        <Scissors size={11} /> Clip
      </button>
      <button
        type="button"
        className={measuring ? 'active' : ''}
        aria-pressed={measuring}
        onClick={onToggleMeasuring}
      >
        <Ruler size={11} /> Measure
      </button>
      <button type="button" onClick={onCapture}>
        <Camera size={11} /> Export PNG
      </button>
    </div>
  )
}

export function SurfaceAdvancedReview({
  versions,
  compareId,
  comparisonName,
  loading,
  error,
  parameterDifferences,
  baselineHistogram,
  comparisonHistogram,
  qualityError,
  clipEnabled,
  clipAxis,
  clipPosition,
  field,
  probe,
  remediationBusy,
  remediationError,
  onCompareId,
  onClipEnabled,
  onClipAxis,
  onClipPosition,
  onCreateRemediation,
}: {
  versions: ProjectItem[]
  compareId: string
  comparisonName?: string
  loading: boolean
  error: string
  parameterDifferences: SurfaceParameterDifference[]
  baselineHistogram: UVFFieldHistogram | null
  comparisonHistogram: UVFFieldHistogram | null
  qualityError?: string
  clipEnabled: boolean
  clipAxis: 'x' | 'y' | 'z'
  clipPosition: number
  field?: UVFFieldInfo
  probe: UVFFieldProbe | null
  remediationBusy: boolean
  remediationError: string
  onCompareId: (id: string) => void
  onClipEnabled: (enabled: boolean) => void
  onClipAxis: (axis: 'x' | 'y' | 'z') => void
  onClipPosition: (position: number) => void
  onCreateRemediation: () => void
}) {
  return (
    <details className="surface-advanced-review">
      <summary><span><GitCompare size={14} /> Advanced review</span><small>Compare · Clip · Measure · AI patch</small></summary>
      <div className="surface-advanced-content">
        <label className="surface-compare-select">
          Compare with
          <select value={compareId} onChange={(event) => onCompareId(event.target.value)}>
            <option value="">Select another SurfaceMesh…</option>
            {versions.map((version) => <option key={version.id} value={version.id}>{version.name}</option>)}
          </select>
        </label>
        {loading && <p>Loading comparison metadata and quality field…</p>}
        {error && <p className="surface-review-warning">{error}</p>}
        {compareId && !loading && !error && (
          <div className="surface-comparison-result">
            <strong>Current ↔ {comparisonName ?? compareId}</strong>
            <span>{parameterDifferences.length} parameter difference(s)</span>
            {parameterDifferences.slice(0, 8).map((difference) => (
              <div className={`surface-parameter-diff ${difference.kind}`} key={difference.path}>
                <span title={difference.path}>{difference.label}</span>
                <small>{difference.baseline ?? '—'} → {difference.comparison ?? '—'}</small>
              </div>
            ))}
            {baselineHistogram && comparisonHistogram ? (
              <div className="surface-quality-comparison">
                <MiniHistogram label="Current" histogram={baselineHistogram} />
                <MiniHistogram label={comparisonName ?? 'Comparison'} histogram={comparisonHistogram} />
              </div>
            ) : qualityError ? <p>{qualityError}</p> : <p>Select a shared quality field to compare distributions.</p>}
          </div>
        )}
        <div className="surface-advanced-controls">
          <label>
            <input
              type="checkbox"
              checked={clipEnabled}
              onChange={(event) => onClipEnabled(event.target.checked)}
            />
            Clipping plane
          </label>
          {clipEnabled && (
            <>
              <select value={clipAxis} onChange={(event) => onClipAxis(event.target.value as 'x' | 'y' | 'z')}>
                <option value="x">X plane</option>
                <option value="y">Y plane</option>
                <option value="z">Z plane</option>
              </select>
              <input
                aria-label="Clipping plane position"
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={clipPosition}
                onChange={(event) => onClipPosition(Number(event.target.value))}
              />
            </>
          )}
        </div>
        <div className="surface-remediation">
          <strong><Sparkles size={11} /> Evidence-backed remediation</strong>
          <p>
            {field && probe
              ? `${field.name} = ${probe.value.toPrecision(6)} on ${probe.entityId}. Generate a draft SurfaceMesh patch for preflight and approval.`
              : 'Select a quality field and probe or locate its worst region first.'}
          </p>
          <button
            type="button"
            disabled={!field || !probe || remediationBusy}
            onClick={onCreateRemediation}
          >
            <Sparkles size={11} /> {remediationBusy ? 'Creating draft…' : 'Create AI review plan'}
          </button>
          {remediationError && <p className="surface-review-warning">{remediationError}</p>}
        </div>
      </div>
    </details>
  )
}

function MiniHistogram({ label, histogram }: { label: string; histogram: UVFFieldHistogram }) {
  const peak = Math.max(...histogram.bins.map((bin) => bin.count), 1)
  return (
    <div>
      <span>{label}</span>
      <div>
        {histogram.bins.map((bin, index) => (
          <i
            key={`${bin.min}-${index}`}
            style={{ height: `${Math.max(3, bin.count / peak * 100)}%` }}
            title={`${bin.min.toPrecision(4)}–${bin.max.toPrecision(4)}: ${bin.count}`}
          />
        ))}
      </div>
      <small>{histogram.sampleCount} samples</small>
    </div>
  )
}

export type { SurfaceRemediationRecommendation }
