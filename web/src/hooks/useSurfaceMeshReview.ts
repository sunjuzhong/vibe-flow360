import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type {
  UVFFieldExtrema,
  UVFFieldHistogram,
  UVFFieldInfo,
  UVFFieldProbe,
} from '../lib/uvf-three'
import {
  buildSurfaceBoundaryInventory,
  classifySurfaceMeshQualityFields,
  surfaceMeshParameterSummary,
  type SurfaceGroup,
} from '../lib/surfaceMeshReview'

export type SurfaceViewMode = 'plain' | 'boundaries' | 'quality'

type ReviewGroup = SurfaceGroup & { visible: boolean }

export type SurfaceMeshReviewState = {
  mode: SurfaceViewMode
  selection: { groupId: string | null }
  visibility: Record<string, boolean>
  qualityFields: UVFFieldInfo[]
  selectedField: string | null
  range: [number, number] | null
  histogram: UVFFieldHistogram | null
  extrema: UVFFieldExtrema | null
  probe: UVFFieldProbe | null
  focusTarget: [number, number, number] | null
}

export type SurfaceMeshReviewAction =
  | { type: 'reset-groups'; groups: ReviewGroup[] }
  | { type: 'mode'; mode: SurfaceViewMode }
  | { type: 'selection'; groupId: string | null }
  | { type: 'visibility'; visibility: Record<string, boolean> }
  | { type: 'toggle-visibility'; groupId: string }
  | { type: 'fields'; fields: UVFFieldInfo[] }
  | { type: 'field'; fieldName: string | null }
  | { type: 'range'; range: [number, number] | null }
  | { type: 'histogram'; histogram: UVFFieldHistogram | null }
  | { type: 'extrema'; extrema: UVFFieldExtrema | null }
  | { type: 'probe'; probe: UVFFieldProbe | null }
  | { type: 'locate-extreme'; direction: 'min' | 'max' }

export const initialSurfaceMeshReviewState: SurfaceMeshReviewState = {
  mode: 'boundaries',
  selection: { groupId: null },
  visibility: {},
  qualityFields: [],
  selectedField: null,
  range: null,
  histogram: null,
  extrema: null,
  probe: null,
  focusTarget: null,
}

export function reduceSurfaceMeshReviewState(
  state: SurfaceMeshReviewState,
  action: SurfaceMeshReviewAction,
): SurfaceMeshReviewState {
  switch (action.type) {
    case 'reset-groups':
      return {
        ...state,
        selection: action.groups.some((group) => group.id === state.selection.groupId)
          ? state.selection
          : { groupId: null },
        visibility: Object.fromEntries(action.groups.map((group) => [group.id, group.visible])),
        qualityFields: [],
        selectedField: null,
        range: null,
        histogram: null,
        extrema: null,
        probe: null,
        focusTarget: null,
      }
    case 'mode':
      return { ...state, mode: action.mode, probe: action.mode === 'quality' ? state.probe : null }
    case 'selection':
      return { ...state, selection: { groupId: action.groupId } }
    case 'visibility':
      return { ...state, visibility: action.visibility }
    case 'toggle-visibility':
      return {
        ...state,
        visibility: {
          ...state.visibility,
          [action.groupId]: !(state.visibility[action.groupId] ?? true),
        },
      }
    case 'fields': {
      const selected = action.fields.find((field) => field.name === state.selectedField)
        ?? null
      return {
        ...state,
        qualityFields: action.fields,
        selectedField: selected?.name ?? null,
        range: selected ? [selected.min, selected.max] : null,
        histogram: null,
        extrema: null,
        probe: null,
      }
    }
    case 'field': {
      const selected = state.qualityFields.find((field) => field.name === action.fieldName) ?? null
      return {
        ...state,
        selectedField: selected?.name ?? null,
        range: selected ? [selected.min, selected.max] : null,
        histogram: null,
        extrema: null,
        probe: null,
      }
    }
    case 'range':
      return { ...state, range: action.range }
    case 'histogram':
      return { ...state, histogram: action.histogram }
    case 'extrema':
      return { ...state, extrema: action.extrema }
    case 'probe':
      return { ...state, probe: action.probe }
    case 'locate-extreme': {
      const probe = state.extrema?.[action.direction] ?? null
      if (!probe) return state
      return {
        ...state,
        probe,
        selection: { groupId: probe.entityId },
        focusTarget: [...probe.position],
      }
    }
  }
}

export function useSurfaceMeshReview(
  groups: ReviewGroup[],
  simulationParams: unknown,
) {
  const [state, dispatch] = useReducer(reduceSurfaceMeshReviewState, initialSurfaceMeshReviewState)
  const boundaryInventory = useMemo(
    () => buildSurfaceBoundaryInventory(groups, simulationParams),
    [groups, simulationParams],
  )
  const surfaceParameters = useMemo(
    () => surfaceMeshParameterSummary(simulationParams),
    [simulationParams],
  )
  const qualityFieldNames = useMemo(
    () => state.qualityFields.map((field) => field.name),
    [state.qualityFields],
  )
  const selectedFieldInfo = state.qualityFields.find((field) => field.name === state.selectedField)
  const selectedBoundary = boundaryInventory.find((row) => row.id === state.selection.groupId)
  const assignedBoundaryCount = boundaryInventory.filter((row) => row.status === 'assigned').length
  const boundaryConflictCount = boundaryInventory.filter((row) => row.status === 'conflict').length

  useEffect(() => {
    dispatch({ type: 'reset-groups', groups })
  }, [groups])

  const setMode = useCallback((mode: SurfaceViewMode) => dispatch({ type: 'mode', mode }), [])
  const setSelection = useCallback(
    (selection: { groupId: string | null }) => dispatch({ type: 'selection', groupId: selection.groupId }),
    [],
  )
  const setVisibility = useCallback(
    (visibility: Record<string, boolean>) => dispatch({ type: 'visibility', visibility }),
    [],
  )
  const setSelectedField = useCallback(
    (fieldName: string | null) => dispatch({ type: 'field', fieldName }),
    [],
  )
  const setRange = useCallback(
    (range: [number, number] | null) => dispatch({ type: 'range', range }),
    [],
  )
  const setHistogram = useCallback(
    (histogram: UVFFieldHistogram | null) => dispatch({ type: 'histogram', histogram }),
    [],
  )
  const setExtrema = useCallback(
    (extrema: UVFFieldExtrema | null) => dispatch({ type: 'extrema', extrema }),
    [],
  )
  const setProbe = useCallback(
    (probe: UVFFieldProbe | null) => dispatch({ type: 'probe', probe }),
    [],
  )
  const handleFieldsDiscovered = useCallback((fields: UVFFieldInfo[]) => {
    dispatch({ type: 'fields', fields: classifySurfaceMeshQualityFields(fields) })
  }, [])
  const isolateBoundary = useCallback((groupId: string) => {
    dispatch({
      type: 'visibility',
      visibility: Object.fromEntries(boundaryInventory.map((row) => [row.id, row.id === groupId])),
    })
    dispatch({ type: 'selection', groupId })
  }, [boundaryInventory])
  const showAllBoundaries = useCallback(() => {
    dispatch({
      type: 'visibility',
      visibility: Object.fromEntries(boundaryInventory.map((row) => [row.id, true])),
    })
  }, [boundaryInventory])
  const hideAllBoundaries = useCallback(() => {
    dispatch({
      type: 'visibility',
      visibility: Object.fromEntries(boundaryInventory.map((row) => [row.id, false])),
    })
  }, [boundaryInventory])
  const toggleBoundaryVisibility = useCallback((groupId: string) => {
    dispatch({ type: 'toggle-visibility', groupId })
  }, [])
  const locateExtreme = useCallback(
    (direction: 'min' | 'max') => dispatch({ type: 'locate-extreme', direction }),
    [],
  )

  return {
    ...state,
    boundaryInventory,
    surfaceParameters,
    qualityFieldNames,
    selectedFieldInfo,
    selectedBoundary,
    assignedBoundaryCount,
    boundaryConflictCount,
    setMode,
    setSelection,
    setVisibility,
    setSelectedField,
    setRange,
    setHistogram,
    setExtrema,
    setProbe,
    handleFieldsDiscovered,
    isolateBoundary,
    showAllBoundaries,
    hideAllBoundaries,
    toggleBoundaryVisibility,
    locateExtreme,
  }
}
