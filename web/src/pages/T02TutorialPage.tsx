import { AlertTriangle, ArrowLeft, ArrowRight, Calculator, Check, CheckCircle2, Cloud, Download, Gauge, GitCompare, RotateCcw, ShieldCheck, Sparkles, Target, Wind } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { TutorialConceptBridge, TutorialDerivations, TutorialEvidenceRubric, TutorialFailureModes, TutorialPrediction, TutorialTransferCheck } from '../components/TutorialTeachingBlocks'
import { createT02Environment, t02Evidence, t02ParameterCards, t02Params, t02Pedagogy, t02Progress, t02Steps, validateT02Setup } from '../tutorials/t02'

const storageKey = 'vibesim.tutorial.T02.completed'

function readProgress() {
  try { const value = JSON.parse(window.localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] }
}

function downloadJSON(params: Record<string, unknown>, matched: boolean) {
  const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `T02-${matched ? 'mach-reynolds-matched' : 'mach-only'}.simulation.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function SimilarityVisual({ matched = false }: { matched?: boolean }) {
  return <svg className="tutorial-airfoil" viewBox="0 0 680 270" role="img" aria-label={`${matched ? 'Mach and Reynolds matched' : 'Mach-only ambient'} wind-tunnel condition`}>
    <defs><linearGradient id="tunnel" x1="0" x2="1"><stop stopColor="#eef4dc"/><stop offset="1" stopColor="#dce9b4"/></linearGradient></defs>
    <rect x="45" y="55" width="590" height="150" rx="16" fill="url(#tunnel)" stroke="#7a8d41" strokeWidth="2"/>
    {[88, 122, 156].map((y) => <path key={y} d={`M70 ${y} H600`} stroke="#9fb66a" strokeWidth="1.5" strokeDasharray="7 8"/>)}
    <path d="M300 133 C350 104 432 108 500 132 C432 154 350 158 300 133Z" fill="#f9faf4" stroke="#4d5b49" strokeWidth="2.5"/>
    <Wind x="75" y="18"/><text x="110" y="36">Mach 0.18 · 61.25 m/s</text>
    <text x="88" y="236">ρ = {matched ? '0.730' : '1.225'} kg/m³</text><text x="330" y="236">Re chord = {matched ? '6.0M' : '10.1M'}</text>
  </svg>
}

export default function T02TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [matched, setMatched] = useState(false)
  const [checksVisible, setChecksVisible] = useState(false)
  const [reviewed, setReviewed] = useState<string[]>([])
  const params = useMemo(() => t02Params(matched), [matched])
  const checks = useMemo(() => validateT02Setup(params), [params])
  const step = t02Steps[stepIndex]
  useEffect(() => { api.flow360Status().then(setStatus).catch(() => setStatus({ available: false })) }, [])
  useEffect(() => window.localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])
  const finishStep = () => { setCompleted((current) => current.includes(step.id) ? current : [...current, step.id]); setStepIndex((current) => Math.min(current + 1, t02Steps.length - 1)) }

  const lesson = () => {
    switch (step.id) {
      case 'question': return <>
        <div className="lesson-kicker"><Sparkles size={15}/> Engineering condition</div>
        <h1>Does matching Mach 0.18 reproduce the wind-tunnel flow?</h1>
        <p className="lesson-lead">The target aircraft test uses a 2.4 m reference chord, Mach 0.18, 4° angle of attack, 288.15 K air, and chord Reynolds number six million. Every one of these quantities participates in the comparison.</p>
        <div className="lesson-decision-card"><span>DECISION</span><strong>Use ambient density or match the experiment’s Reynolds number?</strong><p>Accept the operating condition only when compressibility, viscous similarity, scale, and coefficient references agree.</p></div>
        <div className="lesson-objectives"><div><Wind/><span><strong>Match compressibility</strong>Convert Mach and temperature into velocity.</span></div><div><Gauge/><span><strong>Match viscosity effects</strong>Use density, velocity, chord, and viscosity to reproduce Reynolds number.</span></div><div><ShieldCheck/><span><strong>Compare valid evidence</strong>Keep geometry, models, references, and review windows fixed.</span></div></div>
        <TutorialConceptBridge cfd={t02Pedagogy.cfdConcepts} flow360={t02Pedagogy.flow360Concepts}/>
      </>
      case 'derive': return <>
        <div className="lesson-kicker"><Calculator size={15}/> Similarity calculation</div>
        <h1>Mach fixes velocity; density determines whether Reynolds also matches.</h1>
        <p className="lesson-lead">At 288.15 K, Mach 0.18 gives 61.25 m/s. Standard density then produces about 10.1 million chord Reynolds—well above the six-million target.</p>
        <div className="airfoil-stage"><SimilarityVisual/></div>
        <div className="geometry-assumptions"><div><span>MACH</span><strong>0.18</strong><small>compressibility ratio</small></div><div><span>CHORD</span><strong>2.4 m</strong><small>Reynolds length</small></div><div><span>TARGET RE</span><strong>6.0M</strong><small>wind-tunnel condition</small></div></div>
        <TutorialDerivations items={t02Pedagogy.derivations}/>
      </>
      case 'map': return <>
        <div className="lesson-kicker"><Gauge size={15}/> Flow360 condition mapping</div>
        <h1>Store the engineering inputs and inspect the derived state.</h1>
        <p className="lesson-lead">The baseline uses from_mach with ambient ThermalState. The matched variant uses from_mach_reynolds with 2.5 million per project metre, allowing Flow360 to derive the required density.</p>
        <div className="parameter-learning-grid">{t02ParameterCards.map((item) => <article key={item.label}><div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div><b>{item.value}</b><p>{item.why}</p></article>)}</div>
        <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate the selected operating condition</button>
        {checksVisible && <div className="setup-checks">{checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>{check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
      </>
      case 'variant': return <>
        <div className="lesson-kicker"><GitCompare size={15}/> Controlled thermal-state change</div>
        <h1>Reduce density to match viscous similarity without changing Mach.</h1>
        <p className="lesson-lead">The matched Draft keeps 61.25 m/s, 288.15 K, 4° alpha, geometry, models, mesh, and outputs fixed. Density falls from 1.225 to 0.730 kg/m³.</p>
        <TutorialPrediction experiment={t02Pedagogy.experiments[0]}/>
        <div className="mesh-experiment"><div className="alpha-control" role="group" aria-label="Wind-tunnel similarity condition"><button className={!matched ? 'active' : ''} onClick={() => setMatched(false)}><span>Mach only</span><strong>Re = 10.1M</strong></button><button className={matched ? 'active' : ''} onClick={() => setMatched(true)}><span>Mach + Reynolds</span><strong>Re = 6.0M</strong></button></div><div className="airfoil-stage compact"><SimilarityVisual matched={matched}/></div><div className="semantic-diff"><p className="eyebrow">SEMANTIC DIFF</p><div><code>thermal_state.density</code><span>1.225 kg/m³</span><ArrowRight size={14}/><strong>{matched ? '0.730 kg/m³' : '1.225 kg/m³'}</strong></div><small>{matched ? 'Velocity remains 61.25 m/s; dynamic pressure falls to about 1370 Pa.' : 'Choose Mach + Reynolds to apply the density-matching condition.'}</small></div></div>
        <TutorialFailureModes items={t02Pedagogy.failureModes}/>
        <button className="lesson-secondary-button" onClick={() => downloadJSON(params, matched)}><Download size={15}/> Download selected setup</button>
      </>
      case 'evidence': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Similarity evidence contract</div>
        <h1>Matching two numbers does not remove every comparison risk.</h1>
        <p className="lesson-lead">Confirm geometry scale and references before solving, then review convergence, forces, pressure, and wall resolution over matched windows.</p>
        <div className="evidence-checklist">{t02Evidence.map((item) => { const selected = reviewed.includes(item.title); return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}><span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button> })}</div>
        <div className={`lesson-callout ${reviewed.length === t02Evidence.length ? 'success' : ''}`}>{reviewed.length === t02Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{reviewed.length}/5 reviewed</strong>{reviewed.length === t02Evidence.length ? 'The wind-tunnel comparison contract is complete.' : 'Review every similarity requirement before creating the experiment.'}</p></div>
        <TutorialEvidenceRubric items={t02Pedagogy.evidenceRubric}/>
      </>
      default: return <>
        <div className="lesson-kicker"><Cloud size={15}/> Create the experiment</div>
        <h1>Create both conditions from the bundled aircraft Geometry.</h1>
        <p className="lesson-lead">The app uploads the supplied aircraft CAD, creates one Geometry Project, and synchronizes the Mach-only and Mach-plus-Reynolds Case Drafts.</p>
        <div className="run-readiness-card"><div className="run-ready-icon"><CheckCircle2 size={30}/></div><div><span>CONFIGURATION STATUS</span><strong>Two operating conditions validated</strong><p>Mach, temperature, alpha, geometry, models, mesh, references, and outputs match; density construction is the controlled difference.</p></div></div>
        <TutorialTransferCheck items={t02Pedagogy.transferQuestions}/>
        <TutorialEnvironmentBuilder status={status} tutorialId="T02" defaultProjectName="Tutorial T02 · wind-tunnel similarity" heading="Build the T02 wind-tunnel experiment" description="The app uploads the bundled aircraft CAD and creates Mach-only and Mach-plus-Reynolds Case Drafts with complete parameters." configurationSummary="Mach 0.18, alpha 4°, 288.15 K, 2.4 m chord, ambient and Reynolds-matched densities" draftKind="Case" baselineValue="Mach only · Re 10.1M" variantValue="Mach + Reynolds · Re 6.0M" successDescription="Both Case Draft parameter sets are synced. No surface mesh, volume mesh, or solver Case has been submitted." createEnvironment={createT02Environment}/>
      </>
    }
  }

  return <div className="tutorial-player-page"><TopBar status={status} title="Guided tutorial · T02"/><aside className="tutorial-outline"><Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link><div className="tutorial-outline-title"><span>T02</span><h2>Match wind-tunnel similarity</h2><small>Operating conditions · 18–22 min</small></div><div className="tutorial-progress"><div><span>Progress</span><strong>{t02Progress(completed)}%</strong></div><progress value={t02Progress(completed)} max="100"/></div><nav aria-label="Tutorial steps">{t02Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav><button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setReviewed([]); setChecksVisible(false); setMatched(false) }}><RotateCcw size={13}/> Reset progress</button></aside><main className="tutorial-lesson"><div className="lesson-content">{lesson()}</div><footer className="lesson-footer"><button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button><span>Step {stepIndex + 1} of {t02Steps.length}</span>{stepIndex < t02Steps.length - 1 ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}</footer></main></div>
}
