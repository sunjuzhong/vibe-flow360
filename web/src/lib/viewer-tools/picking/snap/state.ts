import type { SnapCandidate, SnapStatusModel } from './types'

export interface SnapCycleState {
  readonly candidates: readonly SnapCandidate[]
  readonly activeIndex: number
  readonly bypassed: boolean
}

export function createSnapCycleState(
  candidates: readonly SnapCandidate[] = [],
  bypassed = false,
): SnapCycleState {
  return { candidates, activeIndex: 0, bypassed }
}

export function replaceSnapCandidates(
  state: SnapCycleState,
  candidates: readonly SnapCandidate[],
): SnapCycleState {
  const active = state.candidates[state.activeIndex]
  const retainedIndex = active ? candidates.findIndex((candidate) => candidateKey(candidate) === candidateKey(active)) : -1
  return {
    ...state,
    candidates,
    activeIndex: retainedIndex >= 0 ? retainedIndex : 0,
  }
}

/** Tab calls this with +1; Shift+Tab can pass -1. */
export function cycleSnapCandidate(state: SnapCycleState, direction = 1): SnapCycleState {
  if (state.candidates.length < 2) return state
  const activeIndex = (state.activeIndex + direction + state.candidates.length) % state.candidates.length
  return { ...state, activeIndex }
}

export function setSnapBypassed(state: SnapCycleState, bypassed: boolean): SnapCycleState {
  return state.bypassed === bypassed ? state : { ...state, bypassed }
}

export function selectedSnapCandidate(state: SnapCycleState): SnapCandidate | null {
  if (state.bypassed) {
    return state.candidates.find((candidate) => candidate.kind === 'surface') ?? null
  }
  return state.candidates[state.activeIndex] ?? null
}

export function snapStatusModel(state: SnapCycleState): SnapStatusModel {
  const selected = selectedSnapCandidate(state)
  const surfaceOnly = selected?.kind === 'surface'
  const label = selected ? selected.kind.replaceAll('-', ' ').toUpperCase() : 'SNAP UNAVAILABLE'
  return {
    mode: state.bypassed ? 'bypassed' : surfaceOnly ? 'surface' : selected ? 'active' : 'unavailable',
    label: state.bypassed ? 'SURFACE · ALT BYPASS' : label,
    confidence: selected?.confidence,
    candidateIndex: selected ? state.candidates.indexOf(selected) : -1,
    candidateCount: state.candidates.length,
    indicator: selected ? {
      position: [selected.worldPosition.x, selected.worldPosition.y, selected.worldPosition.z],
      label: state.bypassed ? 'SURFACE' : label,
    } : undefined,
  }
}

function candidateKey(candidate: SnapCandidate): string {
  return candidate.stableId
    ? `${candidate.kind}:${candidate.stableId}`
    : `${candidate.kind}:${candidate.vertexIndex ?? ''}:${candidate.worldPosition.toArray().join(',')}`
}
