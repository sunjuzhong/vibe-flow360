import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Box,
  CheckCircle2,
  Download,
  FileOutput,
  GitCompare,
  GitPullRequestDraft,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  TableProperties,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import {
  api,
  type CaseComparison,
  type CompareResult,
  type Flow360Status,
  type ProjectInfo,
  type ProjectItem,
  type SweepResult,
} from '../api/client'
import Flow360IdLink from '../components/Flow360IdLink'
import JsonPreview from '../components/JsonPreview'
import { ResultFileComparisonDialog } from '../components/ResultFileComparisonDialog'
import TopBar from '../components/TopBar'
import { LazyViewer3D, type ViewerCameraCommand, type ViewerCameraState } from '../components/viewer/LazyViewer3D'
import { useResourcePreview } from '../hooks/useResourcePreview'
import { useI18n } from '../i18n'

type CompareView = 'evidence' | 'visual' | 'files' | 'parameters' | 'sweep'

function valueText(value: unknown) {
  if (value === undefined) return '—'
  if (value === null) return 'Removed'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function CompareParameterValue({ value }: { value: unknown }) {
  if (value !== null && typeof value === 'object') {
    return <JsonPreview value={value} className="compare-json-preview" />
  }
  return <span className="compare-scalar-value">{valueText(value)}</span>
}

function formatBytes(value?: number) {
  if (!value) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(1)} GB`
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

export function buildArtifactMatrix(cases: CaseComparison[]) {
  const paths = [...new Set(cases.flatMap((item) => (item.artifacts ?? []).map((artifact) => artifact.path)))].sort()
  return paths.map((path) => ({
    path,
    category: cases.flatMap((item) => item.artifacts ?? []).find((artifact) => artifact.path === path)?.category ?? 'other',
    byCase: Object.fromEntries(cases.map((item) => [item.id, (item.artifacts ?? []).find((artifact) => artifact.path === path)])),
  }))
}

function CompareViewport({ item, projectId, selectedField, onSelectedFieldChange, wireframe, onWireframeChange, cameraCommand, cameraState, onCameraStateChange }: {
  item: CaseComparison
  projectId: string
  selectedField: string | null
  onSelectedFieldChange: (field: string | null) => void
  wireframe: boolean
  onWireframeChange: (wireframe: boolean) => void
  cameraCommand: ViewerCameraCommand | null
  cameraState: ViewerCameraState | null
  onCameraStateChange: (state: ViewerCameraState) => void
}) {
  const { t } = useI18n()
  const { manifest, state, source } = useResourcePreview('Case', item.id)
  return (
    <article className="compare-viewport-card">
      <header>
        <div><span>{item.name}</span><small>{item.id}</small></div>
        <strong>{source === 'fallback' ? t('Context only') : source === 'primary' ? t('Case result asset') : t('Loading')}</strong>
      </header>
      <div className="compare-viewport">
        <LazyViewer3D
          manifest={manifest}
          state={state}
          selectedField={selectedField}
          onSelectedFieldChange={onSelectedFieldChange}
          wireframe={wireframe}
          onWireframeChange={onWireframeChange}
          cameraCommand={cameraCommand}
          cameraState={cameraState}
          onCameraStateChange={onCameraStateChange}
          projectId={projectId}
          showWarnings={false}
          showEntityLegend={false}
        />
      </div>
    </article>
  )
}

export default function ComparePage() {
  const { t, language } = useI18n()
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
  const [activeView, setActiveView] = useState<CompareView>('evidence')
  const [visualCandidateId, setVisualCandidateId] = useState('')
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [wireframe, setWireframe] = useState(false)
  const [cameraCommand, setCameraCommand] = useState<ViewerCameraCommand | null>(null)
  const [cameraSync, setCameraSync] = useState<{ sourceId: string; state: ViewerCameraState } | null>(null)
  const [analysis, setAnalysis] = useState('')
  const [analysisQuestion, setAnalysisQuestion] = useState('')
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [filePreview, setFilePreview] = useState<{ path: string; caseIds: string[]; contents: Record<string, string>; loading: boolean; error?: string } | null>(null)
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
    setAnalysis('')
    setSweep(null)
    setConfirmed(false)
  }

  const runCompare = async () => {
    setCompareLoading(true)
    setError('')
    try {
      const next = await api.compareCases(selectedIds)
      setResult(next)
      setVisualCandidateId(next.cases[1]?.id ?? '')
      setCameraSync(null)
      setActiveView('evidence')
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setCompareLoading(false)
    }
  }

  const runAIAnalysis = async () => {
    setAnalysisLoading(true)
    setAnalysisError('')
    try {
      const response = await api.analyzeCaseComparison(selectedIds, language, analysisQuestion.trim() || undefined)
      setAnalysis(response.analysis)
    } catch (cause) {
      setAnalysisError(String(cause).replace('Error: ', ''))
    } finally {
      setAnalysisLoading(false)
    }
  }

  const previewCommonFile = async (path: string, compareCases: CaseComparison[]) => {
    const caseIds = compareCases.map((item) => item.id)
    setFilePreview({ path, caseIds, contents: {}, loading: true })
    try {
      const entries = await Promise.all(compareCases.map(async (item) => [item.id, await api.previewResult('Case', item.id, path)] as const))
      setFilePreview({ path, caseIds, contents: Object.fromEntries(entries), loading: false })
    } catch (cause) {
      setFilePreview({ path, caseIds, contents: {}, loading: false, error: String(cause).replace('Error: ', '') })
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

  const artifactMatrix = result ? buildArtifactMatrix(result.cases) : []
  const baselineResult = result?.cases[0]
  const visualCandidate = result?.cases.find((item) => item.id === visualCandidateId) ?? result?.cases[1]
  const views: Array<{ id: CompareView; label: string; icon: typeof GitCompare; count?: number }> = [
    { id: 'evidence', label: t('Evidence'), icon: BarChart3 },
    { id: 'visual', label: t('Visual compare'), icon: Box },
    { id: 'files', label: t('Result files'), icon: FileOutput, count: artifactMatrix.length },
    { id: 'parameters', label: t('Parameters'), icon: TableProperties, count: result?.diffs.length },
    { id: 'sweep', label: t('Sweep'), icon: SlidersHorizontal },
  ]

  return (
    <div className="compare-page">
      <TopBar status={status} />
      <header className="compare-header">
        <div className="compare-header-inner">
          <Link to={`/projects/${encodeURIComponent(projectId)}`}><ArrowLeft size={15} /> {t('Project')}</Link>
          <div>
            <p className="eyebrow">{t('CASE DECISION WORKSPACE')}</p>
            <h1><GitCompare size={24} /> {t('Compare Cases')}</h1>
            <p>{project?.name ?? projectId} · {t('Compare setup, evidence, fields, and result artifacts before making a decision.')}</p>
          </div>
        </div>
      </header>

      {loading && <div className="project-load-state"><RefreshCw className="spin" /> {t('Loading Cases…')}</div>}
      {error && <div className="project-cache-warning"><AlertCircle size={14} />{error}</div>}

      {!loading && (
        <main className="compare-workbench">
          <section className="compare-picker">
            <div className="compare-picker-heading">
              <div><strong>{t('Select Cases')}</strong><span>{t('First selection is the baseline.')}</span></div>
              <span>{t('{count} selected').replace('{count}', String(selectedIds.length))}</span>
            </div>
            <div className="compare-case-list">
              {cases.map((item) => (
                <label key={item.id} className={`compare-case-option ${selectedIds.includes(item.id) ? 'selected' : ''}`}>
                  <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleCase(item.id)} />
                  <span><strong>{item.name}</strong><small>{item.id}</small></span>
                  {selectedIds[0] === item.id && <em>{t('Baseline')}</em>}
                </label>
              ))}
              {!cases.length && <div className="detail-empty">{t('This Project has no Cases.')}</div>}
            </div>
            <button className="geometry-plan-action" disabled={selectedIds.length < 2 || compareLoading} onClick={runCompare}>
              {compareLoading ? <RefreshCw size={15} className="spin" /> : <GitCompare size={15} />}
              {t('Compare selected Cases')}
            </button>
          </section>

          {!result && (
            <section className="compare-empty">
              <GitCompare size={26} />
              <strong>{t('Select at least two Cases')}</strong>
              <p>{t('The baseline and candidates will be compared across convergence, KPIs, result files, visualization evidence, and SimulationParams.')}</p>
            </section>
          )}

          {result && (
            <>
              <nav className="compare-view-tabs" role="tablist" aria-label={t('Comparison evidence views')}>
                {views.map(({ id, label, icon: Icon, count }) => (
                  <button key={id} type="button" role="tab" aria-selected={activeView === id} className={activeView === id ? 'active' : ''} onClick={() => setActiveView(id)}>
                    <Icon size={14} /><span>{label}</span>{count !== undefined && <small>{count}</small>}
                  </button>
                ))}
              </nav>

              {activeView === 'evidence' && (
                <div className="compare-evidence-layout">
                  <section className="compare-evidence-panel">
                    <div className="compare-section-heading">
                      <div><p className="eyebrow">{t('DECISION EVIDENCE')}</p><h2>{t('Case evidence matrix')}</h2></div>
                      <span>{t('Completed is not the same as converged or credible.')}</span>
                    </div>
                    <div className="compare-case-evidence-grid" style={{ '--compare-columns': result.cases.length } as React.CSSProperties}>
                      {result.cases.map((item, index) => (
                        <article key={item.id}>
                          <header><span>{index === 0 ? t('BASELINE') : t('CANDIDATE')}</span><strong>{item.name}</strong><small>{item.status}</small></header>
                          <div className={`compare-convergence-state convergence-${item.convergence?.status ?? 'insufficient-data'}`}>
                            <BarChart3 size={15} /><span><strong>{t(item.convergence?.status ?? 'insufficient-data')}</strong><small>{t(item.convergence?.reason ?? 'No convergence evidence.')}</small></span>
                          </div>
                          <dl>
                            {(item.kpis ?? []).map((kpi) => <div key={kpi.name}><dt>{kpi.name}</dt><dd>{kpi.value.toPrecision(6)} {kpi.unit}</dd><small>{kpi.source}</small></div>)}
                            <div><dt>{t('Result artifacts')}</dt><dd>{item.artifacts?.length ?? 0}</dd><small>{[...new Set((item.artifacts ?? []).map((artifact) => artifact.category))].join(' · ') || t('None')}</small></div>
                            <div><dt>{t('Visualization evidence')}</dt><dd>{item.visualization?.available ? t('Available') : t('Unavailable')}</dd><small>{t('{count} configured outputs').replace('{count}', String(item.visualization?.output_count ?? 0))}</small></div>
                          </dl>
                          <Link to={`/projects/${projectId}/resources/${item.id}`}><GitPullRequestDraft size={13} /> {t('Open Case')}</Link>
                        </article>
                      ))}
                    </div>
                  </section>

                  <aside className="compare-ai-panel">
                    <div className="compare-ai-heading"><span><Sparkles size={16} /></span><div><strong>{t('AI difference analysis')}</strong><small>{t('Uses parameters and result evidence together')}</small></div></div>
                    {!analysis && <p>{t('Ask AI to connect setup changes with convergence, KPI, artifact, and visualization evidence. Unsupported causal claims must be identified as hypotheses.')}</p>}
                    {analysis && <div className="compare-ai-answer"><ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis}</ReactMarkdown></div>}
                    <textarea value={analysisQuestion} onChange={(event) => setAnalysisQuestion(event.target.value)} placeholder={t('Optional: What decision are you trying to make?')} />
                    {analysisError && <div className="compare-ai-error"><AlertCircle size={13} />{analysisError}</div>}
                    <button type="button" disabled={analysisLoading} onClick={() => void runAIAnalysis()}>
                      {analysisLoading ? <RefreshCw className="spin" size={14} /> : <Sparkles size={14} />}
                      {analysis ? t('Analyze again') : t('Analyze differences')}
                    </button>
                  </aside>
                </div>
              )}

              {activeView === 'visual' && baselineResult && visualCandidate && (
                <section className="compare-visual-panel">
                  <div className="compare-section-heading">
                    <div><p className="eyebrow">{t('FLOW-FIELD REVIEW')}</p><h2>{t('Side-by-side visual comparison')}</h2></div>
                    <label>{t('Candidate')}<select value={visualCandidate.id} onChange={(event) => setVisualCandidateId(event.target.value)}>{result.cases.slice(1).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
                  </div>
                  <div className="compare-visual-toolbar">
                    <span>{t('Drag, pan, zoom, fields, and wireframe are synchronized between both viewers.')}</span>
                    {(['fit', 'x', 'y', 'z', 'iso'] as const).map((command) => <button type="button" key={command} onClick={() => setCameraCommand({ type: command, nonce: Date.now() })}>{command.toUpperCase()}</button>)}
                  </div>
                  <div className="compare-viewport-grid">
                    {[baselineResult, visualCandidate].map((item) => <CompareViewport
                      key={item.id}
                      item={item}
                      projectId={projectId}
                      selectedField={selectedField}
                      onSelectedFieldChange={setSelectedField}
                      wireframe={wireframe}
                      onWireframeChange={setWireframe}
                      cameraCommand={cameraCommand}
                      cameraState={cameraSync?.sourceId === item.id ? null : cameraSync?.state ?? null}
                      onCameraStateChange={(state) => setCameraSync({ sourceId: item.id, state })}
                    />)}
                  </div>
                  <div className="compare-compatibility-note"><AlertCircle size={14} /><span><strong>{t('Numerical difference fields require compatibility checks.')}</strong>{t('Topology, coordinates, field definitions, normalization, and time alignment must match before subtraction. Until then, this view is an evidence-aligned side-by-side comparison.')}</span></div>
                </section>
              )}

              {activeView === 'files' && (
                <section className="compare-files-panel">
                  <div className="compare-section-heading"><div><p className="eyebrow">{t('RESULT INVENTORY')}</p><h2>{t('Result file coverage')}</h2></div><span>{t('Common files can be opened side by side; missing files remain visible as evidence gaps.')}</span></div>
                  <div className="compare-file-matrix" style={{ '--compare-columns': result.cases.length } as React.CSSProperties}>
                    <div className="compare-file-head"><strong>{t('Artifact')}</strong>{result.cases.map((item) => <strong key={item.id}>{item.name}</strong>)}</div>
                    {artifactMatrix.map((row) => {
                      const comparableCases = result.cases.filter((item) => row.byCase[item.id]?.previewable)
                      return <div className="compare-file-row" key={row.path}>
                        <div><strong title={row.path}>{row.path.split('/').pop()}</strong><small>{row.category}</small>{comparableCases.length >= 2 && <button type="button" onClick={() => void previewCommonFile(row.path, comparableCases)}>{t('Compare file')}</button>}</div>
                        {result.cases.map((item) => {
                          const artifact = row.byCase[item.id]
                          return <div key={item.id} className={artifact ? 'available' : 'missing'}>{artifact ? <><CheckCircle2 size={13} /><span>{formatBytes(artifact.size_bytes)}</span><button type="button" aria-label={t('Download result')} onClick={() => void api.downloadResult('Case', item.id, artifact.path)}><Download size={12} /></button></> : <span>{t('Missing')}</span>}</div>
                        })}
                      </div>
                    })}
                    {!artifactMatrix.length && <div className="detail-empty">{t('No result artifacts reported.')}</div>}
                  </div>
                </section>
              )}

              {activeView === 'parameters' && (
                <section className="compare-diffs">
                  <div className="compare-section-heading"><div><p className="eyebrow">{t('SETUP DELTA')}</p><h2>{t('SimulationParams differences')}</h2></div><span>{t('{count} semantic differences').replace('{count}', String(result.diffs.length))}</span></div>
                  <div className="compare-diff-head"><span>{t('Path')}</span><span>{t('Baseline value')}</span><span>{t('Candidate value')}</span></div>
                  {result.diffs.map((diff) => <div className="compare-diff-row" key={`${diff.compared_to ?? 'candidate'}-${diff.path}`}><code>{diff.path}<small>{diff.compared_to}</small></code><div className="compare-diff-value"><CompareParameterValue value={diff.baseline} /></div><div className="compare-diff-value"><CompareParameterValue value={diff.other} /></div></div>)}
                  {!result.diffs.length && <p>{t('No semantic parameter differences found.')}</p>}
                </section>
              )}

              {activeView === 'sweep' && baseline && (
                <section className="sweep-builder">
                  <div><p className="eyebrow">{t('REVIEWED VARIATIONS')}</p><h2>{t('Parameter Sweep')}</h2><p>{t('Creates review revisions for each Draft. Every revision still requires individual approval before Flow360 execution.')}</p></div>
                  <label>{t('SimulationParams path')}<input value={parameterName} onChange={(event) => setParameterName(event.target.value)} /></label>
                  <label>{t('Values, comma separated')}<input value={parameterValues} onChange={(event) => setParameterValues(event.target.value)} /></label>
                  <button onClick={() => previewSweep(false)} disabled={!parameterName.trim() || !values.length || sweepLoading}>{sweepLoading ? <RefreshCw size={14} className="spin" /> : <BarChart3 size={14} />} {t('Preview sweep')}</button>
                  {sweep && <div className={`sweep-review ${sweep.plan.over_budget ? 'blocked' : ''}`}><strong>{t('{count} Draft reviews').replace('{count}', String(sweep.plan.total_cases))}</strong><span>{t('Recommended maximum: {count}').replace('{count}', String(sweep.plan.max_recommended))}</span>{(sweep.warnings ?? []).map((warning) => <p key={warning}><AlertCircle size={13} />{warning}</p>)}{(sweep.plans ?? []).length > 0 && <p><CheckCircle2 size={14} /> {t('{count} idempotent Draft reviews created.').replace('{count}', String((sweep.plans ?? []).length))}</p>}{!sweep.plan.over_budget && (sweep.plans ?? []).length === 0 && <><label className="sweep-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{t('I confirm the combination count and want to create Draft reviews.')}</label><button className="geometry-plan-action" disabled={!confirmed || sweepLoading} onClick={() => previewSweep(true)}><GitPullRequestDraft size={14} /> {t('Create Draft reviews')}</button></>}</div>}
                </section>
              )}
            </>
          )}
          {filePreview && result && <ResultFileComparisonDialog
            path={filePreview.path}
            loading={filePreview.loading}
            error={filePreview.error}
            cases={filePreview.caseIds.map((caseId) => {
              const item = result.cases.find((candidate) => candidate.id === caseId)
              return { id: caseId, name: item?.name ?? caseId, content: filePreview.contents[caseId] }
            })}
            onClose={() => setFilePreview(null)}
          />}
        </main>
      )}
    </div>
  )
}
