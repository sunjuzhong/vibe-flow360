import { AlertTriangle, ArrowLeft, ArrowRight, CarFront, Check, CheckCircle2, Cloud, Download, Gauge, GitCompare, RotateCcw, ShieldCheck, Sparkles, Wind } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { TutorialConceptBridge, TutorialDerivations, TutorialEvidenceRubric, TutorialFailureModes, TutorialPrediction, TutorialTransferCheck } from '../components/TutorialTeachingBlocks'
import { createT08Environment, t08Evidence, t08ParameterCards, t08Params, t08Pedagogy, t08Progress, t08Steps, validateT08Setup } from '../tutorials/t08'

const storageKey = 'vibesim.tutorial.T08.completed'

function readProgress() {
  try { const value = JSON.parse(window.localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] }
}

function downloadJSON(params: Record<string, unknown>, moving: boolean) {
  const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `T08-${moving ? 'moving-ground' : 'stationary-floor'}.simulation.json`; anchor.click(); URL.revokeObjectURL(url)
}

export function AutomotiveTunnelVisual({ moving = false }: { moving?: boolean }) {
  return <svg className="tutorial-airfoil" viewBox="0 0 720 300" role="img" aria-label={`${moving ? 'Moving-ground' : 'Stationary-floor'} automotive wind-tunnel setup`}>
    <rect x="35" y="35" width="650" height="220" rx="8" fill="#f3f6e8" stroke="#68784a" strokeWidth="2"/>
    <path d="M60 230 H660" stroke={moving ? '#789b3c' : '#8c8d82'} strokeWidth="8" strokeDasharray={moving ? '18 6' : undefined}/>
    <path d="M260 185 L280 135 Q295 105 350 100 L420 105 Q450 115 475 155 L500 168 L505 190 H250 Z" fill="#dce9aa" stroke="#526239" strokeWidth="2"/>
    {[295, 455].map((x, index) => <g key={x}><circle cx={x} cy="190" r="28" fill="#fbfbf8" stroke="#40463f" strokeWidth="7"/>{moving && <path d={index === 0 ? `M${x - 15} 180 Q${x} 160 ${x + 15} 180` : `M${x + 15} 180 Q${x} 160 ${x - 15} 180`} fill="none" stroke="#d65f35" strokeWidth="3"/>}</g>)}
    {[90, 130, 170].map((y) => <path key={y} d={`M60 ${y} H235 M520 ${y} H660`} stroke="#79a4ad" strokeWidth="2" markerEnd="url(#none)"/>)}
    <text x="55" y="25">inlet −8 m</text><text x="575" y="25">outlet 15 m</text><text x="290" y="282">12 m × 5 m · 3.6% blockage screen</text>
    <text x="72" y="215">40 m/s</text>{moving && <text x="505" y="218">road 40 m/s · |ω| 125 rad/s</text>}
  </svg>
}

export default function T08TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [moving, setMoving] = useState(false)
  const [checksVisible, setChecksVisible] = useState(false)
  const [reviewed, setReviewed] = useState<string[]>([])
  const params = useMemo(() => t08Params(moving), [moving])
  const checks = useMemo(() => validateT08Setup(params), [params])
  const step = t08Steps[stepIndex]
  useEffect(() => { api.flow360Status().then(setStatus).catch(() => setStatus({ available: false })) }, [])
  useEffect(() => window.localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])
  const finishStep = () => { setCompleted((current) => current.includes(step.id) ? current : [...current, step.id]); setStepIndex((current) => Math.min(current + 1, t08Steps.length - 1)) }

  const lesson = () => {
    switch (step.id) {
      case 'question': return <>
        <div className="lesson-kicker"><Sparkles size={15}/> Automotive engineering</div>
        <h1>Does the numerical road represent the condition whose drag you want to predict?</h1>
        <p className="lesson-lead">The vehicle is stationary in the computational frame. For an on-road condition, the air and road move at 40 m/s and every tyre rotates so its contact-patch velocity matches the road.</p>
        <div className="lesson-decision-card"><span>DECISION</span><strong>Are you reproducing a stationary-floor tunnel or road-relative motion?</strong><p>The comparison changes only floor and wheel motion. Tunnel dimensions, geometry, mesh controls, flow speed, solver, and outputs remain fixed.</p></div>
        <div className="lesson-objectives"><div><Wind/><span><strong>Set the reference frame</strong>Connect air, road, and tyre motion.</span></div><div><CarFront/><span><strong>Match the facility</strong>Choose the correct Flow360 floor model.</span></div><div><ShieldCheck/><span><strong>Protect force conclusions</strong>Require mesh, motion, and convergence evidence.</span></div></div>
        <TutorialConceptBridge cfd={t08Pedagogy.cfdConcepts} flow360={t08Pedagogy.flow360Concepts}/>
      </>
      case 'tunnel': return <>
        <div className="lesson-kicker"><Wind size={15}/> Analytic test section</div>
        <h1>Size the tunnel before assigning physical boundaries.</h1>
        <p className="lesson-lead">WindTunnelFarfield generates a 12 m × 5 m section from x = −8 m to x = 15 m. The 2.17 m² reference area gives a first blockage screen of 3.6%, while 13.05 m remains behind the vehicle for wake review.</p>
        <div className="airfoil-stage"><AutomotiveTunnelVisual/></div>
        <div className="parameter-learning-grid">{t08ParameterCards.map((item) => <article key={item.label}><div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div><b>{item.value}</b><p>{item.why}</p></article>)}</div>
        <TutorialDerivations items={t08Pedagogy.derivations.slice(1)}/>
      </>
      case 'kinematics': return <>
        <div className="lesson-kicker"><Gauge size={15}/> Rolling kinematics</div>
        <h1>Derive wheel speed, then verify the direction at the contact patch.</h1>
        <p className="lesson-lead">For 40 m/s and a 0.32 m rolling radius, |ω| = 125 rad/s. Every axis is defined as +y, so left and right wheels require opposite signs even though all four carside views should roll forward.</p>
        <div className="airfoil-stage"><AutomotiveTunnelVisual moving/></div>
        <TutorialDerivations items={t08Pedagogy.derivations.slice(0, 1)}/>
        <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate tunnel, wake, and kinematics</button>
        {checksVisible && <div className="setup-checks">{validateT08Setup(t08Params(true)).map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>{check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
        <TutorialFailureModes items={t08Pedagogy.failureModes.slice(0, 2)}/>
      </>
      case 'experiment': return <>
        <div className="lesson-kicker"><GitCompare size={15}/> Controlled facility experiment</div>
        <h1>Change the road model without changing the rest of the experiment.</h1>
        <p className="lesson-lead">The baseline uses StaticFloor with a friction patch and stationary tyre walls. The variant uses WheelBelts, a 40 m/s road velocity, and four signed WallRotation models.</p>
        <TutorialPrediction experiment={t08Pedagogy.experiments[0]}/>
        <div className="mesh-experiment"><div className="alpha-control" role="group" aria-label="Automotive road-motion strategy"><button className={!moving ? 'active' : ''} onClick={() => setMoving(false)}><span>Stationary floor</span><strong>StaticFloor</strong></button><button className={moving ? 'active' : ''} onClick={() => setMoving(true)}><span>Moving ground</span><strong>WheelBelts + rotation</strong></button></div><div className="airfoil-stage compact"><AutomotiveTunnelVisual moving={moving}/></div><div className="semantic-diff"><p className="eyebrow">SEMANTIC DIFF</p><div><code>floor + wheel velocity</code><span>stationary</span><ArrowRight size={14}/><strong>{moving ? '40 m/s + ±125 rad/s' : 'stationary'}</strong></div><small>{moving ? 'Road patches and all four tyre walls now represent rolling road-relative motion.' : 'Select Moving ground to apply the controlled kinematic patch.'}</small></div></div>
        <TutorialFailureModes items={t08Pedagogy.failureModes.slice(2)}/>
        <button className="lesson-secondary-button" onClick={() => downloadJSON(params, moving)}><Download size={15}/> Download selected setup</button>
      </>
      case 'evidence': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Automotive evidence contract</div>
        <h1>Do not reduce the comparison to one drag number.</h1>
        <p className="lesson-lead">Review boundary ownership and velocity vectors first, then inspect wheel and floor-gap mesh quality, underbody flow, wake recovery, convergence, drag, and lift balance in identical views.</p>
        <div className="evidence-checklist">{t08Evidence.map((item) => { const selected = reviewed.includes(item.title); return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}><span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button> })}</div>
        <div className={`lesson-callout ${reviewed.length === t08Evidence.length ? 'success' : ''}`}>{reviewed.length === t08Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{reviewed.length}/5 reviewed</strong>{reviewed.length === t08Evidence.length ? 'The automotive comparison contract is complete.' : 'Review every requirement before creating the environment.'}</p></div>
        <TutorialEvidenceRubric items={t08Pedagogy.evidenceRubric}/>
      </>
      default: return <>
        <div className="lesson-kicker"><Cloud size={15}/> Create the automotive environment</div>
        <h1>Create both configured Case Drafts from the supplied car.</h1>
        <p className="lesson-lead">The app uploads the lightweight car Geometry, creates one Project, registers the wake Box, and synchronizes stationary-floor and moving-ground Case Drafts with complete meshing, physics, and output parameters.</p>
        <div className="run-readiness-card"><div className="run-ready-icon"><CheckCircle2 size={30}/></div><div><span>CONFIGURATION STATUS</span><strong>Both tunnel and motion strategies validated</strong><p>Only the floor partition, road velocity, and four wheel WallRotation definitions differ.</p></div></div>
        <TutorialTransferCheck items={t08Pedagogy.transferQuestions}/>
        <TutorialEnvironmentBuilder status={status} tutorialId="T08" defaultProjectName="Tutorial T08 · automotive wind tunnel" heading="Build the T08 automotive comparison" description="The app uploads the bundled car and creates stationary-floor and moving-ground Case Drafts." configurationSummary="WindTunnelFarfield, StaticFloor/WheelBelts, 40 m/s road, ±125 rad/s wheels, registered wake Box" draftKind="Case" baselineValue="Stationary-floor tunnel" variantValue="Moving ground and rotating wheels" successDescription="Both Case Draft parameter sets are synced. No surface mesh, volume mesh, or solver Case has been submitted." createEnvironment={createT08Environment}/>
      </>
    }
  }

  return <div className="tutorial-player-page"><TopBar status={status} title="Guided tutorial · T08"/><aside className="tutorial-outline"><Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link><div className="tutorial-outline-title"><span>T08</span><h2>Automotive moving-ground wind tunnel</h2><small>External aerodynamics · 22–28 min</small></div><div className="tutorial-progress"><div><span>Progress</span><strong>{t08Progress(completed)}%</strong></div><progress value={t08Progress(completed)} max="100"/></div><nav aria-label="Tutorial steps">{t08Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav><button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setReviewed([]); setChecksVisible(false); setMoving(false) }}><RotateCcw size={13}/> Reset progress</button></aside><main className="tutorial-lesson"><div className="lesson-content">{lesson()}</div><footer className="lesson-footer"><button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button><span>Step {stepIndex + 1} of {t08Steps.length}</span>{stepIndex < t08Steps.length - 1 ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}</footer></main></div>
}
