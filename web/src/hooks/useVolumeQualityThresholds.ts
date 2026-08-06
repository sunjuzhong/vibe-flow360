import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildVolumeQualityThresholds,
  type VolumeQualityThresholdOverride,
} from '../lib/volumeMeshReview'
import type { UVFFieldInfo } from '../lib/uvf-three'

const STORAGE_PREFIX = 'vibesim:volume-quality-thresholds:v1:'

type ThresholdState = {
  resourceId: string
  overrides: Record<string, VolumeQualityThresholdOverride>
}

function storageKey(resourceId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(resourceId)}`
}

function loadOverrides(resourceId: string): Record<string, VolumeQualityThresholdOverride> {
  if (!resourceId || typeof window === 'undefined') return {}
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(resourceId)) ?? 'null')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).flatMap(([fieldName, candidate]) => {
      if (!candidate || typeof candidate !== 'object') return []
      const item = candidate as Partial<VolumeQualityThresholdOverride>
      if (!Number.isFinite(item.warning) || !Number.isFinite(item.critical)) return []
      return [[fieldName, { warning: item.warning as number, critical: item.critical as number }]]
    }))
  } catch {
    return {}
  }
}

export function useVolumeQualityThresholds(resourceId: string, fields: UVFFieldInfo[]) {
  const [state, setState] = useState<ThresholdState>(() => ({
    resourceId,
    overrides: loadOverrides(resourceId),
  }))
  const activeOverrides = state.resourceId === resourceId ? state.overrides : {}
  const thresholds = useMemo(
    () => buildVolumeQualityThresholds(fields, activeOverrides),
    [activeOverrides, fields],
  )

  useEffect(() => {
    if (state.resourceId === resourceId) return
    setState({ resourceId, overrides: loadOverrides(resourceId) })
  }, [resourceId, state.resourceId])

  useEffect(() => {
    if (!resourceId || state.resourceId !== resourceId || typeof window === 'undefined') return
    if (Object.keys(state.overrides).length === 0) window.localStorage.removeItem(storageKey(resourceId))
    else window.localStorage.setItem(storageKey(resourceId), JSON.stringify(state.overrides))
  }, [resourceId, state])

  const updateThreshold = useCallback((
    fieldName: string,
    patch: Partial<VolumeQualityThresholdOverride>,
  ) => {
    const current = thresholds.find((threshold) => threshold.fieldName === fieldName)
    if (!current) return
    let warning = Number.isFinite(patch.warning) ? patch.warning as number : current.warning
    let critical = Number.isFinite(patch.critical) ? patch.critical as number : current.critical
    if (current.riskDirection === 'max') {
      if (patch.warning !== undefined) critical = Math.max(critical, warning)
      else warning = Math.min(warning, critical)
    } else if (patch.warning !== undefined) critical = Math.min(critical, warning)
    else warning = Math.max(warning, critical)
    setState((previous) => ({
      resourceId,
      overrides: {
        ...(previous.resourceId === resourceId ? previous.overrides : {}),
        [fieldName]: { warning, critical },
      },
    }))
  }, [resourceId, thresholds])

  const resetThreshold = useCallback((fieldName: string) => {
    setState((previous) => {
      const overrides = previous.resourceId === resourceId ? { ...previous.overrides } : {}
      delete overrides[fieldName]
      return { resourceId, overrides }
    })
  }, [resourceId])

  const resetAll = useCallback(() => setState({ resourceId, overrides: {} }), [resourceId])

  return { thresholds, updateThreshold, resetThreshold, resetAll }
}
