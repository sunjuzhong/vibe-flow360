import { AlertTriangle, ArrowLeft, ArrowRight, Box, Check, CheckCircle2, Cloud, Download, GitCompare, MoveRight, RotateCcw, ShieldCheck, Sparkles, Target } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { TutorialConceptBridge, TutorialDerivations, TutorialEvidenceRubric, TutorialFailureModes, TutorialPrediction, TutorialTransferCheck } from '../components/TutorialTeachingBlocks'
import { createT06Environment, t06Evidence, t06ParameterCards, t06Params, t06Pedagogy, t06Progress, t06Steps, type T06Strategy, validateT06Setup } from '../tutorials/t06'

const storageKey = 'vibesim.tutorial.T06.completed'

function readProgress() {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function downloadJSON(params: Record<string, unknown>, strategy: T06Strategy) {
  const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `T06-${strategy}-farfield.simulation.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function FarfieldVisual({ strategy = 'automatic' }: { strategy?: T06Strategy }) {
  const compact = strategy === 'compact'
  const manual = strategy === 'manual'
  return <svg className="tutorial-airfoil" viewBox="0 0 680 300" role="img" aria-label={`${manual ? 'Manual' : compact ? 'Compact' : 'Baseline'} external farfield domain`}>
    <defs><linearGradient id="domain-fill" x1="0" x2="1"><stop stopColor="#dcebad" stopOpacity=".55"/><stop offset="1" stopColor="#edf3d9" stopOpacity=".16"/></linearGradient></defs>
    {manual
      ? <rect x="80" y="42" width="540" height="216" rx="5" fill="url(#domain-fill)" stroke="#708333" strokeWidth="2.5"/>
      : <ellipse cx="340" cy="150" rx={compact ? 190 : 285} ry={compact ? 105 : 135} fill="url(#domain-fill)" stroke="#708333" strokeWidth="2.5"/>}
    <circle cx={manual ? 235 : 300} cy="150" r="24" fill="#f8f9f1" stroke="#4e5d48" strokeWidth="3"/>
    <rect x={manual ? 235 : 300} y="118" width="190" height="64" rx="30" fill="none" stroke="#557c91" strokeWidth="2" strokeDasharray="7 5"/>
    <path d={`M${manual ? 259 : 324} 133 C390 120 470 126 555 145 M${manual ? 259 : 324} 167 C390 180 470 174 555 155`} fill="none" stroke="#83a33b" strokeWidth="2"/>
    <MoveRight x="42" y="18"/><text x="74" y="36">freestream +x</text>
    <text x="280" y="278">{manual ? '10D upstream · 25D downstream' : compact ? 'generated radius 8D' : 'generated radius 20D'}</text>
  </svg>
}

export default function T06TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [strategy, setStrategy] = useState<T06Strategy>('automatic')
  const [checksVisible, setChecksVisible] = useState(false)
  const [reviewed, setReviewed] = useState<string[]>([])
  const [environmentStrategy, setEnvironmentStrategy] = useState<'automatic' | 'manual'>('automatic')
  const params = useMemo(() => t06Params(strategy), [strategy])
  const checks = useMemo(() => validateT06Setup(params), [params])
  const step = t06Steps[stepIndex]

  useEffect(() => { api.flow360Status().then(setStatus).catch(() => setStatus({ available: false })) }, [])
  useEffect(() => window.localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])

  const finishStep = () => {
    setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])
    setStepIndex((current) => Math.min(current + 1, t06Steps.length - 1))
  }

  const lesson = () => {
    switch (step.id) {
      case 'question': return <>
        <div className="lesson-kicker"><Sparkles size={15}/> Engineering intent</div>
        <h1>Will the outer boundary change the predicted drag or wake?</h1>
        <p className="lesson-lead">The one-metre spherical body disturbs pressure and velocity beyond its surface. The computational boundary must be far enough away for the requested drag and wake evidence, but unnecessary domain volume adds cells.</p>
        <div className="lesson-decision-card"><span>DECISION</span><strong>Generate the domain or supply its exact shape in CAD?</strong><p>Choose from Geometry topology, boundary-placement requirements, and a controlled size-sensitivity comparison.</p></div>
        <div className="lesson-objectives"><div><Target/><span><strong>Control interference</strong>Normalize distance and blockage by body size.</span></div><div><Box/><span><strong>Match the CAD contract</strong>Separate body-only and fluid-volume inputs.</span></div><div><ShieldCheck/><span><strong>Verify independence</strong>Compare mesh and outputs across domain sizes.</span></div></div>
        <TutorialConceptBridge cfd={t06Pedagogy.cfdConcepts} flow360={t06Pedagogy.flow360Concepts}/>
      </>
      case 'topology': return <>
        <div className="lesson-kicker"><Box size={15}/> Geometry topology</div>
        <h1>The CAD determines which farfield object is valid.</h1>
        <p className="lesson-lead">Body-only CAD has no outer fluid boundary, so Flow360 must generate one. A user-defined path starts from a watertight fluid volume whose outer faces and body cavity already define where meshing occurs.</p>
        <div className="farfield-topology-grid">
          <button className={strategy !== 'manual' ? 'active' : ''} onClick={() => setStrategy('automatic')}><strong>Body-only CAD</strong><span>sphere-body.csm</span><small>Use AutomatedFarfield</small></button>
          <button className={strategy === 'manual' ? 'active' : ''} onClick={() => setStrategy('manual')}><strong>Closed fluid volume</strong><span>manual-domain.csm</span><small>Use UserDefinedFarfield</small></button>
        </div>
        <div className="airfoil-stage"><FarfieldVisual strategy={strategy}/></div>
        <div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>A parameter patch cannot change topology</strong>The manual farfield Draft must be created in the Project built from manual-domain.csm, not in the body-only Project.</p></div>
      </>
      case 'setup': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Flow360 mapping</div>
        <h1>Configure the domain and preserve every nested volume.</h1>
        <p className="lesson-lead">The automatic baseline generates a 20D domain and encloses a registered rotor CustomVolume. The supplied-domain path uses its CAD boundaries directly.</p>
        <div className="parameter-learning-grid">{t06ParameterCards.map((item) => <article key={item.label}><div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div><b>{item.value}</b><p>{item.why}</p></article>)}</div>
        <TutorialDerivations items={t06Pedagogy.derivations}/>
        <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate the selected farfield setup</button>
        {checksVisible && <div className="setup-checks">{checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>{check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
      </>
      case 'variant': return <>
        <div className="lesson-kicker"><GitCompare size={15}/> Controlled domain comparison</div>
        <h1>Reduce the generated radius only after predicting the risk.</h1>
        <p className="lesson-lead">The compact candidate changes only AutomatedFarfield.relative_size from 20D to 8D. Geometry, surface-mesh defaults, and the enclosed rotor service volume stay fixed.</p>
        <TutorialPrediction experiment={t06Pedagogy.experiments[0]}/>
        <div className="mesh-experiment"><div className="alpha-control" role="group" aria-label="Automatic farfield size"><button className={strategy === 'automatic' ? 'active' : ''} onClick={() => setStrategy('automatic')}><span>Baseline</span><strong>20D radius</strong></button><button className={strategy === 'compact' ? 'active' : ''} onClick={() => setStrategy('compact')}><span>Compact candidate</span><strong>8D radius</strong></button></div><div className="airfoil-stage compact"><FarfieldVisual strategy={strategy === 'compact' ? 'compact' : 'automatic'}/></div><div className="semantic-diff"><p className="eyebrow">SEMANTIC DIFF</p><div><code>AutomatedFarfield.relative_size</code><span>20</span><ArrowRight size={14}/><strong>{strategy === 'compact' ? '8' : '20'}</strong></div><small>{strategy === 'compact' ? 'The radius falls by 60%; compare drag, pressure, and wake evidence before accepting the lower cell count.' : 'Choose the compact candidate to apply the controlled merge patch.'}</small></div></div>
        <TutorialFailureModes items={t06Pedagogy.failureModes}/>
        <button className="lesson-secondary-button" onClick={() => downloadJSON(params, strategy)}><Download size={15}/> Download selected setup</button>
      </>
      case 'evidence': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Domain evidence contract</div>
        <h1>Topology and distance must agree with the generated mesh and outputs.</h1>
        <p className="lesson-lead">Review the Geometry before meshing, the volume mesh before solving, and matched engineering outputs before accepting a compact domain.</p>
        <div className="evidence-checklist">{t06Evidence.map((item) => { const selected = reviewed.includes(item.title); return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}><span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button> })}</div>
        <div className={`lesson-callout ${reviewed.length === t06Evidence.length ? 'success' : ''}`}>{reviewed.length === t06Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{reviewed.length}/5 reviewed</strong>{reviewed.length === t06Evidence.length ? 'The domain review contract is complete.' : 'Review every domain requirement before creating the environment.'}</p></div>
        <TutorialEvidenceRubric items={t06Pedagogy.evidenceRubric}/>
      </>
      default: return <>
        <div className="lesson-kicker"><Cloud size={15}/> Create the environment</div>
        <h1>Create the Project from the matching CAD contract.</h1>
        <p className="lesson-lead">The automatic path creates 20D and 8D Drafts in one body-only Project. The manual path creates one UserDefinedFarfield Draft in a separate closed-fluid-domain Project.</p>
        <div className="alpha-control" role="group" aria-label="Farfield environment path"><button className={environmentStrategy === 'automatic' ? 'active' : ''} onClick={() => setEnvironmentStrategy('automatic')}><span>Recommended starting path</span><strong>Automatic domain</strong></button><button className={environmentStrategy === 'manual' ? 'active' : ''} onClick={() => setEnvironmentStrategy('manual')}><span>Exact boundary placement</span><strong>Manual CAD domain</strong></button></div>
        <div className="run-readiness-card"><div className="run-ready-icon"><CheckCircle2 size={30}/></div><div><span>CONFIGURATION STATUS</span><strong>{environmentStrategy === 'automatic' ? 'Two automatic sizes validated' : 'Manual fluid-domain setup validated'}</strong><p>{environmentStrategy === 'automatic' ? 'Both Drafts register the rotor service volume; relative size is the only controlled difference.' : 'The bundled CAD contains the closed fluid region and the Draft uses UserDefinedFarfield.'}</p></div></div>
        <TutorialTransferCheck items={t06Pedagogy.transferQuestions}/>
        <TutorialEnvironmentBuilder status={status} tutorialId="T06" defaultProjectName={environmentStrategy === 'automatic' ? 'Tutorial T06 · automatic farfield' : 'Tutorial T06 · manual farfield'} heading={environmentStrategy === 'automatic' ? 'Build the T06 automatic-domain experiment' : 'Build the T06 manual-domain environment'} description={environmentStrategy === 'automatic' ? 'The app uploads body-only CAD and creates 20D and 8D automatic-farfield VolumeMesh Drafts.' : 'The app uploads the watertight external fluid domain and creates its configured UserDefinedFarfield VolumeMesh Draft.'} configurationSummary={environmentStrategy === 'automatic' ? 'AutomatedFarfield 20D/8D, registered rotor CustomVolume and Cylinder, matching mesh controls' : 'UserDefinedFarfield, 10D upstream, 25D downstream, 12D lateral, registered rotor zone'} draftKind="VolumeMesh" draftCount={environmentStrategy === 'manual' ? 1 : 2} baselineValue={environmentStrategy === 'automatic' ? 'Automatic farfield · 20D' : 'CAD-defined external domain'} variantValue="Automatic farfield · 8D" successDescription={environmentStrategy === 'automatic' ? 'Both automatic-domain Drafts are synced. No surface or volume mesh computation has been submitted.' : 'The user-defined-domain Draft is synced. No surface or volume mesh computation has been submitted.'} createEnvironment={(input, client, onStage) => createT06Environment(environmentStrategy, input, client, onStage)}/>
      </>
    }
  }

  return <div className="tutorial-player-page"><TopBar status={status} title="Guided tutorial · T06"/><aside className="tutorial-outline"><Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link><div className="tutorial-outline-title"><span>T06</span><h2>Choose the external farfield domain</h2><small>Domain setup · 18–22 min</small></div><div className="tutorial-progress"><div><span>Progress</span><strong>{t06Progress(completed)}%</strong></div><progress value={t06Progress(completed)} max="100"/></div><nav aria-label="Tutorial steps">{t06Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav><button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setReviewed([]); setChecksVisible(false); setStrategy('automatic'); setEnvironmentStrategy('automatic') }}><RotateCcw size={13}/> Reset progress</button></aside><main className="tutorial-lesson"><div className="lesson-content">{lesson()}</div><footer className="lesson-footer"><button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button><span>Step {stepIndex + 1} of {t06Steps.length}</span>{stepIndex < t06Steps.length - 1 ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}</footer></main></div>
}
