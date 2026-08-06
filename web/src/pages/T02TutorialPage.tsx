import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, GitBranch, Layers3, RotateCcw, ShieldCheck, UploadCloud } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Flow360Status } from '../api/client'
import T02EnvironmentBuilder from '../components/T02EnvironmentBuilder'
import TopBar from '../components/TopBar'
import { t02Paths, t02Progress, t02Steps } from '../tutorials/t02'

type PathKey = keyof typeof t02Paths
const storageKey = 'vibesim.tutorial.T02.completed'
function readProgress() { try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value : [] } catch { return [] } }

function PathSelector({ selected, onSelect }: { selected: PathKey; onSelect: (value: PathKey) => void }) {
  return <div className="alpha-control" role="group" aria-label="Project root type">{(Object.keys(t02Paths) as PathKey[]).map((key) => <button key={key} className={selected === key ? 'active' : ''} onClick={() => onSelect(key)}><span>{t02Paths[key].root} root</span><strong>{t02Paths[key].required.join(' → ')}</strong></button>)}</div>
}

export default function T02TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [selected, setSelected] = useState<PathKey>('surface-mesh')
  const step = t02Steps[stepIndex]
  useEffect(() => { api.flow360Status().then(setStatus).catch(() => setStatus({ available: false })) }, [])
  useEffect(() => localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])
  const finish = () => { setCompleted((items) => items.includes(step.id) ? items : [...items, step.id]); setStepIndex((value) => Math.min(value + 1, t02Steps.length - 1)) }
  const path = t02Paths[selected]

  const lesson = () => {
    if (step.id === 'question') return <><div className="lesson-kicker"><GitBranch size={15}/> Workflow intent</div><h1>Start from the earliest artifact you still need to change.</h1><p className="lesson-lead">A later Project root is faster only because it declares upstream work already trusted. Choose the root from engineering provenance—not file convenience.</p><PathSelector selected={selected} onSelect={setSelected}/><div className="lesson-decision-card"><span>DECISION</span><strong>{path.best}</strong><p>Root type controls the resource tree, available stages, and validation context.</p></div></>
    if (step.id === 'tree') return <><div className="lesson-kicker"><Layers3 size={15}/> Resource tree</div><h1>The root removes ancestors; it does not merely hide them.</h1><PathSelector selected={selected} onSelect={setSelected}/><div className="run-readiness-card"><div className="run-ready-icon"><GitBranch size={28}/></div><div><span>{path.root.toUpperCase()} ROOT</span><strong>{path.required.join(' → ')}</strong><p>{path.skipped.length ? `Not present: ${path.skipped.join(', ')}.` : 'The complete Geometry-to-Case chain remains available.'}</p></div></div></>
    if (step.id === 'stages') return <><div className="lesson-kicker"><CheckCircle2 size={15}/> Stage ownership</div><h1>Skipped means supplied and trusted—not automatically verified.</h1><div className="parameter-learning-grid">{(Object.keys(t02Paths) as PathKey[]).map((key) => <article key={key}><div><span className={`provenance ${key === selected ? 'provided' : 'inferred'}`}>{t02Paths[key].root}</span><strong>{t02Paths[key].required.length} remaining stage(s)</strong></div><b>{t02Paths[key].required.join(' → ')}</b><p>{t02Paths[key].best}</p></article>)}</div></>
    if (step.id === 'validation') return <><div className="lesson-kicker"><ShieldCheck size={15}/> Validation context</div><h1>Validation begins at the Project root.</h1><div className="setup-checks"><div className="passed"><CheckCircle2/><span><strong>Geometry</strong><small>Checks meshing, physics, boundaries, outputs, and Case setup.</small></span></div><div className="passed"><CheckCircle2/><span><strong>SurfaceMesh</strong><small>Checks volume meshing plus Case setup; CAD grouping is no longer available.</small></span></div><div className="passed"><CheckCircle2/><span><strong>VolumeMesh</strong><small>Checks Case physics and outputs; mesh quality must come from upstream evidence.</small></span></div></div><div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>Boundary names are asset-specific</strong>No tutorial can safely preassign arbitrary uploaded mesh boundaries. Review mapping before approval.</p></div></>
    if (step.id === 'decision') return <><div className="lesson-kicker"><GitBranch size={15}/> Reuse decision</div><h1>Choose the narrowest root that preserves your next decision.</h1><PathSelector selected={selected} onSelect={setSelected}/><div className="evidence-checklist"><button className="reviewed"><span className="evidence-check"><Check/></span><span><strong>Need to change CAD or surface groups?</strong><small>Choose Geometry.</small></span></button><button className="reviewed"><span className="evidence-check"><Check/></span><span><strong>Surface mesh approved, volume spacing still open?</strong><small>Choose SurfaceMesh.</small></span></button><button className="reviewed"><span className="evidence-check"><Check/></span><span><strong>Complete mesh approved, physics study only?</strong><small>Choose VolumeMesh.</small></span></button></div></>
    return <><div className="lesson-kicker"><UploadCloud size={15}/> Web creation boundary</div><h1>Upload a trusted mesh and create the review environment.</h1><p className="lesson-lead">The Web app creates the selected mesh-root Project and α 0°/5° Case Plans. It does not run volume meshing or a solver.</p><T02EnvironmentBuilder status={status}/></>
  }

  return <div className="tutorial-player-page"><TopBar status={status} title="Guided tutorial · T02"/><aside className="tutorial-outline"><Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link><div className="tutorial-outline-title"><span>T02</span><h2>Choose the right Project entry path</h2><small>Workflow · 12–15 min</small></div><div className="tutorial-progress"><div><span>Progress</span><strong>{t02Progress(completed)}%</strong></div><progress value={t02Progress(completed)} max="100"/></div><nav>{t02Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav><button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setSelected('surface-mesh') }}><RotateCcw size={13}/> Reset progress</button></aside><main className="tutorial-lesson"><div className="lesson-content">{lesson()}</div><footer className="lesson-footer"><button className="lesson-previous" disabled={!stepIndex} onClick={() => setStepIndex((value) => value - 1)}><ArrowLeft size={15}/> Previous</button><span>Step {stepIndex + 1} of {t02Steps.length}</span>{stepIndex < t02Steps.length - 1 ? <button className="lesson-next" onClick={finish}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((items) => items.includes(step.id) ? items : [...items, step.id])}><Check size={15}/> Mark tutorial complete</button>}</footer></main></div>
}
