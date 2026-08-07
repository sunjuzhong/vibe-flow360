import { AlertCircle, ArrowRight, CheckCircle2, RefreshCw, Sparkles, X } from 'lucide-react'
import { useMemo } from 'react'
import type { AgentAction, AgentProposal, PlanAssistResponse, SimulationPlan } from '../api/client'
import { unwrapSimulationParams } from '../lib/planStages'

export type PlanRepairCandidate = {
  action: AgentAction
  proposal: AgentProposal
  preflight?: PlanAssistResponse['preflight']
  attempts: number
  autoRepaired: boolean
}

type Props = {
  plan: SimulationPlan
  currentParameters?: Record<string, unknown>
  candidate: PlanRepairCandidate | null
  generating: boolean
  applying: boolean
  onGenerate: () => void
  onApply: () => void
  onDiscard: () => void
}

export default function PlanParameterReview({
  plan,
  currentParameters,
  candidate,
  generating,
  applying,
  onGenerate,
  onApply,
  onDiscard,
}: Props) {
  const issues = plan.preflight?.issues ?? []
  const errors = issues.filter((issue) => issue.level === 'error')
  const warnings = issues.filter((issue) => issue.level === 'warning')
  const current = useMemo(
    () => applyJSONMergePatch(unwrapSimulationParams(currentParameters), plan.patch),
    [currentParameters, plan.patch],
  )
  const repairDiff = useMemo(() => candidate
    ? diffParameterValues(current, applyJSONMergePatch(current, candidate.proposal.patch))
    : [], [candidate, current])

  return (
    <section className="plan-repair-review" aria-label="Flow360 validation and AI repair">
      <header>
        <div>
          <h3>{errors.length ? 'Validation needs correction' : 'Validation passed'}</h3>
          <p>{errors.length
            ? `${errors.length} blocking parameter error${errors.length === 1 ? '' : 's'} found. AI Repair can prepare a minimal correction for review.`
            : `Flow360 accepted this revision${warnings.length ? ` with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}.`}</p>
        </div>
        {!candidate && errors.length > 0 && (
          <button type="button" className="plan-ai-repair" disabled={generating} onClick={onGenerate}>
            {generating ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
            {generating ? 'Preparing repair…' : 'AI Repair'}
          </button>
        )}
      </header>

      {!candidate && issues.length > 0 && (
        <div className="plan-validation-findings">
          {issues.map((issue, index) => (
            <div className={issue.level} key={`${issue.path}-${issue.code}-${index}`}>
              {issue.level === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
              <span>
                <code>{issue.path || 'SimulationParams'}</code>
                <small>{issue.message}</small>
              </span>
            </div>
          ))}
        </div>
      )}

      {candidate && (
        <div className="plan-repair-candidate">
          <div className="plan-repair-candidate-heading">
            <span><Sparkles size={15} /><strong>Proposed repair</strong></span>
            <button type="button" onClick={onDiscard} disabled={applying} aria-label="Discard AI repair"><X size={14} /></button>
          </div>
          <p>{candidate.action.message}</p>
          <div className={`plan-repair-prediction ${candidate.preflight?.valid ? 'ready' : 'warning'}`}>
            {candidate.preflight?.valid ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
            <span>{candidate.preflight?.valid
              ? `Expected to pass Flow360 validation${candidate.attempts ? ` after ${candidate.attempts} repair pass${candidate.attempts === 1 ? '' : 'es'}` : ''}.`
              : 'The Agent produced a correction, but Flow360 may still require another repair pass.'}</span>
          </div>
          <div className="plan-repair-diff" aria-label="Proposed parameter changes">
            {repairDiff.length ? repairDiff.map((change) => (
              <div key={change.path}>
                <code>{change.path}</code>
                <span className={`diff-kind ${change.kind}`}>{change.kind}</span>
                <small className="before">{compactValue(change.before)}</small>
                <ArrowRight size={12} />
                <small className="after">{compactValue(change.after)}</small>
              </div>
            )) : <div className="plan-neutral">The Agent did not change any public SimulationParams values.</div>}
          </div>
          <footer>
            <button type="button" onClick={onDiscard} disabled={applying}>Cancel</button>
            <button type="button" className="primary" onClick={onApply} disabled={applying || !repairDiff.length}>
              {applying ? <RefreshCw size={14} className="spin" /> : <Sparkles size={14} />}
              {applying ? 'Applying & validating…' : 'Apply repair & validate'}
            </button>
          </footer>
        </div>
      )}
    </section>
  )
}

export type ParameterChange = {
  path: string
  before: unknown
  after: unknown
  kind: 'added' | 'changed' | 'removed'
}

export function diffParameterValues(before: Record<string, unknown>, after: Record<string, unknown>, prefix = ''): ParameterChange[] {
  const changes: ParameterChange[] = []
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const path = prefix ? `${prefix}.${key}` : key
    const hasBefore = Object.prototype.hasOwnProperty.call(before, key)
    const hasAfter = Object.prototype.hasOwnProperty.call(after, key)
    const previous = before[key]
    const next = after[key]
    if (!hasAfter) {
      changes.push({ path, before: previous, after: undefined, kind: 'removed' })
    } else if (!hasBefore) {
      changes.push({ path, before: undefined, after: next, kind: 'added' })
    } else if (isRecord(previous) && isRecord(next)) {
      changes.push(...diffParameterValues(previous, next, path))
    } else if (JSON.stringify(previous) !== JSON.stringify(next)) {
      changes.push({ path, before: previous, after: next, kind: 'changed' })
    }
  }
  return changes
}

export function applyJSONMergePatch(source: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...source }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete result[key]
    } else if (isRecord(value)) {
      result[key] = applyJSONMergePatch(isRecord(result[key]) ? result[key] : {}, value)
    } else {
      result[key] = value
    }
  }
  return result
}

function compactValue(value: unknown) {
  if (value === undefined) return 'Not set'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
