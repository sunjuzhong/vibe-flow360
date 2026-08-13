import { useCallback, useEffect, useMemo, useReducer } from 'react'
import type { ResourceDetail } from '../api/client'
import type { BoundingBoxData, MeshGroupData, ViewerClipPlane, ViewerSelection } from '../components/viewer/LazyViewer3D'
import type {
  UVFFieldExtrema,
  UVFFieldHistogram,
  UVFFieldInfo,
  UVFFieldProbe,
} from '../lib/uvf-three'
import {
  buildVolumeZoneInventory,
  buildBoundaryLayerReview,
  applyVolumeSliceVariantVisibility,
  buildVolumeSliceVariantReview,
  classifyBoundaryLayerEvidenceFields,
  classifyVolumeMeshQualityFields,
  volumeMeshCapabilities,
  volumeMeshParameterSummary,
  type VolumeViewMode,
  type VolumeSliceVariant,
} from '../lib/volumeMeshReview'
import { buildVolumeRefinementReview } from '../lib/volumeRefinementReview'

type ReviewGroup = MeshGroupData

export type VolumeMeshReviewState = {
  mode: VolumeViewMode
  selection: ViewerSelection
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
  sliceVariant: VolumeSliceVariant
}

export type VolumeMeshReviewAction =
  | { type: 'reset-groups'; groups: ReviewGroup[] }
  | { type: 'mode'; mode: VolumeViewMode }
  | { type: 'selection'; groupId: string | null; groupIds?: string[] }
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
  | { type: 'slice-variant'; variant: VolumeSliceVariant; groups: ReviewGroup[] }

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
  sliceVariant: 'flat',
}

export function isolatedVolumeZoneVisibility(
  zones: ReviewGroup[],
  groupIds: string[],
): Record<string, boolean> {
  const selectedIds = new Set(groupIds)
  const selectedZones = zones.filter((zone) => selectedIds.has(zone.id))
  return Object.fromEntries(zones.map((zone) => {
    const isSelected = selectedIds.has(zone.id)
    const isAncestorOfSelection = selectedZones.some((selected) => selected.path?.includes(zone.id))
    const isDescendantOfSelection = zone.path?.some((ancestorId) => selectedIds.has(ancestorId)) ?? false
    return [zone.id, isSelected || isAncestorOfSelection || isDescendantOfSelection]
  }))
}

export function reduceVolumeMeshReviewState(
  state: VolumeMeshReviewState,
  action: VolumeMeshReviewAction,
): VolumeMeshReviewState {
  switch (action.type) {
    case 'reset-groups': {
      const sliceVariants = buildVolumeSliceVariantReview(action.groups)
      const sliceVariant: VolumeSliceVariant = sliceVariants.hasFlat ? 'flat' : sliceVariants.hasCrinkled ? 'crinkled' : 'flat'
      const visibility = applyVolumeSliceVariantVisibility(
        Object.fromEntries(action.groups.map((group) => [group.id, group.visible])),
        sliceVariants,
        sliceVariant,
      )
      return {
        ...state,
        selection: (() => {
          const available = new Set(action.groups.map((group) => group.id))
          const groupIds = (state.selection.groupIds ?? []).filter((id) => available.has(id))
          const groupId = state.selection.groupId && available.has(state.selection.groupId)
            ? state.selection.groupId
            : groupIds[0] ?? null
          return { groupId, ...(groupIds.length > 1 ? { groupIds } : {}) }
        })(),
        visibility,
        allFields: [],
        qualityFields: [],
        boundaryLayerFields: [],
        selectedField: null,
        range: null,
        histogram: null,
        extrema: null,
        probe: null,
        focusTarget: null,
        sliceVariant,
      }
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
      return { ...state, selection: { groupId: action.groupId, ...(action.groupIds?.length ? { groupIds: action.groupIds } : {}) } }
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
        selection: { groupId: probe.entityId, groupIds: [probe.entityId] },
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
    case 'slice-variant': {
      const review = buildVolumeSliceVariantReview(action.groups)
      const available = action.variant === 'flat' ? review.hasFlat : review.hasCrinkled
      if (!available) return state
      const currentIds = state.selection.groupIds?.length
        ? state.selection.groupIds
        : state.selection.groupId ? [state.selection.groupId] : []
      const familyByGroupId = new Map<string, (typeof review.families)[number]>()
      for (const family of review.families) {
        for (const id of [...family.flatGroupIds, ...family.crinkledGroupIds]) familyByGroupId.set(id, family)
      }
      const addedFamilies = new Set<string>()
      const groupIds = currentIds.flatMap((id) => {
        const family = familyByGroupId.get(id)
        if (!family) return [id]
        if (addedFamilies.has(family.key)) return []
        addedFamilies.add(family.key)
        const preferred = action.variant === 'flat' ? family.flatGroupIds : family.crinkledGroupIds
        const fallback = action.variant === 'flat' ? family.crinkledGroupIds : family.flatGroupIds
        return preferred.length ? preferred : fallback
      })
      return {
        ...state,
        sliceVariant: action.variant,
        selection: { groupId: groupIds[0] ?? null, ...(groupIds.length ? { groupIds } : {}) },
        visibility: applyVolumeSliceVariantVisibility(state.visibility, review, action.variant),
      }
    }
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
  const sliceVariants = useMemo(() => buildVolumeSliceVariantReview(groups), [groups])
  const capabilities = useMemo(() => volumeMeshCapabilities({
    detail,
    previewSource,
    groups,
    fields: state.allFields,
  }), [detail, groups, previewSource, state.allFields])
  const selectedZone = zones.find((zone) => zone.id === state.selection.groupId)
  const selectedZoneIds = state.selection.groupIds?.length
    ? state.selection.groupIds
    : state.selection.groupId ? [state.selection.groupId] : []
  const selectedZones = selectedZoneIds.flatMap((id) => {
    const zone = zones.find((candidate) => candidate.id === id)
    return zone ? [zone] : []
  })
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
    (selection: ViewerSelection) => dispatch({ type: 'selection', groupId: selection.groupId, groupIds: selection.groupIds }),
    [],
  )
  const isolateZones = useCallback((groupIds: string[]) => {
    const available = new Set(zones.map((zone) => zone.id))
    const selectedIds = [...new Set(groupIds)].filter((groupId) => available.has(groupId))
    dispatch({ type: 'visibility', visibility: isolatedVolumeZoneVisibility(zones, selectedIds) })
    dispatch({ type: 'selection', groupId: selectedIds.at(-1) ?? null, groupIds: selectedIds })
  }, [zones])
  const showAllZones = useCallback(() => {
    dispatch({
      type: 'visibility',
      visibility: applyVolumeSliceVariantVisibility(
        Object.fromEntries(zones.map((zone) => [zone.id, true])),
        sliceVariants,
        state.sliceVariant,
      ),
    })
  }, [sliceVariants, state.sliceVariant, zones])
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
    sliceVariants,
    capabilities,
    selectedZone,
    selectedZones,
    qualityFieldNames,
    boundaryLayerFieldNames,
    selectedFieldInfo,
    clipBounds,
    clipPlane,
    setMode,
    setSelection,
    setVisibility: (visibility: Record<string, boolean>) => dispatch({ type: 'visibility', visibility }),
    toggleZoneVisibility: (groupId: string) => dispatch({ type: 'toggle-visibility', groupId }),
    isolateZone: (groupId: string) => isolateZones([groupId]),
    isolateZones,
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
    setSliceVariant: (variant: VolumeSliceVariant) => dispatch({ type: 'slice-variant', variant, groups }),
  }
}

function axisBounds(boundingBox: BoundingBoxData | null | undefined, axis: 'x' | 'y' | 'z'): [number, number] {
  if (!boundingBox) return [-1, 1]
  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const min = boundingBox.min[index]
  const max = boundingBox.max[index]
  return Number.isFinite(min) && Number.isFinite(max) && min < max ? [min, max] : [-1, 1]
}
