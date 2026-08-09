import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Cloud, Download, GitCompare, Layers3, MoveRight, RotateCcw, ScanLine, ShieldCheck, Sparkles, Target } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { TutorialConceptBridge, TutorialDerivations, TutorialEvidenceRubric, TutorialFailureModes, TutorialPrediction, TutorialTransferCheck } from '../components/TutorialTeachingBlocks'
import { createT05Environment, t05Evidence, t05ParameterCards, t05Params, t05Pedagogy, t05Progress, t05Steps, validateT05Setup } from '../tutorials/t05'

const storageKey = 'vibesim.tutorial.T05.completed'

function readProgress() {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function downloadJSON(params: Record<string, unknown>, focused: boolean) {
  const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `T05-${focused ? 'focused-wake' : 'compact-wake'}.simulation.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function WakeRefinementVisual({ focused = false }: { focused?: boolean }) {
  return <svg className="tutorial-airfoil" viewBox="0 0 680 300" role="img" aria-label={`${focused ? 'Focused' : 'Compact'} cylinder wake refinement strategy`}>
    <defs><linearGradient id="wake-fade" x1="0" x2="1"><stop stopColor="#92b53e" stopOpacity=".48"/><stop offset="1" stopColor="#92b53e" stopOpacity=".06"/></linearGradient></defs>
    <path d="M35 150 H645" stroke="#a8afa0" strokeWidth="1.5" strokeDasharray="5 7"/>
    <circle cx="180" cy="150" r="42" fill="#e4efbd" stroke="#5d7031" strokeWidth="3"/>
    <circle cx="180" cy="150" r={focused ? 92 : 78} fill="none" stroke="#79952d" strokeWidth="2" strokeDasharray="6 5"/>
    <rect x="180" y={focused ? 83 : 96} width={focused ? 430 : 300} height={focused ? 134 : 108} rx="6" fill="url(#wake-fade)" stroke="#748a39" strokeWidth="2"/>
    <path d={`M180 ${focused ? 115 : 120} C310 105 430 112 ${focused ? 610 : 480} 142 L${focused ? 610 : 480} 158 C430 188 310 195 180 ${focused ? 185 : 180}Z`} fill="none" stroke="#54798b" strokeWidth="2.5"/>
    {[240, 310, 380, 450, 520, 590].slice(0, focused ? 6 : 4).map((x) => <line key={x} x1={x} y1={focused ? 84 : 97} x2={x} y2={focused ? 216 : 203} stroke="#70873a" strokeOpacity=".45"/>)}
    <MoveRight x="55" y="38"/><text x="88" y="56">freestream +x</text>
    <text x="112" y="266">near-body</text><text x="330" y="266">direction-aware wake corridor</text>
  </svg>
}

export default function T05TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [focused, setFocused] = useState(false)
  const [checksVisible, setChecksVisible] = useState(false)
  const [reviewed, setReviewed] = useState<string[]>([])
  const params = useMemo(() => t05Params(focused), [focused])
  const checks = useMemo(() => validateT05Setup(params), [params])
  const step = t05Steps[stepIndex]

  useEffect(() => { api.flow360Status().then(setStatus).catch(() => setStatus({ available: false })) }, [])
  useEffect(() => window.localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])

  const finishStep = () => {
    setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])
    setStepIndex((current) => Math.min(current + 1, t05Steps.length - 1))
  }

  const lesson = () => {
    switch (step.id) {
      case 'question': return <>
        <div className="lesson-kicker"><Sparkles size={15}/> Engineering intent</div>
        <h1>Where do extra cells preserve the physics instead of only increasing cost?</h1>
        <p className="lesson-lead">A cylinder creates separation near the body and transports velocity deficits downstream. You will place volume resolution along that path instead of shrinking the global cell size.</p>
        <div className="lesson-decision-card"><span>DECISION</span><strong>Compact regions or a focused wake corridor?</strong><p>Choose from the downstream evidence you need and the cell budget you can defend.</p></div>
        <div className="lesson-objectives"><div><Target/><span><strong>Place by physics</strong>Connect each region to separation or transport.</span></div><div><Layers3/><span><strong>Control anisotropy</strong>Keep axial spacing coarser than crossflow spacing.</span></div><div><ShieldCheck/><span><strong>Demand evidence</strong>Inspect a center-plane mesh slice before solving.</span></div></div>
        <TutorialConceptBridge cfd={t05Pedagogy.cfdConcepts} flow360={t05Pedagogy.flow360Concepts}/>
      </>
      case 'regions': return <>
        <div className="lesson-kicker"><MoveRight size={15}/> Flow-aligned regions</div>
        <h1>Region placement begins with the expected wake direction.</h1>
        <p className="lesson-lead">The bundled one-metre cylinder is centered at the origin. Positive x is the assumed freestream direction, so expensive downstream resolution should not be mirrored upstream.</p>
        <div className="airfoil-stage"><WakeRefinementVisual/></div>
        <div className="geometry-assumptions"><div><span>DIAMETER</span><strong>1 m</strong><small>reference scale</small></div><div><span>FLOW</span><strong>+x</strong><small>expected wake axis</small></div><div><span>SPAN</span><strong>17 m</strong><small>bundled geometry</small></div></div>
        <div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>Direction is an assumption</strong>If yaw, unsteadiness, or downstream geometry moves the wake, the corridor must be widened or reoriented.</p></div>
      </>
      case 'setup': return <>
        <div className="lesson-kicker"><ScanLine size={15}/> Volume controls</div>
        <h1>Give every refinement region one explainable job.</h1>
        <p className="lesson-lead">The sphere resolves immediate separation, the structured box controls directional transport, and the cylindrical core resolves radial and circumferential wake structure.</p>
        <div className="parameter-learning-grid">{t05ParameterCards.slice(0, 4).map((item) => <article key={item.label}><div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div><b>{item.value}</b><p>{item.why}</p></article>)}</div>
        <TutorialDerivations items={t05Pedagogy.derivations}/>
        <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate volume-region intent</button>
        {checksVisible && <div className="setup-checks">{checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>{check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
      </>
      case 'variant': return <>
        <div className="lesson-kicker"><GitCompare size={15}/> Controlled variant</div>
        <h1>Spend more cells downstream only when the comparison needs them.</h1>
        <p className="lesson-lead">The focused variant extends the corridor to 12.5 diameters and halves crossflow spacing while keeping directional anisotropy explicit.</p>
        <TutorialPrediction experiment={t05Pedagogy.experiments[0]}/>
        <div className="mesh-experiment"><div className="alpha-control" role="group" aria-label="Wake refinement strategy"><button className={!focused ? 'active' : ''} onClick={() => setFocused(false)}><span>Baseline</span><strong>8 m corridor</strong></button><button className={focused ? 'active' : ''} onClick={() => setFocused(true)}><span>Focused wake</span><strong>12.5 m corridor</strong></button></div><div className="airfoil-stage compact"><WakeRefinementVisual focused={focused}/></div><div className="semantic-diff"><p className="eyebrow">SEMANTIC DIFF</p><div><code>wake crossflow spacing</code><span>0.16 m</span><ArrowRight size={14}/><strong>{focused ? '0.08 m' : '0.16 m'}</strong></div><small>{focused ? 'The corridor is longer and crossflow resolution doubles; axial cells remain deliberately coarser.' : 'Choose the focused wake to inspect the controlled refinement patch.'}</small></div></div>
        <TutorialFailureModes items={t05Pedagogy.failureModes}/>
        <button className="lesson-secondary-button" onClick={() => downloadJSON(params, focused)}><Download size={15}/> Download selected setup</button>
      </>
      case 'evidence': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Mesh evidence contract</div>
        <h1>A valid region definition does not prove useful wake resolution.</h1>
        <p className="lesson-lead">Review the same center-plane view for both Drafts and judge placement, overlap, transitions, and downstream exit.</p>
        <div className="evidence-checklist">{t05Evidence.map((item) => { const selected = reviewed.includes(item.title); return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}><span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button> })}</div>
        <div className={`lesson-callout ${reviewed.length === t05Evidence.length ? 'success' : ''}`}>{reviewed.length === t05Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{reviewed.length}/4 reviewed</strong>{reviewed.length === t05Evidence.length ? 'The wake-mesh comparison contract is ready.' : 'Review every mesh requirement before creating the experiment.'}</p></div>
        <TutorialEvidenceRubric items={t05Pedagogy.evidenceRubric}/>
      </>
      default: return <>
        <div className="lesson-kicker"><Cloud size={15}/> Execution boundary</div>
        <h1>Create both Drafts without starting cloud meshing.</h1>
        <p className="lesson-lead">The app uploads the bundled cylinder geometry, creates its Project, and synchronizes both validated volume-refinement strategies.</p>
        <div className="run-readiness-card"><div className="run-ready-icon"><CheckCircle2 size={30}/></div><div><span>LOCAL TUTORIAL STATUS</span><strong>Two wake strategies validated</strong><p>Both parameter sets are reproducible Flow360 25.10.3 artifacts with a center-plane mesh-slice request.</p></div></div>
        <TutorialTransferCheck items={t05Pedagogy.transferQuestions}/>
        <TutorialEnvironmentBuilder status={status} tutorialId="T05" defaultProjectName="Tutorial T05 · cylinder wake refinement" heading="Build the T05 wake-mesh environment" description="The app uploads the bundled cylinder geometry and creates compact-wake and focused-wake VolumeMesh Drafts." configurationSummary="Near-body sphere, structured wake box, axisymmetric core, directional spacing, center-plane slice" draftKind="VolumeMesh" baselineValue="Compact wake regions" variantValue="Focused wake corridor" successDescription="Both VolumeMesh Draft parameter sets are synced. No surface or volume mesh computation has been submitted." createEnvironment={createT05Environment}/>
      </>
    }
  }

  return <div className="tutorial-player-page"><TopBar status={status} title="Guided tutorial · T05"/><aside className="tutorial-outline"><Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link><div className="tutorial-outline-title"><span>T05</span><h2>Place refinement along the wake</h2><small>Meshing · 16–20 min</small></div><div className="tutorial-progress"><div><span>Progress</span><strong>{t05Progress(completed)}%</strong></div><progress value={t05Progress(completed)} max="100"/></div><nav aria-label="Tutorial steps">{t05Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav><button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setReviewed([]); setChecksVisible(false); setFocused(false) }}><RotateCcw size={13}/> Reset progress</button></aside><main className="tutorial-lesson"><div className="lesson-content">{lesson()}</div><footer className="lesson-footer"><button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button><span>Step {stepIndex + 1} of {t05Steps.length}</span>{stepIndex < t05Steps.length - 1 ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}</footer></main></div>
}
