import { AlertTriangle, CheckCircle2, FlaskConical, GraduationCap, HelpCircle, Sigma, Workflow } from 'lucide-react'
import { useState } from 'react'
import type { TutorialConcept, TutorialDerivation, TutorialEvidenceCriterion, TutorialExperiment, TutorialFailureMode, TutorialTransferQuestion } from '../tutorials/pedagogy'

export function TutorialConceptBridge({ cfd, flow360 }: { cfd: TutorialConcept[]; flow360: TutorialConcept[] }) {
  return <section className="teaching-block"><div className="teaching-block-heading"><GraduationCap size={18}/><div><strong>Physical effect and Flow360 control</strong><span>Match each flow feature to the object and field that controls it.</span></div></div><div className="concept-bridge-grid"><div><h3>CFD model</h3>{cfd.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.explanation}</p><small><AlertTriangle size={13}/>{item.misconception}</small></article>)}</div><div><h3>Flow360 representation</h3>{flow360.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.explanation}</p><small><HelpCircle size={13}/>{item.misconception}</small></article>)}</div></div></section>
}

export function TutorialDerivations({ items }: { items: TutorialDerivation[] }) {
  return <section className="teaching-block"><div className="teaching-block-heading"><Sigma size={18}/><div><strong>Parameter derivation</strong><span>Calculate dimensions and ratios from the reference geometry and operating condition.</span></div></div><div className="derivation-grid">{items.map((item) => <article key={item.id}><strong>{item.parameter}</strong><p>{item.basis}</p><code>{item.calculation}</code><small>{item.transfer}</small></article>)}</div></section>
}

export function TutorialPrediction({ experiment }: { experiment: TutorialExperiment }) {
  const [choice, setChoice] = useState('')
  const [revealed, setRevealed] = useState(false)
  return <section className="teaching-block prediction-block"><div className="teaching-block-heading"><FlaskConical size={18}/><div><strong>Expected effect of the variant</strong><span>Select the expected outcome for the stated parameter change.</span></div></div><p>{experiment.prediction}</p><div className="prediction-options" role="group" aria-label="Prediction options">{experiment.options.map((option) => <button className={choice === option ? 'active' : ''} key={option} onClick={() => { setChoice(option); setRevealed(false) }}>{option}</button>)}</div><button className="lesson-secondary-button" disabled={!choice} onClick={() => setRevealed(true)}>Show expected outcome</button>{revealed && <div className="prediction-result"><strong>Your selection: {choice}</strong><p><b>Controlled variable</b>{experiment.controlledVariable}</p><p><b>What to observe</b>{experiment.observation}</p></div>}</section>
}

export function TutorialFailureModes({ items }: { items: TutorialFailureMode[] }) {
  return <section className="teaching-block"><div className="teaching-block-heading"><AlertTriangle size={18}/><div><strong>Failure diagnosis</strong><span>Match each observed symptom to its likely cause and correction.</span></div></div><div className="failure-mode-grid">{items.map((item) => <article key={item.id}><strong>{item.symptom}</strong><p><b>Likely cause</b>{item.cause}</p><p><b>Correction</b>{item.correction}</p></article>)}</div></section>
}

export function TutorialEvidenceRubric({ items }: { items: TutorialEvidenceCriterion[] }) {
  return <section className="teaching-block"><div className="teaching-block-heading"><CheckCircle2 size={18}/><div><strong>Acceptance criteria</strong><span>Compare the generated evidence with each pass and fail condition.</span></div></div><div className="evidence-rubric">{items.map((item) => <article key={item.id}><strong>{item.observation}</strong><p className="rubric-pass"><b>PASS</b>{item.pass}</p><p className="rubric-fail"><b>FAIL</b>{item.fail}</p></article>)}</div></section>
}

export function TutorialTransferCheck({ items }: { items: TutorialTransferQuestion[] }) {
  const [open, setOpen] = useState<string[]>([])
  return <section className="teaching-block"><div className="teaching-block-heading"><Workflow size={18}/><div><strong>Changed-condition check</strong><span>Recalculate the setup after the geometry or operating condition changes.</span></div></div><div className="transfer-questions">{items.map((item) => { const shown = open.includes(item.prompt); return <button key={item.prompt} onClick={() => setOpen((current) => shown ? current.filter((value) => value !== item.prompt) : [...current, item.prompt])}><strong>{item.prompt}</strong><span>{shown ? item.expected : 'Show expected answer'}</span></button> })}</div></section>
}
