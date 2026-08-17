import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, Cloud, Download, Droplets, GitCompare, MapPin, RotateCcw, ShieldCheck, Sparkles, Target } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { TutorialConceptBridge, TutorialDerivations, TutorialEvidenceRubric, TutorialFailureModes, TutorialPrediction, TutorialTransferCheck } from '../components/TutorialTeachingBlocks'
import { createT07Environment, t07Evidence, t07ParameterCards, t07Params, t07Pedagogy, t07Progress, t07Steps, validateT07Setup } from '../tutorials/t07'

const storageKey = 'vibesim.tutorial.T07.completed'

function readProgress() {
  try { const value = JSON.parse(window.localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [] } catch { return [] }
}

function downloadJSON(params: Record<string, unknown>, featureAware: boolean) {
  const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `T07-${featureAware ? 'feature-aware' : 'global-only'}.simulation.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function InternalFlowVisual({ featureAware = false }: { featureAware?: boolean }) {
  return <svg className="tutorial-airfoil" viewBox="0 0 700 300" role="img" aria-label={`${featureAware ? 'Feature-aware' : 'Global-only'} internal duct mesh strategy`}>
    <defs><linearGradient id="duct-fill" x1="0" x2="1"><stop stopColor="#eef4dc"/><stop offset="1" stopColor="#d9e8ac"/></linearGradient></defs>
    <rect x="55" y="48" width="590" height="205" rx="6" fill="url(#duct-fill)" stroke="#647642" strokeWidth="2.5"/>
    {[90, 130, 170, 210].map((y) => <path key={y} d={`M72 ${y} H627`} stroke={featureAware ? '#9bb35e' : '#b6c18f'} strokeWidth="1" strokeDasharray={featureAware ? '5 5' : '18 12'}/>)}
    <circle cx="315" cy="150" r="58" fill="#f8f9f2" stroke="#4f5a4d" strokeWidth={featureAware ? 4 : 2}/>
    {[285, 345].map((x) => <g key={x}><rect x={x} y="42" width="12" height="70" rx="6" fill="#f8f9f2" stroke="#4f5a4d"/><rect x={x} y="188" width="12" height="70" rx="6" fill="#f8f9f2" stroke="#4f5a4d"/></g>)}
    {featureAware && <><path d="M60 242 H640" stroke="#71933a" strokeWidth="7"/><path d="M372 115 C440 92 520 108 610 138 M372 185 C440 208 520 192 610 162" fill="none" stroke="#6c9caa" strokeWidth="2.5" strokeDasharray="7 5"/></>}
    <circle cx="130" cy="150" r="7" fill="#d55f35"/><text x="91" y="178">seed [1, 0, 2] m</text>
    <text x="70" y="32">inlet</text><text x="602" y="32">outlet</text><text x="275" y="286">sphere blockage 19.6%</text>
  </svg>
}

export default function T07TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [featureAware, setFeatureAware] = useState(false)
  const [checksVisible, setChecksVisible] = useState(false)
  const [reviewed, setReviewed] = useState<string[]>([])
  const params = useMemo(() => t07Params(featureAware), [featureAware])
  const checks = useMemo(() => validateT07Setup(params), [params])
  const step = t07Steps[stepIndex]
  useEffect(() => { api.flow360Status().then(setStatus).catch(() => setStatus({ available: false })) }, [])
  useEffect(() => window.localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])
  const finishStep = () => { setCompleted((current) => current.includes(step.id) ? current : [...current, step.id]); setStepIndex((current) => Math.min(current + 1, t07Steps.length - 1)) }

  const lesson = () => {
    switch (step.id) {
      case 'question': return <>
        <div className="lesson-kicker"><Sparkles size={15}/> Internal-flow engineering</div>
        <h1>Can this mesh support a pressure-loss calculation through the obstructed duct?</h1>
        <p className="lesson-lead">A two-metre sphere and four thin supports occupy a four-metre-square wind-tunnel section. The mesh must preserve the geometry that creates acceleration, separation, wall shear, and downstream recovery.</p>
        <div className="lesson-decision-card"><span>DECISION</span><strong>Is global spacing enough, or do loss-generating features need local controls?</strong><p>Accept the mesh only when the connected fluid topology, obstruction surfaces, wall layers, transitions, and outlet recovery all pass review.</p></div>
        <div className="lesson-objectives"><div><Droplets/><span><strong>Identify fluid space</strong>Mesh the passage, not the duct material or exterior air.</span></div><div><Target/><span><strong>Preserve the loss source</strong>Retain the sphere and 0.2 m supports.</span></div><div><ShieldCheck/><span><strong>Protect the conclusion</strong>Review layers, wake growth, quality, and outlet placement.</span></div></div>
        <TutorialConceptBridge cfd={t07Pedagogy.cfdConcepts} flow360={t07Pedagogy.flow360Concepts}/>
      </>
      case 'topology': return <>
        <div className="lesson-kicker"><Droplets size={15}/> Fluid-domain topology</div>
        <h1>The uploaded body is the air passage itself.</h1>
        <p className="lesson-lead">The CAD is an 8 m × 4 m × 4 m fluid volume with the sphere and supports subtracted. Flow360 must mesh inside this closed region; generating an exterior farfield would select the wrong side.</p>
        <div className="airfoil-stage"><InternalFlowVisual/></div>
        <div className="geometry-assumptions"><div><span>DOMAIN</span><strong>Fluid volume</strong><small>closed CAD region</small></div><div><span>BOUNDARIES</span><strong>inlet + outlet</strong><small>walls and obstruction</small></div><div><span>EXTERIOR BOX</span><strong>None</strong><small>UserDefinedFarfield path</small></div></div>
        <div className="parameter-learning-grid">{t07ParameterCards.map((item) => <article key={item.label}><div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div><b>{item.value}</b><p>{item.why}</p></article>)}</div>
        <TutorialDerivations items={t07Pedagogy.derivations}/>
      </>
      case 'seed': return <>
        <div className="lesson-kicker"><MapPin size={15}/> Connected-volume selection</div>
        <h1>Place the seed where the intended fluid is unambiguous.</h1>
        <p className="lesson-lead">The point [1, 0, 2] m lies inside the upstream passage, two metres before the sphere centre and away from every wall. The same SeedpointVolume ID is registered and referenced by CustomZones.</p>
        <div className="airfoil-stage"><InternalFlowVisual/></div>
        <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate domain and seed registration</button>
        {checksVisible && <div className="setup-checks">{checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>{check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
        <TutorialFailureModes items={t07Pedagogy.failureModes.slice(0, 2)}/>
      </>
      case 'resolution': return <>
        <div className="lesson-kicker"><GitCompare size={15}/> Controlled mesh experiment</div>
        <h1>Add resolution where pressure loss is generated.</h1>
        <p className="lesson-lead">The feature-aware Draft keeps the fluid domain, seed point, project units, and global defaults fixed. It changes only obstacle spacing, support spacing, the floor layer, and adjacent spacing behavior.</p>
        <TutorialPrediction experiment={t07Pedagogy.experiments[0]}/>
        <div className="mesh-experiment"><div className="alpha-control" role="group" aria-label="Internal duct mesh strategy"><button className={!featureAware ? 'active' : ''} onClick={() => setFeatureAware(false)}><span>Global only</span><strong>1.2 m default</strong></button><button className={featureAware ? 'active' : ''} onClick={() => setFeatureAware(true)}><span>Feature aware</span><strong>5 local controls</strong></button></div><div className="airfoil-stage compact"><InternalFlowVisual featureAware={featureAware}/></div><div className="semantic-diff"><p className="eyebrow">SEMANTIC DIFF</p><div><code>meshing.refinements</code><span>0 controls</span><ArrowRight size={14}/><strong>{featureAware ? '5 controls' : '0 controls'}</strong></div><small>{featureAware ? 'Sphere, supports, floor layer, and wall transitions are now locally controlled.' : 'Select Feature aware to apply the controlled refinement patch.'}</small></div></div>
        <TutorialFailureModes items={t07Pedagogy.failureModes.slice(2)}/>
        <button className="lesson-secondary-button" onClick={() => downloadJSON(params, featureAware)}><Download size={15}/> Download selected setup</button>
      </>
      case 'evidence': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Internal-mesh evidence contract</div>
        <h1>Parameter validity is followed by generated-mesh inspection.</h1>
        <p className="lesson-lead">Use identical sections in both meshes. Confirm the fluid side first, then inspect the obstacle, supports, wall layers, wake transition, outlet recovery, cell count, and worst-quality locations.</p>
        <div className="evidence-checklist">{t07Evidence.map((item) => { const selected = reviewed.includes(item.title); return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}><span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button> })}</div>
        <div className={`lesson-callout ${reviewed.length === t07Evidence.length ? 'success' : ''}`}>{reviewed.length === t07Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{reviewed.length}/5 reviewed</strong>{reviewed.length === t07Evidence.length ? 'The internal-mesh review contract is complete.' : 'Review every internal-domain requirement before creating the environment.'}</p></div>
        <TutorialEvidenceRubric items={t07Pedagogy.evidenceRubric}/>
      </>
      default: return <>
        <div className="lesson-kicker"><Cloud size={15}/> Create the mesh environment</div>
        <h1>Create both Drafts from the bundled closed fluid volume.</h1>
        <p className="lesson-lead">The app uploads the supplied internal-flow CAD, creates one Geometry Project, registers the seed-defined fluid zone, and synchronizes global-only and feature-aware VolumeMesh Drafts.</p>
        <div className="run-readiness-card"><div className="run-ready-icon"><CheckCircle2 size={30}/></div><div><span>CONFIGURATION STATUS</span><strong>Closed domain and both mesh strategies validated</strong><p>The seed zone is registered in both Drafts; five local controls are the only variant difference.</p></div></div>
        <TutorialTransferCheck items={t07Pedagogy.transferQuestions}/>
        <TutorialEnvironmentBuilder status={status} tutorialId="T07" defaultProjectName="Tutorial T07 · internal duct meshing" heading="Build the T07 internal-flow mesh environment" description="The app uploads the bundled closed fluid volume and creates global-only and feature-aware VolumeMesh Drafts." configurationSummary="UserDefinedFarfield, registered SeedpointVolume, global defaults, sphere/support/floor transition controls" draftKind="VolumeMesh" baselineValue="Global-only internal mesh" variantValue="Feature-aware internal mesh" successDescription="Both VolumeMesh Draft parameter sets are synced. No surface or volume mesh computation has been submitted." createEnvironment={createT07Environment}/>
      </>
    }
  }

  return <div className="tutorial-player-page"><TopBar status={status} title="Guided tutorial · T07"/><aside className="tutorial-outline"><Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link><div className="tutorial-outline-title"><span>T07</span><h2>Mesh a closed internal duct</h2><small>Internal-flow meshing · 20–24 min</small></div><div className="tutorial-progress"><div><span>Progress</span><strong>{t07Progress(completed)}%</strong></div><progress value={t07Progress(completed)} max="100"/></div><nav aria-label="Tutorial steps">{t07Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav><button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setReviewed([]); setChecksVisible(false); setFeatureAware(false) }}><RotateCcw size={13}/> Reset progress</button></aside><main className="tutorial-lesson"><div className="lesson-content">{lesson()}</div><footer className="lesson-footer"><button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button><span>Step {stepIndex + 1} of {t07Steps.length}</span>{stepIndex < t07Steps.length - 1 ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}</footer></main></div>
}
