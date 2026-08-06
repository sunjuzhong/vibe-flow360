import { useMemo, useState } from 'react'
import { AlertCircle, Crosshair, Focus, Layers3, Search } from 'lucide-react'
import type { UVFFieldExtrema, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe } from '../../lib/uvf-three'
import type { BoundaryLayerReview, BoundaryLayerRule, BoundaryLayerTarget } from '../../lib/volumeMeshReview'

export type BoundaryLayerTargetRow = BoundaryLayerTarget & {
  ruleId: string
  ruleName: string
  kind: BoundaryLayerRule['kind']
  behavior: BoundaryLayerRule['behavior']
  firstLayerThickness?: string
  growthRate?: string
}

export type BoundaryLayerFilter = 'all' | BoundaryLayerRule['behavior'] | 'unmatched'

export function boundaryLayerTargetRows(review: BoundaryLayerReview): BoundaryLayerTargetRow[] {
  return review.rules.flatMap((rule) => rule.targets.map((target) => ({
    ...target,
    ruleId: rule.id,
    ruleName: rule.name,
    kind: rule.kind,
    behavior: rule.behavior,
    firstLayerThickness: rule.firstLayerThickness,
    growthRate: rule.growthRate,
  })))
}

export function filterBoundaryLayerTargets(
  rows: BoundaryLayerTargetRow[],
  query: string,
  filter: BoundaryLayerFilter,
) {
  const normalized = query.trim().toLocaleLowerCase()
  return rows.filter((row) => {
    if (filter === 'unmatched' ? row.match !== 'unmatched' : filter !== 'all' && row.behavior !== filter) return false
    if (!normalized) return true
    return `${row.key} ${row.name} ${row.ruleName} ${row.kind} ${row.behavior}`.toLocaleLowerCase().includes(normalized)
  })
}

export function BoundaryLayerInspector({
  review,
  field,
  histogram,
  extrema,
  probe,
  entityNames,
  onSelectTarget,
  onLocateExtreme,
}: {
  review: BoundaryLayerReview
  field: UVFFieldInfo | undefined
  histogram: UVFFieldHistogram | null
  extrema: UVFFieldExtrema | null
  probe: UVFFieldProbe | null
  entityNames: Record<string, string>
  onSelectTarget: (groupId: string) => void
  onLocateExtreme: (direction: 'min' | 'max') => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<BoundaryLayerFilter>('all')
  const rows = useMemo(() => boundaryLayerTargetRows(review), [review])
  const filtered = useMemo(() => filterBoundaryLayerTargets(rows, query, filter), [filter, query, rows])
  const activeHistogram = histogram?.field.name === field?.name ? histogram : null
  const activeExtrema = extrema?.field.name === field?.name ? extrema : null
  const activeProbe = probe?.fieldName === field?.name ? probe : null
  const histogramPeak = Math.max(1, ...(activeHistogram?.bins.map((bin) => bin.count) ?? []))

  return (
    <section className="boundary-layer-inspector">
      <div className="geometry-section-title"><Layers3 size={13} /> Boundary-layer intent</div>

      <div className="boundary-layer-defaults">
        <div><span>First layer</span><strong>{review.defaults.firstLayerThickness ?? 'Not reported'}</strong></div>
        <div><span>Growth rate</span><strong>{review.defaults.growthRate ?? 'Not reported'}</strong></div>
        <div><span>Layer count</span><strong>{review.defaults.layerCount ?? (review.defaults.layerCountMode === 'automatic' ? 'Automatic' : 'Not reported')}</strong></div>
      </div>
      <p className="boundary-layer-provenance">These values are meshing inputs, not measured prism-layer results or y+.</p>

      {rows.length > 0 && (
        <div className="boundary-layer-tools">
          <label><Search size={12} /><input type="search" value={query} placeholder="Find rule or surface" aria-label="Search boundary-layer targets" onChange={(event) => setQuery(event.target.value)} /></label>
          <select value={filter} aria-label="Filter boundary-layer targets" onChange={(event) => setFilter(event.target.value as BoundaryLayerFilter)}>
            <option value="all">All targets · {rows.length}</option>
            <option value="grow">Grow layers</option>
            <option value="projected">Projected spacing</option>
            <option value="unchanged">Unchanged spacing</option>
            <option value="unmatched">Unmatched · {review.unmatchedTargetCount}</option>
          </select>
        </div>
      )}

      <div className="boundary-layer-target-list">
        {filtered.map((row) => (
          <div className={`boundary-layer-target ${row.behavior} ${row.match}`} key={`${row.ruleId}-${row.key}-${row.matchedGroupId ?? row.match}`}>
            <button type="button" disabled={!row.matchedGroupId} onClick={() => row.matchedGroupId && onSelectTarget(row.matchedGroupId)}>
              <span>{row.name}</span>
              <small>{row.ruleName} · {row.behavior}</small>
              <em>{row.firstLayerThickness ? `first ${row.firstLayerThickness}` : 'inherits first layer'}{row.growthRate ? ` · growth ${row.growthRate}` : ''}</em>
            </button>
            <span className={`boundary-layer-match ${row.match}`} title={`Entity match: ${row.match}`}>
              {row.matchedGroupId ? <Focus size={12} /> : <AlertCircle size={12} />}
            </span>
          </div>
        ))}
        {rows.length === 0 && <p>No per-surface BoundaryLayer or PassiveSpacing rules were found.</p>}
        {rows.length > 0 && filtered.length === 0 && <p>No targets match the current search and filter.</p>}
      </div>

      <div className="boundary-layer-coverage">
        <span>{review.rules.length} local rules</span>
        <span>{review.matchedTargetCount}/{review.targetCount} targets matched to this render asset</span>
      </div>
      {review.unmatchedTargetCount > 0 && (
        <div className="boundary-layer-warning"><AlertCircle size={13} /> {review.unmatchedTargetCount} target reference(s) cannot be linked to the current manifest. Their configuration is still shown, but viewer focus is unavailable.</div>
      )}

      <div className="boundary-layer-evidence">
        <div className="geometry-section-title">Generated evidence · {review.evidenceFields.length} fields</div>
        {!field && <p>No first-layer, prism, wall-spacing, or layer-count field is present in this UVF asset.</p>}
        {field && (
          <>
            <div className="boundary-layer-field"><strong>{field.name}</strong><span>{field.min.toPrecision(5)} – {field.max.toPrecision(5)}</span></div>
            {activeHistogram && (
              <div className="boundary-layer-histogram" aria-label={`${field.name} distribution, ${activeHistogram.sampleCount} samples`}>
                {activeHistogram.bins.map((bin, index) => <i key={`${bin.min}-${index}`} style={{ height: `${Math.max(3, bin.count / histogramPeak * 100)}%` }} title={`${bin.min.toPrecision(4)} – ${bin.max.toPrecision(4)}: ${bin.count}`} />)}
              </div>
            )}
            {activeExtrema && (
              <div className="boundary-layer-extrema">
                <button type="button" disabled={!activeExtrema.min} onClick={() => onLocateExtreme('min')}><Crosshair size={11} /> Min {activeExtrema.min?.value.toPrecision(5) ?? '—'}</button>
                <button type="button" disabled={!activeExtrema.max} onClick={() => onLocateExtreme('max')}><Crosshair size={11} /> Max {activeExtrema.max?.value.toPrecision(5) ?? '—'}</button>
              </div>
            )}
            {activeProbe && <div className="boundary-layer-probe"><strong>Probe · {entityNames[activeProbe.entityId] ?? activeProbe.entityId}</strong><span>{activeProbe.value.toPrecision(6)}</span><small>{activeProbe.position.map((value) => value.toPrecision(4)).join(', ')}</small></div>}
          </>
        )}
      </div>
    </section>
  )
}
