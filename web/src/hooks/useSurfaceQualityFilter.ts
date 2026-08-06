import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { UVFFieldFilter, UVFFieldFilterRule, UVFFieldInfo } from '../lib/uvf-three'
import {
  emptySurfaceQualityFilter,
  loadSurfaceQualityFilter,
  saveSurfaceQualityFilter,
} from '../lib/surfaceQualityFilters'

type FilterState = {
  resourceId: string
  filter: UVFFieldFilter
  matchCount: number
}

type FilterAction =
  | { type: 'load'; resourceId: string; filter: UVFFieldFilter }
  | { type: 'replace'; filter: UVFFieldFilter }
  | { type: 'matches'; count: number }

function reducer(state: FilterState, action: FilterAction): FilterState {
  if (action.type === 'load') return { resourceId: action.resourceId, filter: action.filter, matchCount: 0 }
  if (action.type === 'replace') return { ...state, filter: action.filter }
  return { ...state, matchCount: Math.max(0, Math.floor(action.count)) }
}

let ruleSequence = 0

export function useSurfaceQualityFilter(resourceId: string, fields: UVFFieldInfo[]) {
  const [state, dispatch] = useReducer(reducer, resourceId, (id) => ({
    resourceId: id,
    filter: loadSurfaceQualityFilter(id),
    matchCount: 0,
  }))

  useEffect(() => {
    if (state.resourceId === resourceId) return
    dispatch({ type: 'load', resourceId, filter: loadSurfaceQualityFilter(resourceId) })
  }, [resourceId, state.resourceId])

  useEffect(() => {
    if (state.resourceId !== resourceId) return
    saveSurfaceQualityFilter(resourceId, state.filter)
  }, [resourceId, state.filter, state.resourceId])

  const fieldByName = useMemo(() => new Map(fields.map((field) => [field.name, field])), [fields])
  const replace = useCallback((filter: UVFFieldFilter) => dispatch({ type: 'replace', filter }), [])
  const addRule = useCallback(() => {
    const field = fields[0]
    if (!field) return
    const rule: UVFFieldFilterRule = {
      id: `quality-rule-${Date.now().toString(36)}-${++ruleSequence}`,
      fieldName: field.name,
      min: field.min,
      max: field.max,
    }
    replace({ ...state.filter, rules: [...state.filter.rules, rule] })
  }, [fields, replace, state.filter])
  const removeRule = useCallback((ruleId: string) => {
    const rules = state.filter.rules.filter((rule) => rule.id !== ruleId)
    replace({ ...state.filter, enabled: rules.length > 0 && state.filter.enabled, rules })
  }, [replace, state.filter])
  const updateRule = useCallback((ruleId: string, patch: Partial<UVFFieldFilterRule>) => {
    const rules = state.filter.rules.map((rule) => {
      if (rule.id !== ruleId) return rule
      if (patch.fieldName && patch.fieldName !== rule.fieldName) {
        const field = fieldByName.get(patch.fieldName)
        if (field) return { ...rule, fieldName: field.name, min: field.min, max: field.max }
      }
      if (patch.min !== undefined && Number.isFinite(patch.min)) {
        return { ...rule, min: Math.min(patch.min, rule.max) }
      }
      if (patch.max !== undefined && Number.isFinite(patch.max)) {
        return { ...rule, max: Math.max(patch.max, rule.min) }
      }
      return rule
    })
    replace({ ...state.filter, rules })
  }, [fieldByName, replace, state.filter])
  const setEnabled = useCallback((enabled: boolean) => replace({ ...state.filter, enabled }), [replace, state.filter])
  const setOperator = useCallback((operator: 'and' | 'or') => replace({ ...state.filter, operator }), [replace, state.filter])
  const reset = useCallback(() => replace({ ...emptySurfaceQualityFilter, rules: [] }), [replace])
  const setMatchCount = useCallback((count: number) => dispatch({ type: 'matches', count }), [])

  return {
    filter: state.filter,
    matchCount: state.matchCount,
    setFilter: replace,
    addRule,
    removeRule,
    updateRule,
    setEnabled,
    setOperator,
    reset,
    setMatchCount,
  }
}
