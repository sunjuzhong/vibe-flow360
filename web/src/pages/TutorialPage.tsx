import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Download,
  Gauge,
  Layers3,
  Plane,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import type { Flow360Status } from '../api/client'
import { api } from '../api/client'
import TopBar from '../components/TopBar'
import TutorialEnvironmentBuilder from '../components/TutorialEnvironmentBuilder'
import { TutorialConceptBridge, TutorialDerivations, TutorialEvidenceRubric, TutorialFailureModes, TutorialPrediction, TutorialTransferCheck } from '../components/TutorialTeachingBlocks'
import T03TutorialPage from './T03TutorialPage'
import T02TutorialPage from './T02TutorialPage'
import T04TutorialPage from './T04TutorialPage'
import T05TutorialPage from './T05TutorialPage'
import T06TutorialPage from './T06TutorialPage'
import T07TutorialPage from './T07TutorialPage'
import T08TutorialPage from './T08TutorialPage'
import T09TutorialPage from './T09TutorialPage'
import T10TutorialPage from './T10TutorialPage'
import T12TutorialPage from './T12TutorialPage'
import T13TutorialPage from './T13TutorialPage'
import T14TutorialPage from './T14TutorialPage'
import T15TutorialPage from './T15TutorialPage'
import T16TutorialPage from './T16TutorialPage'
import {
  t01Evidence,
  t01ParameterCards,
  t01Pedagogy,
  t01ParamsForAlpha,
  t01Steps,
  tutorialProgress,
  validateT01Setup,
} from '../tutorials/t01'

const storageKey = 'vibesim.tutorial.T01.completed'

function readProgress() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function AircraftLessonVisual() {
  return (
    <svg className="tutorial-aircraft" viewBox="0 0 760 360" role="img" aria-label="Top view of the tutorial aircraft with surface groups">
      <defs>
        <linearGradient id="wing" x1="0" x2="1"><stop stopColor="#d9ec9d"/><stop offset="1" stopColor="#aeca58"/></linearGradient>
        <linearGradient id="body" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#fbfbf7"/><stop offset="1" stopColor="#dfe2d8"/></linearGradient>
      </defs>
      <path d="M350 42 Q380 12 410 42 L428 151 L690 207 Q706 212 693 222 L431 211 L415 303 L493 329 Q501 333 492 339 L380 326 L268 339 Q259 333 267 329 L345 303 L329 211 L67 222 Q54 212 70 207 L332 151 Z" fill="url(#wing)" stroke="#65762f" strokeWidth="2"/>
      <path d="M367 38 Q380 20 393 38 L405 204 L397 316 Q380 340 363 316 L355 204 Z" fill="url(#body)" stroke="#586053" strokeWidth="2"/>
      <line x1="170" y1="120" x2="305" y2="178"/><circle cx="170" cy="120" r="4"/><text x="82" y="112">leftWing</text>
      <line x1="590" y1="120" x2="455" y2="178"/><circle cx="590" cy="120" r="4"/><text x="600" y="112">rightWing</text>
      <line x1="520" y1="280" x2="405" y2="250"/><circle cx="520" cy="280" r="4"/><text x="530" y="286">fuselage</text>
    </svg>
  )
}

function downloadJSON(params: Record<string, unknown>, alpha: number) {
  const blob = new Blob([`${JSON.stringify(params, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `T01-alpha-${alpha}.simulation.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function TutorialPage() {
  const { tutorialId = '' } = useParams()
  if (tutorialId.toUpperCase() === 'T02') return <T02TutorialPage />
  if (tutorialId.toUpperCase() === 'T03') return <T03TutorialPage />
  if (tutorialId.toUpperCase() === 'T04') return <T04TutorialPage />
  if (tutorialId.toUpperCase() === 'T05') return <T05TutorialPage />
  if (tutorialId.toUpperCase() === 'T06') return <T06TutorialPage />
  if (tutorialId.toUpperCase() === 'T07') return <T07TutorialPage />
  if (tutorialId.toUpperCase() === 'T08') return <T08TutorialPage />
  if (tutorialId.toUpperCase() === 'T09') return <T09TutorialPage />
  if (tutorialId.toUpperCase() === 'T10') return <T10TutorialPage />
  if (tutorialId.toUpperCase() === 'T12') return <T12TutorialPage />
  if (tutorialId.toUpperCase() === 'T13') return <T13TutorialPage />
  if (tutorialId.toUpperCase() === 'T14') return <T14TutorialPage />
  if (tutorialId.toUpperCase() === 'T15') return <T15TutorialPage />
  if (tutorialId.toUpperCase() === 'T16') return <T16TutorialPage />
  if (tutorialId.toUpperCase() !== 'T01') return <Navigate to="/tutorials" replace />
  return <T01TutorialPage />
}

function T01TutorialPage() {
  const [status, setStatus] = useState<Flow360Status | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [completed, setCompleted] = useState<string[]>(readProgress)
  const [alpha, setAlpha] = useState<0 | 5>(0)
  const [checksVisible, setChecksVisible] = useState(false)
  const [evidenceReviewed, setEvidenceReviewed] = useState<string[]>([])
  const params = useMemo(() => t01ParamsForAlpha(alpha), [alpha])
  const checks = useMemo(() => validateT01Setup(params), [params])
  const step = t01Steps[stepIndex]

  useEffect(() => {
    api.flow360Status().then(setStatus).catch(() => setStatus({ available: false }))
  }, [])

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(completed))
  }, [completed])

  const finishStep = () => {
    setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])
    setStepIndex((current) => Math.min(current + 1, t01Steps.length - 1))
  }

  const renderLesson = () => {
    switch (step.id) {
      case 'question':
        return <>
          <div className="lesson-kicker"><Sparkles size={15}/> Engineering intent</div>
          <h1>Can this aircraft produce a stable, reviewable lift and drag result?</h1>
          <p className="lesson-lead">Compare 0° and 5° angle of attack with identical geometry, mesh, models, reference values, and outputs. Any change in CL or CD can then be attributed to angle of attack.</p>
          <div className="lesson-decision-card">
            <span>DECISION</span>
            <strong>Does the setup support a controlled angle-of-attack comparison?</strong>
            <p>Accept the comparison only when mesh checks pass, residuals converge, and force histories become stable.</p>
          </div>
          <div className="lesson-objectives">
            <div><CheckCircle2/><span><strong>Set aerodynamic quantities</strong>Use CL and CD with documented reference area and length.</span></div>
            <div><Layers3/><span><strong>Control one variable</strong>Apply the 5° merge patch while every other field stays fixed.</span></div>
            <div><ShieldCheck/><span><strong>Demand evidence</strong>Define acceptance criteria before seeing results.</span></div>
          </div>
          <TutorialConceptBridge cfd={t01Pedagogy.cfdConcepts} flow360={t01Pedagogy.flow360Concepts}/>
        </>
      case 'geometry':
        return <>
          <div className="lesson-kicker"><Plane size={15}/> Geometry semantics</div>
          <h1>Give every surface a physical role.</h1>
          <p className="lesson-lead">Flow360 receives geometry, but the simulation needs meaning. The three named surface groups become one aircraft wall; the generated outer sphere becomes the freestream boundary.</p>
          <div className="aircraft-stage"><AircraftLessonVisual /></div>
          <div className="geometry-assumptions">
            <div><span>UNIT</span><strong>metres</strong><small>Confirm before meshing</small></div>
            <div><span>WALL GROUPS</span><strong>3</strong><small>fuselage + two wings</small></div>
            <div><span>OUTER DOMAIN</span><strong>Auto</strong><small>50 geometry lengths</small></div>
          </div>
          <div className="lesson-callout warning"><AlertTriangle size={17}/><p><strong>Why this matters</strong>A unit mistake scales every mesh length. A boundary mistake changes the physics. Neither is repaired by solver convergence.</p></div>
        </>
      case 'setup':
        return <>
          <div className="lesson-kicker"><Gauge size={15}/> Reviewable setup</div>
          <h1>Make assumptions visible before running.</h1>
          <p className="lesson-lead">Each value is labeled by provenance: provided by the problem, calculated from the supplied data, or introduced as an explicit baseline assumption.</p>
          <div className="parameter-learning-grid">
            {t01ParameterCards.map((item) => <article key={item.label}>
              <div><span className={`provenance ${item.provenance}`}>{item.provenance}</span><strong>{item.label}</strong></div>
              <b>{item.value}</b><p>{item.why}</p>
            </article>)}
          </div>
          <TutorialDerivations items={t01Pedagogy.derivations}/>
          <button className="lesson-validate-button" onClick={() => setChecksVisible(true)}><ShieldCheck size={16}/> Validate this setup in the browser</button>
          {checksVisible && <div className="setup-checks">
            {checks.map((check) => <div className={check.passed ? 'passed' : 'failed'} key={check.id}>
              {check.passed ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<span><strong>{check.label}</strong><small>{check.detail}</small></span>
            </div>)}
          </div>}
        </>
      case 'variant':
        return <>
          <div className="lesson-kicker"><RotateCcw size={15}/> Controlled variant</div>
          <h1>Change one thing, then explain the difference.</h1>
          <p className="lesson-lead">Switch angle of attack below. The page applies an RFC 7396 merge patch; mesh, models, reference values, and requested outputs remain identical.</p>
          <TutorialPrediction experiment={t01Pedagogy.experiments[0]}/>
          <div className="alpha-experiment">
            <div className="alpha-control" role="group" aria-label="Angle of attack">
              <button className={alpha === 0 ? 'active' : ''} onClick={() => setAlpha(0)}><span>Baseline</span><strong>α = 0°</strong></button>
              <button className={alpha === 5 ? 'active' : ''} onClick={() => setAlpha(5)}><span>Variant</span><strong>α = 5°</strong></button>
            </div>
            <div className="alpha-visual" style={{ '--alpha': `${-alpha}deg` } as CSSProperties}>
              <div className="flow-lines">→ → → → → →</div><Plane size={82} strokeWidth={1.1}/>
              <span>relative airflow</span>
            </div>
            <div className="semantic-diff">
              <p className="eyebrow">SEMANTIC DIFF</p>
              <div><code>operating_condition.alpha</code><span>0°</span><ChevronRight size={14}/><strong>{alpha}°</strong></div>
              <small>{alpha === 0 ? 'Baseline selected. Choose 5° to apply the tutorial variant.' : 'Only angle of attack changes. Expect lift to increase, but verify it from stable forces.'}</small>
            </div>
          </div>
          <button className="lesson-secondary-button" onClick={() => downloadJSON(params, alpha)}><Download size={15}/> Download the selected setup</button>
          <TutorialFailureModes items={t01Pedagogy.failureModes}/>
        </>
      case 'evidence':
        return <>
          <div className="lesson-kicker"><ShieldCheck size={15}/> Evidence contract</div>
          <h1>Define the run acceptance conditions.</h1>
          <p className="lesson-lead">Require acceptable mesh quality, converged residuals, stable force histories, and interpretable surface fields.</p>
          <div className="evidence-checklist">
            {t01Evidence.map((item) => {
              const selected = evidenceReviewed.includes(item.title)
              return <button className={selected ? 'reviewed' : ''} key={item.title} onClick={() => setEvidenceReviewed((current) => selected ? current.filter((value) => value !== item.title) : [...current, item.title])}>
                <span className="evidence-check">{selected && <Check size={15}/>}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span>
              </button>
            })}
          </div>
          <div className={`lesson-callout ${evidenceReviewed.length === t01Evidence.length ? 'success' : ''}`}>
            {evidenceReviewed.length === t01Evidence.length ? <CheckCircle2 size={17}/> : <AlertTriangle size={17}/>}<p><strong>{evidenceReviewed.length}/4 reviewed</strong>{evidenceReviewed.length === t01Evidence.length ? 'You now have a complete acceptance contract for both Cases.' : 'Review all four evidence requirements before continuing.'}</p>
          </div>
          <TutorialEvidenceRubric items={t01Pedagogy.evidenceRubric}/>
        </>
      default:
        return <>
          <div className="lesson-kicker"><Cloud size={15}/> Execution boundary</div>
          <h1>The setup is ready for a reviewed cloud run.</h1>
          <p className="lesson-lead">The baseline and 5° parameters have passed local validation. Creating meshes and Cases consumes Flow360 resources, so submission remains an explicit action inside the project workspace.</p>
          <div className="run-readiness-card">
            <div className="run-ready-icon"><CheckCircle2 size={30}/></div>
            <div><span>CONFIGURATION STATUS</span><strong>Baseline and 5° variant validated</strong><p>Both setups use the same geometry, mesh, models, reference values, and outputs; alpha is the only parameter difference.</p></div>
          </div>
          <TutorialTransferCheck items={t01Pedagogy.transferQuestions}/>
          <TutorialEnvironmentBuilder status={status}/>
        </>
    }
  }

  return (
    <div className="tutorial-player-page">
      <TopBar status={status} title="Guided tutorial · T01" />
      <aside className="tutorial-outline">
        <Link className="tutorial-back" to="/tutorials"><ArrowLeft size={14}/> All tutorials</Link>
        <div className="tutorial-outline-title"><span>T01</span><h2>Aircraft lift and drag at two angles of attack</h2><small>Foundation · 15–20 min</small></div>
        <div className="tutorial-progress"><div><span>Progress</span><strong>{tutorialProgress(completed)}%</strong></div><progress value={tutorialProgress(completed)} max="100" /></div>
        <nav aria-label="Tutorial steps">
          {t01Steps.map((item, index) => <button key={item.id} className={`${index === stepIndex ? 'active' : ''} ${completed.includes(item.id) ? 'complete' : ''}`} onClick={() => setStepIndex(index)}>
            <span>{completed.includes(item.id) ? <Check size={13}/> : item.label}</span><div><strong>{item.title}</strong><small>{item.summary}</small></div>
          </button>)}
        </nav>
        <button className="tutorial-reset" onClick={() => { setCompleted([]); setStepIndex(0); setEvidenceReviewed([]); setChecksVisible(false); setAlpha(0) }}><RotateCcw size={13}/> Reset progress</button>
      </aside>
      <main className="tutorial-lesson">
        <div className="lesson-content">{renderLesson()}</div>
        <footer className="lesson-footer">
          <button className="lesson-previous" disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={15}/> Previous</button>
          <span>Step {stepIndex + 1} of {t01Steps.length}</span>
          {stepIndex < t01Steps.length - 1
            ? <button className="lesson-next" onClick={finishStep}>Complete & continue <ArrowRight size={15}/></button>
            : <button className="lesson-next" onClick={() => setCompleted((current) => current.includes(step.id) ? current : [...current, step.id])}><Check size={15}/> Mark tutorial complete</button>}
        </footer>
      </main>
    </div>
  )
}
