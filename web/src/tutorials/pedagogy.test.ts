import { describe, expect, it } from 'vitest'
import { tutorialPedagogyCopy, tutorialPedagogyIssues, type TutorialPedagogy } from './pedagogy'

const complete: TutorialPedagogy = {
  learningObjectives: ['Explain the physics.', 'Map it to Flow360.', 'Judge generated evidence.'],
  cfdConcepts: [
    { id: 'a', title: 'A', explanation: 'Explanation A', misconception: 'Misconception A' },
    { id: 'b', title: 'B', explanation: 'Explanation B', misconception: 'Misconception B' },
  ],
  flow360Concepts: [
    { id: 'c', title: 'C', explanation: 'Explanation C', misconception: 'Misconception C' },
    { id: 'd', title: 'D', explanation: 'Explanation D', misconception: 'Misconception D' },
  ],
  derivations: [
    { id: 'e', parameter: 'E', basis: 'Basis E', calculation: 'E = 1', transfer: 'Transfer E' },
    { id: 'f', parameter: 'F', basis: 'Basis F', calculation: 'F = 2', transfer: 'Transfer F' },
  ],
  experiments: [{ id: 'g', prediction: 'Predict G', options: ['one', 'two'], controlledVariable: 'Only G', observation: 'Observe G' }],
  failureModes: [
    { id: 'h', symptom: 'H', cause: 'Cause H', correction: 'Correct H' },
    { id: 'i', symptom: 'I', cause: 'Cause I', correction: 'Correct I' },
  ],
  evidenceRubric: [
    { id: 'j', observation: 'J', pass: 'Pass J', fail: 'Fail J' },
    { id: 'k', observation: 'K', pass: 'Pass K', fail: 'Fail K' },
    { id: 'l', observation: 'L', pass: 'Pass L', fail: 'Fail L' },
  ],
  transferQuestions: [{ prompt: 'M?', expected: 'M.' }, { prompt: 'N?', expected: 'N.' }],
}

describe('Tutorial Standard v2 data model', () => {
  it('accepts every required teaching layer', () => expect(tutorialPedagogyIssues(complete)).toEqual([]))
  it('reports missing teaching layers', () => expect(tutorialPedagogyIssues({ ...complete, failureModes: [] })).toContain('At least two failure modes are required.'))
  it('collects dynamic copy for locale coverage', () => expect(tutorialPedagogyCopy(complete)).toContain('Misconception A'))
})
