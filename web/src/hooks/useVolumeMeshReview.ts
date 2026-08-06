import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { ResourceDetail } from '../api/client'
import type { BoundingBoxData, MeshGroupData, ViewerClipPlane } from '../components/viewer/LazyViewer3D'
import type {
  UVFFieldExtrema,
  UVFFieldHistogram,
  UVFFieldInfo,
  UVFFieldProbe,
} from '../lib/uvf-three'
import {
  buildVolumeZoneInventory,
  buildBoundaryLayerReview,
  classifyBoundaryLayerEvidenceFields,
  classifyVolumeMeshQualityFields,
  volumeMeshCapabilities,
  volumeMeshParameterSummary,
  type VolumeViewMode,
} from '../lib/volumeMeshReview'
import { buildVolumeRefinementReview } from '../lib/volumeRefinementReview'

type ReviewGroup = MeshGroupData

export type VolumeMeshReviewState = {
  mode: VolumeViewMode
  selection: { groupId: string | null }
  visibility: Record<string, boolean>
  allFields: UVFFieldInfo[]
  qualityFields: UVFFieldInfo[]
  boundaryLayerFields: UVFFieldInfo[]
  selectedField: string | null
  range: [number, number] | null
  histogram: UVFFieldHistogram | null
  extrema: UVFFieldExtrema | null
  probe: UVFFieldProbe | null
  focusTarget: [number, number, number] | null
  clipEnabled: boolean
  clipAxis: 'x' | 'y' | 'z'
  clipPosition: number
}

export type VolumeMeshReviewAction =
  | { type: 'reset-groups'; groups: ReviewGroup[] }
  | { type: 'mode'; mode: VolumeViewMode }
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
  | { type: 'focus-point'; position: [number, number, number] }
  | { type: 'clip-enabled'; enabled: boolean }
  | { type: 'clip-axis'; axis: 'x' | 'y' | 'z'; position: number }
  | { type: 'clip-position'; position: number }

export const initialVolumeMeshReviewState: VolumeMeshReviewState = {
  mode: 'overview',
  selection: { groupId: null },
  visibility: {},
  allFields: [],
  qualityFields: [],
  boundaryLayerFields: [],
  selectedField: null,
  range: null,
  histogram: null,
  extrema: null,
  probe: null,
  focusTarget: null,
  clipEnabled: false,
  clipAxis: 'x',
  clipPosition: 0,
}

export function reduceVolumeMeshReviewState(
  state: VolumeMeshReviewState,
  action: VolumeMeshReviewAction,
): VolumeMeshReviewState {
  switch (action.type) {
    case 'reset-groups':
      return {
        ...state,
        selection: action.groups.some((group) => group.id === state.selection.groupId)
          ? state.selection
          : { groupId: null },
        visibility: Object.fromEntries(action.groups.map((group) => [group.id, group.visible])),
        allFields: [],
        qualityFields: [],
        boundaryLayerFields: [],
        selectedField: null,
        range: null,
        histogram: null,
        extrema: null,
        probe: null,
        focusTarget: null,
      }
    case 'mode': {
      const allowedFields = action.mode === 'quality'
        ? state.qualityFields
        : action.mode === 'boundary-layer' ? state.boundaryLayerFields : []
      const selected = allowedFields.find((field) => field.name === state.selectedField) ?? null
      return {
        ...state,
        mode: action.mode,
        clipEnabled: action.mode === 'slices',
        selectedField: selected?.name ?? null,
        range: selected ? [selected.min, selected.max] : null,
        histogram: selected ? state.histogram : null,
        extrema: selected ? state.extrema : null,
        probe: selected ? state.probe : null,
      }
    }
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
      const fields = classifyVolumeMeshQualityFields(action.fields)
      const boundaryLayerFields = classifyBoundaryLayerEvidenceFields(action.fields)
      const selected = [...fields, ...boundaryLayerFields].find((field) => field.name === state.selectedField) ?? null
      return {
        ...state,
        allFields: action.fields,
        qualityFields: fields,
        boundaryLayerFields,
        selectedField: selected?.name ?? null,
        range: selected ? [selected.min, selected.max] : null,
        histogram: null,
        extrema: null,
        probe: null,
      }
    }
    case 'field': {
      const selected = [...state.qualityFields, ...state.boundaryLayerFields]
        .find((field) => field.name === action.fieldName) ?? null
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
    case 'focus-point':
      return { ...state, focusTarget: [...action.position] }
    case 'clip-enabled':
      return { ...state, clipEnabled: action.enabled }
    case 'clip-axis':
      return { ...state, clipAxis: action.axis, clipPosition: action.position }
    case 'clip-position':
      return { ...state, clipPosition: action.position }
  }
}

export function useVolumeMeshReview({
  groups,
  detail,
  previewSource,
  boundingBox,
}: {
  groups: ReviewGroup[]
  detail: ResourceDetail | null
  previewSource: 'primary' | 'fallback' | 'none'
  boundingBox?: BoundingBoxData | null
}) {
  const [state, dispatch] = useReducer(reduceVolumeMeshReviewState, initialVolumeMeshReviewState)
  const zones = useMemo(() => previewSource === 'fallback'
    ? groups.map((group) => ({ ...group, zoneType: 'unknown' as const, typeProvenance: 'unknown' as const }))
    : buildVolumeZoneInventory(groups, detail), [detail, groups, previewSource])
  const parameters = useMemo(() => volumeMeshParameterSummary(detail?.simulation_params), [detail?.simulation_params])
  const boundaryLayer = useMemo(() => buildBoundaryLayerReview({
    simulationParams: detail?.simulation_params,
    groups,
    fields: state.allFields,
  }), [detail?.simulation_params, groups, state.allFields])
  const refinements = useMemo(() => buildVolumeRefinementReview({
    simulationParams: detail?.simulation_params,
    groups,
    boundingBox,
  }), [boundingBox, detail?.simulation_params, groups])
  const capabilities = useMemo(() => volumeMeshCapabilities({
    detail,
    previewSource,
    groups,
    fields: state.allFields,
  }), [detail, groups, previewSource, state.allFields])
  const selectedZone = zones.find((zone) => zone.id === state.selection.groupId)
  const qualityFieldNames = state.qualityFields.map((field) => field.name)
  const boundaryLayerFieldNames = state.boundaryLayerFields.map((field) => field.name)
  const selectedFieldInfo = [...state.qualityFields, ...state.boundaryLayerFields]
    .find((field) => field.name === state.selectedField)
  const clipBounds = useMemo(() => axisBounds(boundingBox, state.clipAxis), [boundingBox, state.clipAxis])
  const clipPlane = useMemo<ViewerClipPlane | null>(() => {
    if (!state.clipEnabled || previewSource !== 'primary') return null
    const normal: [number, number, number] = state.clipAxis === 'x'
      ? [1, 0, 0]
      : state.clipAxis === 'y' ? [0, 1, 0] : [0, 0, 1]
    return { normal, constant: -state.clipPosition }
  }, [previewSource, state.clipAxis, state.clipEnabled, state.clipPosition])

  useEffect(() => {
    dispatch({ type: 'reset-groups', groups })
  }, [groups])

  const setMode = useCallback((mode: VolumeViewMode) => {
    dispatch({ type: 'mode', mode })
    if (mode === 'slices') {
      const bounds = axisBounds(boundingBox, state.clipAxis)
      dispatch({ type: 'clip-position', position: (bounds[0] + bounds[1]) / 2 })
    }
  }, [boundingBox, state.clipAxis])
  const setSelection = useCallback(
    (selection: { groupId: string | null }) => dispatch({ type: 'selection', groupId: selection.groupId }),
    [],
  )
  const isolateZone = useCallback((groupId: string) => {
    dispatch({ type: 'visibility', visibility: Object.fromEntries(zones.map((zone) => [zone.id, zone.id === groupId])) })
    dispatch({ type: 'selection', groupId })
  }, [zones])
  const showAllZones = useCallback(() => {
    dispatch({ type: 'visibility', visibility: Object.fromEntries(zones.map((zone) => [zone.id, true])) })
  }, [zones])
  const hideAllZones = useCallback(() => {
    dispatch({ type: 'visibility', visibility: Object.fromEntries(zones.map((zone) => [zone.id, false])) })
  }, [zones])
  const setClipAxis = useCallback((axis: 'x' | 'y' | 'z') => {
    const bounds = axisBounds(boundingBox, axis)
    dispatch({ type: 'clip-axis', axis, position: (bounds[0] + bounds[1]) / 2 })
  }, [boundingBox])

  return {
    ...state,
    zones,
    parameters,
    boundaryLayer,
    refinements,
    capabilities,
    selectedZone,
    qualityFieldNames,
    boundaryLayerFieldNames,
    selectedFieldInfo,
    clipBounds,
    clipPlane,
    setMode,
    setSelection,
    setVisibility: (visibility: Record<string, boolean>) => dispatch({ type: 'visibility', visibility }),
    toggleZoneVisibility: (groupId: string) => dispatch({ type: 'toggle-visibility', groupId }),
    isolateZone,
    showAllZones,
    hideAllZones,
    handleFieldsDiscovered: (fields: UVFFieldInfo[]) => dispatch({ type: 'fields', fields }),
    setSelectedField: (fieldName: string | null) => dispatch({ type: 'field', fieldName }),
    setRange: (range: [number, number] | null) => dispatch({ type: 'range', range }),
    setHistogram: (histogram: UVFFieldHistogram | null) => dispatch({ type: 'histogram', histogram }),
    setExtrema: (extrema: UVFFieldExtrema | null) => dispatch({ type: 'extrema', extrema }),
    setProbe: (probe: UVFFieldProbe | null) => dispatch({ type: 'probe', probe }),
    locateExtreme: (direction: 'min' | 'max') => dispatch({ type: 'locate-extreme', direction }),
    focusPoint: (position: [number, number, number]) => dispatch({ type: 'focus-point', position }),
    setClipEnabled: (enabled: boolean) => dispatch({ type: 'clip-enabled', enabled }),
    setClipAxis,
    setClipPosition: (position: number) => dispatch({ type: 'clip-position', position }),
  }
}

function axisBounds(boundingBox: BoundingBoxData | null | undefined, axis: 'x' | 'y' | 'z'): [number, number] {
  if (!boundingBox) return [-1, 1]
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const min = boundingBox.min[index]
  const max = boundingBox.max[index]
  return Number.isFinite(min) && Number.isFinite(max) && min < max ? [min, max] : [-1, 1]
}
