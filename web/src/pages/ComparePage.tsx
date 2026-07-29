import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  GitCompare,
  GitPullRequestDraft,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  api,
  type CompareResult,
  type Flow360Status,
  type ProjectInfo,
  type ProjectItem,
  type SweepResult,
} from '../api/client'
import TopBar from '../components/TopBar'

function valueText(value: unknown) {
  if (value === undefined) return '—'
  if (value === null) return 'Removed'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function toggleCaseSelection(selectedIds: string[], id: string) {
  return selectedIds.includes(id)
    ? selectedIds.filter((selected) => selected !== id)
    : [...selectedIds, id]
}

export function parseSweepValues(input: string) {
  return input
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value))
}

export default function ComparePage() {
  const { projectId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedIds = useMemo(
    () => (searchParams.get('cases') ?? '').split(',').filter(Boolean),
    [searchParams],
  )
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [cases, setCases] = useState<ProjectItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CompareResult | null>(null)
  const [compareLoading, setCompareLoading] = useState(false)
  const [parameterName, setParameterName] = useState('operating_condition.alpha.value')
  const [parameterValues, setParameterValues] = useState('0, 5, 10')
  const [sweep, setSweep] = useState<SweepResult | null>(null)
  const [sweepLoading, setSweepLoading] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
    Promise.all([api.projectInfo(projectId), api.projectItems(projectId)])
      .then(([info, items]) => {
        setProject(info.data)
        setCases(items.data.items.filter((item) => item.type === 'Case'))
      })
      .catch((cause) => setError(String(cause).replace('Error: ', '')))
      .finally(() => setLoading(false))
  }, [projectId])

  const toggleCase = (id: string) => {
    const next = toggleCaseSelection(selectedIds, id)
    const params = new URLSearchParams(searchParams)
    if (next.length) params.set('cases', next.join(','))
    else params.delete('cases')
    setSearchParams(params, { replace: true })
    setResult(null)
    setSweep(null)
    setConfirmed(false)
  }

  const runCompare = async () => {
    setCompareLoading(true)
    setError('')
    try {
      setResult(await api.compareCases(selectedIds))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setCompareLoading(false)
    }
  }

  const values = parseSweepValues(parameterValues)
  const baseline = cases.find((item) => item.id === selectedIds[0])

  const previewSweep = async (createPlans = false) => {
    if (!baseline) return
    setSweepLoading(true)
    setError('')
    try {
      setSweep(await api.sweep({
        baseline_case_id: baseline.id,
        baseline_name: baseline.name,
        project_id: projectId,
        project_name: project?.name,
        parameters: [{ name: parameterName.trim(), values }],
        create_plans: createPlans,
        confirmed: createPlans && confirmed,
      }))
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setSweepLoading(false)
    }
  }

  return (
    <div className="compare-page">
      <TopBar status={status} />
      <header className="compare-header">
        <Link to={`/projects/${encodeURIComponent(projectId)}`}><ArrowLeft size={15} /> Project</Link>
        <div>
          <p className="eyebrow">CASE DECISION WORKSPACE</p>
          <h1><GitCompare size={24} /> Compare Cases</h1>
          <p>{project?.name ?? projectId} · selections are restored from this URL</p>
        </div>
      </header>

      {loading && <div className="project-load-state"><RefreshCw className="spin" /> Loading Cases…</div>}
      {error && <div className="project-cache-warning"><AlertCircle size={14} />{error}</div>}

      {!loading && (
        <main className="compare-layout">
          <aside className="compare-selector">
            <div className="detail-section-heading">
              <div><strong>Select Cases</strong><span>First selection is the baseline.</span></div>
              <span>{selectedIds.length} selected</span>
            </div>
            <div className="compare-case-list">
              {cases.map((item) => (
                <label key={item.id} className={selectedIds.includes(item.id) ? 'selected' : ''}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(item.id)}
                    onChange={() => toggleCase(item.id)}
                  />
                  <span><strong>{item.name}</strong><small>{item.id}</small></span>
                  {selectedIds[0] === item.id && <em>Baseline</em>}
                </label>
              ))}
              {!cases.length && <div className="detail-empty">This Project has no Cases.</div>}
            </div>
            <button
              className="geometry-plan-action"
              disabled={selectedIds.length < 2 || compareLoading}
              onClick={runCompare}
            >
              {compareLoading ? <RefreshCw size={15} className="spin" /> : <GitCompare size={15} />}
              Compare {selectedIds.length || ''} Cases
            </button>
          </aside>

          <section className="compare-results">
            {!result && (
              <div className="compare-empty">
                <GitCompare size={24} />
                <strong>Select at least two Cases</strong>
                <p>The comparison keeps numerical convergence separate from completed run state.</p>
              </div>
            )}
            {result && (
              <>
                <div className="compare-card-grid">
                  {result.cases.map((item, index) => (
                    <article key={item.id}>
                      <span>{index === 0 ? 'BASELINE' : 'CANDIDATE'}</span>
                      <h3>{item.name}</h3>
                      <small>{item.status}</small>
                      <div className={`convergence-banner convergence-${item.convergence?.status ?? 'insufficient-data'}`}>
                        <BarChart3 size={15} />
                        <div>
                          <strong>{item.convergence?.status ?? 'insufficient-data'}</strong>
                          <p>{item.convergence?.reason ?? 'No convergence evidence.'}</p>
                        </div>
                      </div>
                      <dl>
                        {(item.kpis ?? []).map((kpi) => (
                          <div key={kpi.name}>
                            <dt>{kpi.name}</dt>
                            <dd>{kpi.value} {kpi.unit}</dd>
                            <small>{kpi.source}</small>
                          </div>
                        ))}
                      </dl>
                      <Link to={`/projects/${projectId}/resources/${item.id}`}>
                        <GitPullRequestDraft size={13} /> Open to plan variation
                      </Link>
                    </article>
                  ))}
                </div>
                <section className="compare-diffs">
                  <h2>SimulationParams differences</h2>
                  {result.diffs.map((diff) => (
                    <div key={`${diff.compared_to ?? 'candidate'}-${diff.path}`}>
                      <code>{diff.path}{diff.compared_to ? ` → ${diff.compared_to}` : ''}</code>
                      <span>{valueText(diff.baseline)}</span>
                      <span>{valueText(diff.other)}</span>
                    </div>
                  ))}
                  {!result.diffs.length && <p>No semantic parameter differences found.</p>}
                </section>
              </>
            )}

            {baseline && (
              <section className="sweep-builder">
                <div>
                  <p className="eyebrow">REVIEWED VARIATIONS</p>
                  <h2>Parameter Sweep</h2>
                  <p>Creates local draft plans only. Every plan still requires individual approval before Flow360 execution.</p>
                </div>
                <label>
                  SimulationParams path
                  <input value={parameterName} onChange={(event) => setParameterName(event.target.value)} />
                </label>
                <label>
                  Values, comma separated
                  <input value={parameterValues} onChange={(event) => setParameterValues(event.target.value)} />
                </label>
                <button onClick={() => previewSweep(false)} disabled={!parameterName.trim() || !values.length || sweepLoading}>
                  {sweepLoading ? <RefreshCw size={14} className="spin" /> : <BarChart3 size={14} />} Preview sweep
                </button>
                {sweep && (
                  <div className={`sweep-review ${sweep.plan.over_budget ? 'blocked' : ''}`}>
                    <strong>{sweep.plan.total_cases} review plans</strong>
                    <span>Recommended maximum: {sweep.plan.max_recommended}</span>
                    {(sweep.warnings ?? []).map((warning) => <p key={warning}><AlertCircle size={13} />{warning}</p>)}
                    {(sweep.plans ?? []).length > 0 && (
                      <p><CheckCircle2 size={14} /> {(sweep.plans ?? []).length} idempotent draft plans created.</p>
                    )}
                    {!sweep.plan.over_budget && (sweep.plans ?? []).length === 0 && (
                      <>
                        <label className="sweep-confirm">
                          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
                          I confirm the combination count and want to create local review plans.
                        </label>
                        <button className="geometry-plan-action" disabled={!confirmed || sweepLoading} onClick={() => previewSweep(true)}>
                          <GitPullRequestDraft size={14} /> Create review plans
                        </button>
                      </>
                    )}
                  </div>
                )}
              </section>
            )}
          </section>
        </main>
      )}
    </div>
  )
}
