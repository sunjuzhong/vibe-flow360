import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Cloud, Download, Gauge, GitCompare, Layers3, Rotate3D, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { TutorialConceptBridge, TutorialDerivations, TutorialEvidenceRubric, TutorialFailureModes, TutorialPrediction, TutorialTransferCheck } from '../components/TutorialTeachingBlocks'
import { createT09Environment, t09Evidence, t09ParameterCards, t09Params, t09Pedagogy, t09Progress, t09Steps, validateT09Setup } from '../tutorials/t09'

const storageKey = 'vibesim.tutorial.T09.completed'
function readProgress() { try { const value = JSON.parse(window.localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] } }
function downloadJSON(params: Record<string, unknown>, nested: boolean) { const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `T09-${nested ? 'nested' : 'shared'}-rotation.simulation.json`; anchor.click(); URL.revokeObjectURL(url) }

export function NestedRotorVisual({ nested = false }: { nested?: boolean }) {
  return <svg className="tutorial-airfoil" viewBox="0 0 720 320" role="img" aria-label={`${nested ? 'Nested' : 'Shared'} rotating-zone coaxial rotor`}>
    <defs><marker id="rotor-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#d65f35"/></marker></defs>
    <rect x="72" y="42" width="576" height="236" rx="118" fill="#f3f6e8" stroke="#68784a" strokeWidth="3" strokeDasharray="9 7"/>
    {nested && <circle cx="312" cy="160" r="80" fill="#eef4d7" stroke="#a06a35" strokeWidth="3" strokeDasharray="7 6"/>}
    <g stroke="#526239" strokeWidth="18" strokeLinecap="round"><path d="M190 160 H530"/><path d="M460 75 V245"/></g>
    <g stroke="#a06a35" strokeWidth="13" strokeLinecap="round"><path d="M245 160 H379"/><path d="M312 103 V217"/></g>
    <circle cx="312" cy="160" r="14" fill="#fbfbf8" stroke="#a06a35" strokeWidth="5"/><circle cx="460" cy="160" r="16" fill="#fbfbf8" stroke="#526239" strokeWidth="5"/>
    <path d="M540 98 A105 105 0 0 1 565 185" fill="none" stroke="#526239" strokeWidth="3" markerEnd="url(#rotor-arrow)"/>
    {nested && <path d="M265 92 A78 78 0 0 0 225 155" fill="none" stroke="#d65f35" strokeWidth="3" markerEnd="url(#rotor-arrow)"/>}
    <text x="500" y="75">outer +200 rpm</text><text x="92" y="300">outer Cylinder R = 2.2 m</text>
    {nested ? <><text x="190" y="58">inner Sphere R = 1.1 m</text><text x="185" y="245">relative −500 rpm → absolute −300 rpm</text></> : <text x="230" y="300">both stages share one frame</text>}
  </svg>
}

export default function T09TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [nested, setNested] = useState(false)
  const [checksVisible, setChecksVisible] = useState(false)
  const [reviewed, setReviewed] = useState<string[]>([])
  const params = useMemo(() => t09Params(nested), [nested]); const checks = useMemo(() => validateT09Setup(params), [params]); const step = t09Steps[stepIndex]
  useEffect(() => { api.flow360Status().then(setStatus).catch(() => setStatus({ available: false })) }, [])
  useEffect(() => window.localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])
  const finishStep = () => { setCompleted((current) => current.includes(step.id) ? current : [...current, step.id]); setStepIndex((current) => Math.min(current + 1, t09Steps.length - 1)) }

  const lesson = () => {
    switch (step.id) {
      case 'question': return <>
        <div className="lesson-kicker"><Sparkles size={15}/> Engineering decision</div>
        <h1>When does a coaxial rotor need a nested moving frame?</h1>
        <p className="lesson-lead">The baseline places both rotor stages inside one +200 rpm cylindrical zone. The variant keeps the outer stage there but gives the inner stage a spherical zone rotating −500 rpm relative to its parent.</p>
        <div className="lesson-decision-card"><span>DECISION</span><strong>Can both stages share one rigid motion?</strong><p>Use one zone only when all enclosed solids share the same angular velocity. Add a child frame when a stage has independent relative motion.</p></div>
        <div className="lesson-objectives"><div><Layers3/><span><strong>Separate three object types</strong>Surface, mesh zone, and solver motion answer different questions.</span></div><div><Rotate3D/><span><strong>Compose reference frames</strong>Derive absolute speed from parent plus relative motion.</span></div><div><ShieldCheck/><span><strong>Verify before meshing</strong>Reject dangling or intersecting entities in the Draft.</span></div></div>
        <TutorialConceptBridge cfd={t09Pedagogy.cfdConcepts} flow360={t09Pedagogy.flow360Concepts}/>
      </>
      case 'roles': return <>
        <div className="lesson-kicker"><Layers3 size={15}/> Flow360 object model</div><h1>Do not ask one object to do three jobs.</h1>
        <p className="lesson-lead">Named rotor surfaces receive Wall models. Cylinder and Sphere Draft entities locate sliding interfaces. RotationVolume and RotationSphere mesh those interfaces. Rotation models then assign motion to the registered volumes.</p>
        <div className="aircraft-stage"><NestedRotorVisual nested={nested}/></div>
        <div className="geometry-assumptions"><div><span>SOLID GROUPS</span><strong>2</strong><small>innerRotor + outerRotor</small></div><div><span>MESH ZONES</span><strong>{nested ? 2 : 1}</strong><small>cylinder{nested ? ' + sphere' : ''}</small></div><div><span>MOTION MODELS</span><strong>{nested ? 2 : 1}</strong><small>parent{nested ? ' + child' : ''}</small></div></div>
        <div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>API note</strong>Current setups use RotationVolume and RotationSphere. RotationCylinder is a backward-compatibility type, not the pattern taught here.</p></div>
      </>
      case 'topology': return <>
        <div className="lesson-kicker"><Gauge size={15}/> Geometry and Draft contract</div><h1>Prove that every interface exists and fits.</h1>
        <p className="lesson-lead">The supplied Draft registers the outer Cylinder, inner Sphere, wake Cylinder, and center Slice. The child sphere radius plus its 0.3 m offset remains below the outer 2.2 m radius.</p>
        <div className="parameter-learning-grid">{t09ParameterCards.map((item) => <article key={item.label}><div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div><b>{item.value}</b><p>{item.why}</p></article>)}</div>
        <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate entities and interfaces in the browser</button>
        {checksVisible && <div className="setup-checks">{checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>{check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
        <TutorialFailureModes items={t09Pedagogy.failureModes}/>
      </>
      case 'experiment': return <>
        <div className="lesson-kicker"><GitCompare size={15}/> Controlled frame experiment</div><h1>Change the motion hierarchy, then recompute the speed.</h1>
        <p className="lesson-lead">Switching to the nested variant adds one RotationSphere and one parent-linked Rotation. The geometry, outer zone, flow, wake refinement, time step, solver, and outputs stay fixed.</p>
        <TutorialPrediction experiment={t09Pedagogy.experiments[0]}/>
        <div className="alpha-experiment"><div className="alpha-control" role="group" aria-label="Rotating-zone strategy"><button className={!nested ? 'active' : ''} onClick={() => setNested(false)}><span>Baseline</span><strong>One shared zone</strong></button><button className={nested ? 'active' : ''} onClick={() => setNested(true)}><span>Variant</span><strong>Nested child zone</strong></button></div><div className="alpha-visual"><Rotate3D size={82} strokeWidth={1.1}/><span>{nested ? 'parent + relative child' : 'one rigid frame'}</span></div><div className="semantic-diff"><p className="eyebrow">MOTION TREE</p><div><code>inner absolute speed</code><span>+200 rpm</span><ArrowRight size={14}/><strong>{nested ? '−300 rpm' : '+200 rpm'}</strong></div><small>{nested ? '+200 rpm parent plus −500 rpm relative child.' : 'Both rotor stages inherit the shared outer motion.'}</small></div></div>
        <TutorialDerivations items={t09Pedagogy.derivations}/><button className="lesson-secondary-button" onClick={() => downloadJSON(params, nested)}><Download size={15}/> Download selected setup</button>
      </>
      case 'evidence': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Rotating-interface evidence contract</div><h1>Check the interface before trusting rotor loads.</h1>
        <p className="lesson-lead">Review entity resolution and topology first, then angular advance, mesh quality, conservation, wake continuity, and force or moment histories under a smaller-step comparison.</p>
        <div className="evidence-checklist">{t09Evidence.map((item) => { const selected = reviewed.includes(item.title); return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}><span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button> })}</div>
        <div className={`lesson-callout ${reviewed.length === t09Evidence.length ? 'success' : ''}`}>{reviewed.length === t09Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{reviewed.length}/5 reviewed</strong>{reviewed.length === t09Evidence.length ? 'The rotating-zone acceptance contract is complete.' : 'Review every requirement before creating the environment.'}</p></div><TutorialEvidenceRubric items={t09Pedagogy.evidenceRubric}/>
      </>
      default: return <>
        <div className="lesson-kicker"><Cloud size={15}/> Create the nested-rotation environment</div><h1>Create both configured Case Drafts from the supplied rotor.</h1>
        <p className="lesson-lead">The app uploads the lightweight coaxial-rotor Geometry, creates one Project, registers all four analytic Draft entities, and synchronizes shared-zone and nested-zone Case Drafts with complete parameters.</p>
        <div className="run-readiness-card"><div className="run-ready-icon"><CheckCircle2 size={30}/></div><div><span>CONFIGURATION STATUS</span><strong>Both rotating-zone strategies validated</strong><p>No mesh or solver Case is submitted; you retain control of compute from the Project workspace.</p></div></div>
        <TutorialTransferCheck items={t09Pedagogy.transferQuestions}/>
        <TutorialEnvironmentBuilder status={status} tutorialId="T09" defaultProjectName="Tutorial T09 · nested rotating zones" heading="Build the T09 nested-rotation comparison" description="The app uploads the bundled coaxial rotor and creates shared-zone and nested-zone Case Drafts." configurationSummary="RotationVolume, RotationSphere, registered Cylinder/Sphere, +200 rpm parent, −500 rpm relative child, 0.001 s step" draftKind="Case" baselineValue="Shared rotating zone" variantValue="Nested parent-child rotating zones" successDescription="Both Case Draft parameter sets are synced. No surface mesh, volume mesh, or solver Case has been submitted." createEnvironment={createT09Environment}/>
      </>
    }
  }

  return <div className="tutorial-player-page"><TopBar status={status} title="Guided tutorial · T09"/><aside className="tutorial-outline"><Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link><div className="tutorial-outline-title"><span>T09</span><h2>Nested rotating zones</h2><small>Rotorcraft CFD · 22–28 min</small></div><div className="tutorial-progress"><div><span>Progress</span><strong>{t09Progress(completed)}%</strong></div><progress value={t09Progress(completed)} max="100"/></div><nav aria-label="Tutorial steps">{t09Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav><button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setReviewed([]); setChecksVisible(false); setNested(false) }}><RotateCcw size={13}/> Reset progress</button></aside><main className="tutorial-lesson"><div className="lesson-content">{lesson()}</div><footer className="lesson-footer"><button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button><span>Step {stepIndex + 1} of {t09Steps.length}</span>{stepIndex < t09Steps.length - 1 ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}</footer></main></div>
}
