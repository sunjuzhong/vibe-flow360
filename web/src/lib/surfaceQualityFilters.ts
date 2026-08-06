import type { UVFFieldFilter, UVFFieldFilterRule } from './uvf-three'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORAGE_PREFIX = 'vibesim:surface-quality-filter:v1:'
const MAX_RULES = 20

export const emptySurfaceQualityFilter: UVFFieldFilter = {
  enabled: false,
  operator: 'and',
  rules: [],
}

export function surfaceQualityFilterStorageKey(resourceId: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(resourceId)}`
}

export function loadSurfaceQualityFilter(
  resourceId: string,
  storage?: StorageLike,
): UVFFieldFilter {
  if (!resourceId) return { ...emptySurfaceQualityFilter, rules: [] }
  const target = storage ?? (typeof window === 'undefined' ? null : window.localStorage)
  if (!target) return { ...emptySurfaceQualityFilter, rules: [] }
  try {
    const value = JSON.parse(target.getItem(surfaceQualityFilterStorageKey(resourceId)) ?? 'null')
    return parseSurfaceQualityFilter(value) ?? { ...emptySurfaceQualityFilter, rules: [] }
  } catch {
    return { ...emptySurfaceQualityFilter, rules: [] }
  }
}

export function saveSurfaceQualityFilter(
  resourceId: string,
  filter: UVFFieldFilter,
  storage?: StorageLike,
): void {
  if (!resourceId) return
  const target = storage ?? (typeof window === 'undefined' ? null : window.localStorage)
  if (!target) return
  if (filter.rules.length === 0 && !filter.enabled) {
    target.removeItem(surfaceQualityFilterStorageKey(resourceId))
    return
  }
  target.setItem(surfaceQualityFilterStorageKey(resourceId), JSON.stringify(filter))
}

export function parseSurfaceQualityFilter(value: unknown): UVFFieldFilter | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<UVFFieldFilter>
  if (typeof candidate.enabled !== 'boolean') return null
  if (candidate.operator !== 'and' && candidate.operator !== 'or') return null
  if (!Array.isArray(candidate.rules) || candidate.rules.length > MAX_RULES) return null
  const rules: UVFFieldFilterRule[] = []
  for (const rule of candidate.rules) {
    if (!rule || typeof rule !== 'object') return null
    const item = rule as Partial<UVFFieldFilterRule>
    if (
      typeof item.id !== 'string'
      || typeof item.fieldName !== 'string'
      || !Number.isFinite(item.min)
      || !Number.isFinite(item.max)
    ) return null
    rules.push({
      id: item.id,
      fieldName: item.fieldName,
      min: Math.min(item.min as number, item.max as number),
      max: Math.max(item.min as number, item.max as number),
    })
  }
  return { enabled: candidate.enabled, operator: candidate.operator, rules }
}
