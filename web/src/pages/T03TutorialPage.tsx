import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDot,
  Cloud,
  Download,
  Grid3X3,
  Layers3,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { TutorialConceptBridge, TutorialDerivations, TutorialEvidenceRubric, TutorialFailureModes, TutorialPrediction, TutorialTransferCheck } from '../components/TutorialTeachingBlocks'
import {
  createT03Environment,
  t03Evidence,
  t03ParameterCards,
  t03Params,
  t03Pedagogy,
  t03Progress,
  t03Steps,
  validateT03Setup,
} from '../tutorials/t03'

const storageKey = 'vibesim.tutorial.T03.completed'

function readProgress() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function downloadJSON(params: Record<string, unknown>, refined: boolean) {
  const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `T03-${refined ? 'refined' : 'baseline'}.simulation.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function CylinderMeshVisual({ refined = false }: { refined?: boolean }) {
  const facets = refined ? 24 : 14
  const polygon = Array.from({ length: facets }, (_, index) => {
    const angle = (index / facets) * Math.PI * 2
    return `${180 + Math.cos(angle) * 92},${155 + Math.sin(angle) * 92}`
  }).join(' ')
  return <svg className="tutorial-cylinder" viewBox="0 0 520 310" role="img" aria-label={`${refined ? 'Refined' : 'Baseline'} cylinder surface facets and boundary layers`}>
    <defs><linearGradient id={`cylinder-${facets}`} x1="0" x2="1"><stop stopColor="#d9ec9d"/><stop offset="1" stopColor="#9ebc45"/></linearGradient></defs>
    {[125, 112, 103].map((radius) => <circle key={radius} cx="180" cy="155" r={radius} fill="none" stroke="#9db76a" strokeDasharray="5 5" opacity=".65" />)}
    <polygon points={polygon} fill={`url(#cylinder-${facets})`} stroke="#52652d" strokeWidth="2"/>
    {Array.from({ length: facets }, (_, index) => {
      const angle = (index / facets) * Math.PI * 2
      return <line key={index} x1={180} y1={155} x2={180 + Math.cos(angle) * 92} y2={155 + Math.sin(angle) * 92} stroke="#748a3e" opacity=".35"/>
    })}
    <line x1="305" y1="155" x2="420" y2="155" stroke="#67735c"/><text x="330" y="143">boundary layers</text>
    <text x="330" y="187">{facets} teaching facets</text><text x="330" y="210">curvature ≤ {refined ? '6°' : '10°'}</text>
  </svg>
}

export default function T03TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [refined, setRefined] = useState(false)
  const [checksVisible, setChecksVisible] = useState(false)
  const [evidenceReviewed, setEvidenceReviewed] = useState<string[]>([])
  const params = useMemo(() => t03Params(refined), [refined])
  const checks = useMemo(() => validateT03Setup(params), [params])
  const step = t03Steps[stepIndex]

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
  }, [])
  useEffect(() => window.localStorage.setItem(storageKey, JSON.stringify(completed)), [completed])

  const finishStep = () => {
    setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])
    setStepIndex((current) => Math.min(current + 1, t03Steps.length - 1))
  }

  const renderLesson = () => {
    switch (step.id) {
      case 'question': return <>
        <div className="lesson-kicker"><Sparkles size={15}/> Engineering intent</div>
        <h1>Can this mesh resolve both the cylinder shape and its near-wall gradient?</h1>
        <p className="lesson-lead">You will make surface curvature and boundary-layer assumptions explicit before a solver Case exists. The decision is mesh credibility—not whether a job finishes.</p>
        <div className="lesson-decision-card"><span>DECISION</span><strong>Which mesh is ready to support the next cylinder experiment?</strong><p>Use the same geometry and farfield for both Drafts so the comparison isolates resolution choices.</p></div>
        <div className="lesson-objectives">
          <div><CircleDot/><span><strong>Resolve curvature</strong>Connect normal-angle change to facets around the circular profile.</span></div>
          <div><Layers3/><span><strong>Protect the wall</strong>Make first-layer thickness and growth rate reviewable.</span></div>
          <div><ShieldCheck/><span><strong>Inspect before solve</strong>Define mesh evidence before paying for a Case.</span></div>
        </div>
        <TutorialConceptBridge cfd={t03Pedagogy.cfdConcepts} flow360={t03Pedagogy.flow360Concepts}/>
      </>
      case 'geometry': return <>
        <div className="lesson-kicker"><CircleDot size={15}/> Geometry and curvature</div>
        <h1>A smooth CAD cylinder still becomes discrete facets.</h1>
        <p className="lesson-lead">The cylinder is 1 m in diameter and 17 m in span. Curvature resolution limits how much adjacent surface normals may turn, while maximum edge length prevents oversized triangles.</p>
        <div className="cylinder-stage"><CylinderMeshVisual /></div>
        <div className="geometry-assumptions">
          <div><span>DIAMETER</span><strong>1 m</strong><small>sets curvature scale</small></div>
          <div><span>SPAN</span><strong>17 m</strong><small>three-dimensional body</small></div>
          <div><span>FACE GROUP</span><strong>1</strong><small>cylinder wall</small></div>
        </div>
        <div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>Two independent limits</strong>A small maximum edge length does not guarantee smooth curvature everywhere; a curvature limit does not cap long edges on flat regions.</p></div>
      </>
      case 'setup': return <>
        <div className="lesson-kicker"><Grid3X3 size={15}/> Layered mesh controls</div>
        <h1>Let global defaults establish policy, then refine the cylinder locally.</h1>
        <p className="lesson-lead">The local SurfaceRefinement and BoundaryLayer override attention around the body without forcing the full farfield to use the same spacing.</p>
        <div className="parameter-learning-grid">{t03ParameterCards.map((item) => <article key={item.label}><div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div><b>{item.value}</b><p>{item.why}</p></article>)}</div>
        <TutorialDerivations items={t03Pedagogy.derivations}/>
        <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate this mesh setup in the browser</button>
        {checksVisible && <div className="setup-checks">{checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>{check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span></div>)}</div>}
      </>
      case 'variant': return <>
        <div className="lesson-kicker"><ScanLine size={15}/> Controlled refinement</div>
        <h1>Tighten spatial controls without changing the model.</h1>
        <p className="lesson-lead">The refined Draft changes local edge length, local curvature angle, and first-layer thickness. Geometry, mesher, growth rate, and farfield stay fixed.</p>
        <TutorialPrediction experiment={t03Pedagogy.experiments[0]}/>
        <div className="mesh-experiment">
          <div className="alpha-control" role="group" aria-label="Mesh fidelity">
            <button className={!refined ? 'active' : ''} onClick={() => setRefined(false)}><span>Baseline</span><strong>0.25 m · 10°</strong></button>
            <button className={refined ? 'active' : ''} onClick={() => setRefined(true)}><span>Refined</span><strong>0.15 m · 6°</strong></button>
          </div>
          <div className="cylinder-stage compact"><CylinderMeshVisual refined={refined}/></div>
          <div className="semantic-diff"><p className="eyebrow">SEMANTIC DIFF</p><div><code>first_layer_thickness</code><span>0.01 m</span><ArrowRight size={14}/><strong>{refined ? '0.005 m' : '0.01 m'}</strong></div><small>{refined ? 'Three spatial controls tighten; growth rate and domain remain identical.' : 'Choose Refined to apply the validated merge patch.'}</small></div>
        </div>
        <TutorialFailureModes items={t03Pedagogy.failureModes}/>
        <button className="lesson-secondary-button" onClick={() => downloadJSON(params, refined)}><Download size={15}/> Download the selected mesh setup</button>
      </>
      case 'evidence': return <>
        <div className="lesson-kicker"><ShieldCheck size={15}/> Mesh evidence contract</div>
        <h1>A finer parameter value is a hypothesis until the mesh is inspected.</h1>
        <p className="lesson-lead">Review all four conditions. They establish what the generated SurfaceMesh and VolumeMesh must demonstrate before the solver stage.</p>
        <div className="evidence-checklist">{t03Evidence.map((item) => { const selected = evidenceReviewed.includes(item.title); return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setEvidenceReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}><span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span></button> })}</div>
        <div className={`lesson-callout ${evidenceReviewed.length === t03Evidence.length ? 'success' : ''}`}>{evidenceReviewed.length === t03Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{evidenceReviewed.length}/4 reviewed</strong>{evidenceReviewed.length === t03Evidence.length ? 'The mesh acceptance contract is ready for both Drafts.' : 'Review all four requirements before creating the experiment.'}</p></div>
        <TutorialEvidenceRubric items={t03Pedagogy.evidenceRubric}/>
      </>
      default: return <>
        <div className="lesson-kicker"><Cloud size={15}/> Execution boundary</div>
        <h1>Create the mesh experiment without starting cloud meshing.</h1>
        <p className="lesson-lead">The app can now create the cylinder Geometry Project and two configured VolumeMesh Drafts. Surface and volume meshing remain explicit, separately approved actions.</p>
        <div className="run-readiness-card"><div className="run-ready-icon"><CheckCircle2 size={30}/></div><div><span>LOCAL TUTORIAL STATUS</span><strong>Baseline and refined mesh validated</strong><p>38 meshing schema capabilities are backed by the pinned Flow360 25.10.3 artifact.</p></div></div>
        <TutorialTransferCheck items={t03Pedagogy.transferQuestions}/>
        <TutorialEnvironmentBuilder
          status={status}
          tutorialId="T03"
          defaultProjectName="Tutorial T03 · Cylinder mesh"
          heading="Build the T03 mesh environment from this lesson"
          description="The app uploads the bundled cylinder, waits for its Geometry, and creates two configured Flow360 VolumeMesh Drafts."
          configurationSummary="Curvature, surface spacing, first layer, growth rates, farfield, beta mesher"
          draftKind="VolumeMesh"
          baselineValue="0.25 m · 10° · 0.01 m"
          variantValue="0.15 m · 6° · 0.005 m"
          successDescription="The Geometry is processed and both VolumeMesh Draft parameters are synced. No surface or volume mesh computation has been submitted."
          createEnvironment={createT03Environment}
        />
      </>
    }
  }

  return <div className="tutorial-player-page">
    <TopBar status={status} title="Guided tutorial · T03" />
    <aside className="tutorial-outline">
      <Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link>
      <div className="tutorial-outline-title"><span>T03</span><h2>Curvature-sensitive cylinder mesh</h2><small>Meshing · 15–20 min</small></div>
      <div className="tutorial-progress"><div><span>Progress</span><strong>{t03Progress(completed)}%</strong></div><progress value={t03Progress(completed)} max="100" /></div>
      <nav aria-label="Tutorial steps">{t03Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}><span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div></button>)}</nav>
      <button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setEvidenceReviewed([]); setChecksVisible(false); setRefined(false) }}><RotateCcw size={13}/> Reset progress</button>
    </aside>
    <main className="tutorial-lesson"><div className="lesson-content">{renderLesson()}</div><footer className="lesson-footer">
      <button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button>
      <span>Step {stepIndex + 1} of {t03Steps.length}</span>
      {stepIndex < t03Steps.length - 1 ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button> : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}
    </footer></main>
  </div>
}
