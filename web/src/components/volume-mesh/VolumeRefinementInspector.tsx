import { AlertTriangle, Box, CircleDot, Crosshair, Info, ScanSearch } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { VolumeRefinementKind, VolumeRefinementReview } from '../../lib/volumeRefinementReview'

type RefinementFilter = 'all' | VolumeRefinementKind | 'issues'

export function VolumeRefinementInspector({
  review,
  selectedRegionId,
  onSelectRegion,
  onFocusRegion,
  onSelectTarget,
}: {
  review: VolumeRefinementReview
  selectedRegionId: string | null
  onSelectRegion: (regionId: string) => void
  onFocusRegion: (regionId: string) => void
  onSelectTarget: (groupId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<RefinementFilter>('all')
  const issueRuleIds = useMemo(() => new Set(review.diagnostics.flatMap((diagnostic) => {
    const regionIds = new Set(diagnostic.regionIds)
    return review.rules.filter((rule) => rule.regions.some((region) => regionIds.has(region.id))
      || diagnostic.id.startsWith(`${rule.id}-`)).map((rule) => rule.id)
  })), [review.diagnostics, review.rules])
  const rules = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return review.rules.filter((rule) => {
      if (filter === 'issues' ? !issueRuleIds.has(rule.id) : filter !== 'all' && rule.kind !== filter) return false
      if (!normalized) return true
      return [rule.name, rule.kind, ...rule.regions.map((region) => region.name), ...rule.unresolvedTargets]
        .join(' ').toLocaleLowerCase().includes(normalized)
    })
  }, [filter, issueRuleIds, query, review.rules])
  const regionById = new Map(review.regions.map((region) => [region.id, region]))

  return (
    <section className="volume-refinement-inspector">
      <div className="geometry-section-title"><ScanSearch size={13} /> Refinement zone review</div>
      <div className="volume-refinement-summary">
        <div><span>Rules</span><strong>{review.rules.length}</strong></div>
        <div><span>3D regions</span><strong>{review.visualizableCount}</strong></div>
        <div><span>Diagnostics</span><strong>{review.diagnostics.length}</strong></div>
      </div>
      <p className="volume-refinement-provenance">Overlays show configured refinement geometry in the asset-local frame. They are not generated cell-size evidence.</p>

      {review.rules.length > 0 && (
        <div className="volume-refinement-tools">
          <input type="search" value={query} placeholder="Find refinement or target" aria-label="Search refinements" onChange={(event) => setQuery(event.target.value)} />
          <select value={filter} aria-label="Filter refinements" onChange={(event) => setFilter(event.target.value as RefinementFilter)}>
            <option value="all">All types</option>
            <option value="uniform">Uniform</option>
            <option value="axisymmetric">Axisymmetric</option>
            <option value="structured-box">Structured box</option>
            <option value="surface">Surface</option>
            <option value="issues">With diagnostics</option>
          </select>
        </div>
      )}

      <div className="volume-refinement-rule-list">
        {rules.map((rule) => (
          <article key={rule.id}>
            <header><span>{rule.kind}</span><strong>{rule.name}</strong><small>{rule.targetCount} target(s)</small></header>
            {rule.spacings.length > 0 && (
              <dl>{rule.spacings.map((spacing) => <div key={spacing.key}><dt>{spacing.label}</dt><dd>{spacing.value}</dd></div>)}</dl>
            )}
            <div className="volume-refinement-regions">
              {rule.regions.map((region) => (
                <button type="button" className={selectedRegionId === region.id ? 'selected' : ''} key={region.id} onClick={() => { onSelectRegion(region.id); onFocusRegion(region.id) }}>
                  {region.kind === 'box' ? <Box size={12} /> : <CircleDot size={12} />}
                  <span><strong>{region.name}</strong><small>{region.kind}{region.unit ? ` · ${region.unit}` : ''}</small></span>
                  <Crosshair size={11} />
                </button>
              ))}
              {rule.matchedTargets.map((target) => (
                <button type="button" key={target.id} onClick={() => onSelectTarget(target.id)}>
                  <ScanSearch size={12} /><span><strong>{target.name}</strong><small>manifest target</small></span><Crosshair size={11} />
                </button>
              ))}
            </div>
            {rule.unresolvedTargets.length > 0 && <p className="volume-refinement-unresolved"><AlertTriangle size={11} /> Unresolved: {rule.unresolvedTargets.join(', ')}</p>}
            {rule.targetCount === 0 && <p className="volume-refinement-unresolved"><AlertTriangle size={11} /> No target was configured.</p>}
          </article>
        ))}
        {review.rules.length === 0 && <p>No non-boundary-layer volume refinement was found.</p>}
        {review.rules.length > 0 && rules.length === 0 && <p>No refinement matches the current search and filter.</p>}
      </div>

      {review.diagnostics.length > 0 && (
        <div className="volume-refinement-diagnostics">
          <strong>Coverage diagnostics</strong>
          {review.diagnostics.map((diagnostic) => (
            <button type="button" className={diagnostic.severity} key={diagnostic.id} disabled={!diagnostic.regionIds.some((id) => regionById.has(id))} onClick={() => {
              const regionId = diagnostic.regionIds.find((id) => regionById.has(id))
              if (regionId) onFocusRegion(regionId)
            }}>
              {diagnostic.severity === 'warning' ? <AlertTriangle size={12} /> : <Info size={12} />}
              <span><strong>{diagnostic.title}</strong><small>{diagnostic.detail}</small></span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
