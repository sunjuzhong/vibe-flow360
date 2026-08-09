import { AlertTriangle, CheckCircle2, FlaskConical, GraduationCap, HelpCircle, Sigma, Workflow } from 'lucide-react'
import { useState } from 'react'
import type { TutorialConcept, TutorialDerivation, TutorialEvidenceCriterion, TutorialExperiment, TutorialFailureMode, TutorialTransferQuestion } from '../tutorials/pedagogy'

export function TutorialConceptBridge({ cfd, flow360 }: { cfd: TutorialConcept[]; flow360: TutorialConcept[] }) {
  return <section className="teaching-block"><div className="teaching-block-heading"><GraduationCap size={18}/><div><strong>Connect CFD to Flow360</strong><span>Understand the physics first, then locate its configuration.</span></div></div><div className="concept-bridge-grid"><div><h3>CFD model</h3>{cfd.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.explanation}</p><small><AlertTriangle size={13}/>{item.misconception}</small></article>)}</div><div><h3>Flow360 representation</h3>{flow360.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.explanation}</p><small><HelpCircle size={13}/>{item.misconception}</small></article>)}</div></div></section>
}

export function TutorialDerivations({ items }: { items: TutorialDerivation[] }) {
  return <section className="teaching-block"><div className="teaching-block-heading"><Sigma size={18}/><div><strong>Derive the teaching values</strong><span>Ratios and assumptions transfer; copied numbers do not.</span></div></div><div className="derivation-grid">{items.map((item) => <article key={item.id}><strong>{item.parameter}</strong><p>{item.basis}</p><code>{item.calculation}</code><small>{item.transfer}</small></article>)}</div></section>
}

export function TutorialPrediction({ experiment }: { experiment: TutorialExperiment }) {
  const [choice, setChoice] = useState('')
  const [revealed, setRevealed] = useState(false)
  return <section className="teaching-block prediction-block"><div className="teaching-block-heading"><FlaskConical size={18}/><div><strong>Predict before revealing</strong><span>A controlled experiment changes one engineering decision.</span></div></div><p>{experiment.prediction}</p><div className="prediction-options" role="group" aria-label="Prediction options">{experiment.options.map((option) => <button className={choice === option ? 'active' : ''} key={option} onClick={() => { setChoice(option); setRevealed(false) }}>{option}</button>)}</div><button className="lesson-secondary-button" disabled={!choice} onClick={() => setRevealed(true)}>Reveal the engineering explanation</button>{revealed && <div className="prediction-result"><strong>Your prediction: {choice}</strong><p><b>Controlled variable</b>{experiment.controlledVariable}</p><p><b>What to observe</b>{experiment.observation}</p></div>}</section>
}

export function TutorialFailureModes({ items }: { items: TutorialFailureMode[] }) {
  return <section className="teaching-block"><div className="teaching-block-heading"><AlertTriangle size={18}/><div><strong>Learn from failure</strong><span>Recognize the symptom before changing a parameter.</span></div></div><div className="failure-mode-grid">{items.map((item) => <article key={item.id}><strong>{item.symptom}</strong><p><b>Likely cause</b>{item.cause}</p><p><b>Correction</b>{item.correction}</p></article>)}</div></section>
}

export function TutorialEvidenceRubric({ items }: { items: TutorialEvidenceCriterion[] }) {
  return <section className="teaching-block"><div className="teaching-block-heading"><CheckCircle2 size={18}/><div><strong>Use a pass/fail rubric</strong><span>Evidence must support a decision, not just decorate a report.</span></div></div><div className="evidence-rubric">{items.map((item) => <article key={item.id}><strong>{item.observation}</strong><p className="rubric-pass"><b>PASS</b>{item.pass}</p><p className="rubric-fail"><b>FAIL</b>{item.fail}</p></article>)}</div></section>
}

export function TutorialTransferCheck({ items }: { items: TutorialTransferQuestion[] }) {
  const [open, setOpen] = useState<string[]>([])
  return <section className="teaching-block"><div className="teaching-block-heading"><Workflow size={18}/><div><strong>Transfer the reasoning</strong><span>Check whether you can adapt the method instead of memorizing it.</span></div></div><div className="transfer-questions">{items.map((item) => { const shown = open.includes(item.prompt); return <button key={item.prompt} onClick={() => setOpen((current) => shown ? current.filter((value) => value !== item.prompt) : [...current, item.prompt])}><strong>{item.prompt}</strong><span>{shown ? item.expected : 'Show expected reasoning'}</span></button> })}</div></section>
}
