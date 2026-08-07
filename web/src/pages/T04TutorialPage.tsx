import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Cloud, Download, GitCompare, Layers3, RotateCcw, ScanLine, ShieldCheck, Sparkles, Waypoints } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { createT04Environment, t04Evidence, t04ParameterCards, t04Params, t04Progress, t04Steps, validateT04Setup } from '../tutorials/t04'

const storageKey = 'vibesim.tutorial.T04.completed'

function readProgress() {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function downloadJSON(params: Record<string, unknown>, geometryAware: boolean) {
  const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `T04-${geometryAware ? 'geometry-aware' : 'explicit-edge'}.simulation.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function AirfoilGapVisual({ geometryAware = false }: { geometryAware?: boolean }) {
  return <svg className="tutorial-airfoil" viewBox="0 0 680 300" role="img" aria-label={`${geometryAware ? 'Geometry AI' : 'Explicit edge'} multi-element airfoil strategy`}>
    <defs><linearGradient id="airfoil-fill" x1="0" x2="1"><stop stopColor="#e3f3af"/><stop offset="1" stopColor="#a8ca50"/></linearGradient></defs>
    <path d="M245 124 C330 76 456 73 563 106 C465 112 356 137 251 155 C228 157 223 139 245 124Z" fill="url(#airfoil-fill)" stroke="#52652d" strokeWidth="2"/>
    <path d="M112 146 C139 105 190 91 233 104 C188 120 160 143 128 170 C108 180 99 165 112 146Z" fill="url(#airfoil-fill)" stroke="#52652d" strokeWidth="2"/>
    <path d="M452 174 C505 151 573 151 625 169 C571 176 516 191 462 209 C441 211 435 187 452 174Z" fill="url(#airfoil-fill)" stroke="#52652d" strokeWidth="2"/>
    <path d="M132 177 C173 166 207 159 244 158" fill="none" stroke={geometryAware ? '#6d8b20' : '#a77b25'} strokeWidth="3" strokeDasharray={geometryAware ? '0' : '6 5'}/>
    <path d="M451 169 C486 151 522 140 559 120" fill="none" stroke={geometryAware ? '#6d8b20' : '#a77b25'} strokeWidth="3" strokeDasharray={geometryAware ? '0' : '6 5'}/>
    <circle cx="235" cy="130" r="18" fill="none" stroke="#718a31" strokeDasharray="4 4"/><circle cx="450" cy="191" r="18" fill="none" stroke="#718a31" strokeDasharray="4 4"/>
    <text x="72" y="92">slat</text><text x="356" y="67">main element</text><text x="545" y="229">flap</text>
    <text x="70" y="257">{geometryAware ? 'Geometry accuracy + passage preservation' : 'Angle + height + aspect ratio + projection'}</text>
  </svg>
}

export default function T04TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [geometryAware, setGeometryAware] = useState(false)
  const [checksVisible, setChecksVisible] = useState(false)
  const [reviewed, setReviewed] = useState<string[]>([])
  const params = useMemo(() => t04Params(geometryAware), [geometryAware])
  const checks = useMemo(() => validateT04Setup(params), [params])
  const step = t04Steps[stepIndex]

  useEffect(() => { api.flow360Status().then(setStatus).catch(() => setStatus({ available: false })) }, [])
  useEffect(() => window.localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])

  const finishStep = () => {
    setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])
    setStepIndex((current) => Math.min(current + 1, t04Steps.length - 1))
  }

  const lesson = () => {
    switch (step.id) {
      case 'question': return <>
        <div className="lesson-kicker"><Sparkles size={15}/> Engineering intent</div>
        <h1>Which small geometric feature will fail first in a global mesh?</h1>
        <p className="lesson-lead">The 30P30N airfoil combines strong leading-edge curvature, sharp trailing edges, and two narrow passages. You will assign each risk a deliberate spacing strategy before creating any mesh.</p>
        <div className="lesson-decision-card"><span>DECISION</span><strong>Explicit edge control or Geometry AI?</strong><p>Choose based on CAD edge provenance and passage preservation—not on which setup has fewer parameters.</p></div>
        <div className="lesson-objectives"><div><Waypoints/><span><strong>Map edge risk</strong>Separate curvature, thickness, stretching, and projection.</span></div><div><Layers3/><span><strong>Protect gaps</strong>Keep slat and flap passages open and usable.</span></div><div><ShieldCheck/><span><strong>Demand evidence</strong>Inspect topology and transitions before solving.</span></div></div>
      </>
      case 'geometry': return <>
        <div className="lesson-kicker"><Waypoints size={15}/> Multi-element geometry</div>
        <h1>Three elements create four distinct meshing problems.</h1>
        <p className="lesson-lead">Leading edges need curvature resolution, trailing edges need controlled normal height, gaps need bounded anisotropy, and symmetry edges should inherit neighboring spacing.</p>
        <div className="airfoil-stage"><AirfoilGapVisual/></div>
        <div className="geometry-assumptions"><div><span>CHORD</span><strong>1 m</strong><small>reference scale</small></div><div><span>SPAN</span><strong>0.01 m</strong><small>quasi-2D extrusion</small></div><div><span>ELEMENTS</span><strong>3</strong><small>slat · wing · flap</small></div></div>
        <div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>Grouping is part of the input</strong>If `faceName` or `edgeName` tags disappear during CAD import, the intended local controls cannot be applied safely.</p></div>
      </>
      case 'setup': return <>
        <div className="lesson-kicker"><ScanLine size={15}/> Explicit edge controls</div>
        <h1>Choose a spacing method that expresses the failure mode.</h1>
        <p className="lesson-lead">These methods are not interchangeable shortcuts. Each constrains a different geometric or anisotropic behavior.</p>
        <div className="parameter-learning-grid">{t04ParameterCards.slice(0, 4).map((item) => <article key={item.label}><div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div><b>{item.value}</b><p>{item.why}</p></article>)}</div>
        <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate explicit edge assignments</button>
        {checksVisible && <div className="setup-checks">{checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>{check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
      </>
      case 'variant': return <>
        <div className="lesson-kicker"><GitCompare size={15}/> Mutually exclusive strategy</div>
        <h1>Geometry AI replaces edge rules; it does not layer on top of them.</h1>
        <p className="lesson-lead">The variant removes every SurfaceEdgeRefinement, enables CAD importer v2 and Geometry AI, then states geometry accuracy and minimum passage size explicitly.</p>
        <div className="mesh-experiment"><div className="alpha-control" role="group" aria-label="Airfoil refinement strategy"><button className={!geometryAware ? 'active' : ''} onClick={() => setGeometryAware(false)}><span>Explicit edges</span><strong>4 spacing methods</strong></button><button className={geometryAware ? 'active' : ''} onClick={() => setGeometryAware(true)}><span>Geometry AI</span><strong>0.35 mm accuracy</strong></button></div><div className="airfoil-stage compact"><AirfoilGapVisual geometryAware={geometryAware}/></div><div className="semantic-diff"><p className="eyebrow">SEMANTIC DIFF</p><div><code>refinement strategy</code><span>edge rules</span><ArrowRight size={14}/><strong>{geometryAware ? 'passage protection' : 'edge rules'}</strong></div><small>{geometryAware ? 'Explicit edge controls are removed because Flow360 25.10 treats these strategies as incompatible.' : 'Choose Geometry AI to inspect the validated alternative.'}</small></div></div>
        <button className="lesson-secondary-button" onClick={() => downloadJSON(params, geometryAware)}><Download size={15}/> Download selected setup</button>
      </>
      case 'evidence': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Mesh evidence contract</div>
        <h1>Parameter validity does not prove the gaps survived meshing.</h1>
        <p className="lesson-lead">Review the critical locations at consistent camera positions for both strategies.</p>
        <div className="evidence-checklist">{t04Evidence.map((item) => { const selected = reviewed.includes(item.title); return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}><span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button> })}</div>
        <div className={`lesson-callout ${reviewed.length === t04Evidence.length ? 'success' : ''}`}>{reviewed.length === t04Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{reviewed.length}/4 reviewed</strong>{reviewed.length === t04Evidence.length ? 'The comparison contract is ready.' : 'Review every mesh requirement before creating the experiment.'}</p></div>
      </>
      default: return <>
        <div className="lesson-kicker"><Cloud size={15}/> Execution boundary</div>
        <h1>Create both Drafts without starting cloud meshing.</h1>
        <p className="lesson-lead">The app uploads the official 30P30N geometry, creates its Project, and synchronizes both validated parameter strategies.</p>
        <div className="run-readiness-card"><div className="run-ready-icon"><CheckCircle2 size={30}/></div><div><span>LOCAL TUTORIAL STATUS</span><strong>Two mutually exclusive strategies validated</strong><p>Traditional edge-spacing and Geometry AI capabilities are backed by reproducible Flow360 25.10.3 artifacts.</p></div></div>
        <TutorialEnvironmentBuilder status={status} tutorialId="T04" defaultProjectName="Tutorial T04 · 30P30N edge refinement" heading="Build the T04 airfoil mesh environment" description="The app uploads the bundled 30P30N geometry and creates explicit-edge and Geometry AI VolumeMesh Drafts." configurationSummary="Angle, height, aspect ratio, projection, passive spacing, geometry accuracy, minimum passage" draftKind="VolumeMesh" baselineValue="Explicit edge controls" variantValue="Geometry AI passages" successDescription="Both VolumeMesh Draft parameter sets are synced. No surface or volume mesh computation has been submitted." createEnvironment={createT04Environment}/>
      </>
    }
  }

  return <div className="tutorial-player-page"><TopBar status={status} title="Guided tutorial · T04"/><aside className="tutorial-outline"><Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link><div className="tutorial-outline-title"><span>T04</span><h2>Preserve airfoil edges and gaps</h2><small>Meshing · 18–22 min</small></div><div className="tutorial-progress"><div><span>Progress</span><strong>{t04Progress(completed)}%</strong></div><progress value={t04Progress(completed)} max="100"/></div><nav aria-label="Tutorial steps">{t04Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav><button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setReviewed([]); setChecksVisible(false); setGeometryAware(false) }}><RotateCcw size={13}/> Reset progress</button></aside><main className="tutorial-lesson"><div className="lesson-content">{lesson()}</div><footer className="lesson-footer"><button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button><span>Step {stepIndex + 1} of {t04Steps.length}</span>{stepIndex < t04Steps.length - 1 ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}</footer></main></div>
}
