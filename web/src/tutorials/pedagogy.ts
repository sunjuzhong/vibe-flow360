export type TutorialConcept = {
  id: string
  title: string
  explanation: string
  misconception: string
}

export type TutorialDerivation = {
  id: string
  parameter: string
  basis: string
  calculation: string
  transfer: string
}

export type TutorialExperiment = {
  id: string
  prediction: string
  options: string[]
  controlledVariable: string
  observation: string
}

export type TutorialFailureMode = {
  id: string
  symptom: string
  cause: string
  correction: string
}

export type TutorialEvidenceCriterion = {
  id: string
  observation: string
  pass: string
  fail: string
}

export type TutorialTransferQuestion = {
  prompt: string
  expected: string
}

export type TutorialPedagogy = {
  learningObjectives: string[]
  cfdConcepts: TutorialConcept[]
  flow360Concepts: TutorialConcept[]
  derivations: TutorialDerivation[]
  experiments: TutorialExperiment[]
  failureModes: TutorialFailureMode[]
  evidenceRubric: TutorialEvidenceCriterion[]
  transferQuestions: TutorialTransferQuestion[]
}

export function tutorialPedagogyIssues(pedagogy: TutorialPedagogy): string[] {
  const issues: string[] = []
  if (pedagogy.learningObjectives.length < 3) issues.push('At least three measurable learning objectives are required.')
  if (pedagogy.cfdConcepts.length < 2) issues.push('At least two CFD concepts are required.')
  if (pedagogy.flow360Concepts.length < 2) issues.push('At least two Flow360 concepts are required.')
  if (pedagogy.derivations.length < 2) issues.push('At least two parameter derivations are required.')
  if (!pedagogy.experiments.some((item) => item.options.length >= 2)) issues.push('At least one prediction experiment with two options is required.')
  if (pedagogy.failureModes.length < 2) issues.push('At least two failure modes are required.')
  if (pedagogy.evidenceRubric.length < 3) issues.push('At least three pass/fail evidence criteria are required.')
  if (pedagogy.transferQuestions.length < 2) issues.push('At least two transfer questions are required.')
  return issues
}

export function tutorialPedagogyCopy(pedagogy: TutorialPedagogy): string[] {
  return [
    ...pedagogy.learningObjectives,
    ...[...pedagogy.cfdConcepts, ...pedagogy.flow360Concepts].flatMap((item) => [item.title, item.explanation, item.misconception]),
    ...pedagogy.derivations.flatMap((item) => [item.parameter, item.basis, item.calculation, item.transfer]),
    ...pedagogy.experiments.flatMap((item) => [item.prediction, ...item.options, item.controlledVariable, item.observation]),
    ...pedagogy.failureModes.flatMap((item) => [item.symptom, item.cause, item.correction]),
    ...pedagogy.evidenceRubric.flatMap((item) => [item.observation, item.pass, item.fail]),
    ...pedagogy.transferQuestions.flatMap((item) => [item.prompt, item.expected]),
  ]
}
