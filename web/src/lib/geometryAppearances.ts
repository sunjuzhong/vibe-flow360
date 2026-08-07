export type GeometryAppearance = {
  id: string
  name: string
  color: string
  opacity: number
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const LIBRARY_KEY = 'vibe-flow360.geometry-appearances.v1'
const assignmentKey = (resourceId: string) => `vibe-flow360.geometry-appearance-assignments.v1:${resourceId}`

export const generalGeometryAppearancePresets: GeometryAppearance[] = [
  { id: 'default-cad', name: 'Default CAD', color: '#6f8790', opacity: 0.9 },
]

export const cfdGeometryAppearancePresets: GeometryAppearance[] = [
  { id: 'cfd-wall', name: 'Wall', color: '#68737d', opacity: 0.95 },
  { id: 'cfd-farfield', name: 'Farfield / Freestream', color: '#4da3c7', opacity: 0.22 },
  { id: 'cfd-inflow', name: 'Inflow', color: '#2563eb', opacity: 0.72 },
  { id: 'cfd-outflow', name: 'Outflow', color: '#e07a2d', opacity: 0.72 },
  { id: 'cfd-periodic', name: 'Periodic', color: '#8b5cf6', opacity: 0.65 },
  { id: 'cfd-symmetry', name: 'Symmetry', color: '#14b8a6', opacity: 0.35 },
  { id: 'cfd-slip-wall', name: 'Slip wall', color: '#38bdf8', opacity: 0.42 },
  { id: 'cfd-porous-jump', name: 'Porous jump', color: '#c05a9d', opacity: 0.68 },
]

export const defaultGeometryAppearances: GeometryAppearance[] = [
  ...generalGeometryAppearancePresets,
  ...cfdGeometryAppearancePresets,
]

const cfdPresetIds = new Set(cfdGeometryAppearancePresets.map(({ id }) => id))
const presetIds = new Set(defaultGeometryAppearances.map(({ id }) => id))
const retiredPresetIds = new Set(['transparent', 'rotating'])

export function isCfdGeometryAppearancePreset(id: string): boolean {
  return cfdPresetIds.has(id)
}

export function isGeometryAppearancePreset(id: string): boolean {
  return presetIds.has(id)
}

export function canDeleteGeometryAppearance(id: string, librarySize: number): boolean {
  return librarySize > 1 && !isGeometryAppearancePreset(id)
}

export function geometryAppearancePresetForBoundary(boundaryType: string): string | null {
  const normalized = boundaryType.replace(/[^a-z0-9]/gi, '').toLowerCase()
  if (!normalized) return null
  if (normalized.includes('porous') || normalized.includes('jump')) return 'cfd-porous-jump'
  if (normalized.includes('periodic')) return 'cfd-periodic'
  if (normalized.includes('symmetry')) return 'cfd-symmetry'
  if (normalized.includes('slip')) return 'cfd-slip-wall'
  if (normalized.includes('freestream') || normalized.includes('farfield')) return 'cfd-farfield'
  if (normalized.includes('inflow') || normalized.includes('inlet')) return 'cfd-inflow'
  if (normalized.includes('outflow') || normalized.includes('outlet')) return 'cfd-outflow'
  if (normalized.includes('wall') || normalized === 'ground') return 'cfd-wall'
  return null
}

export function resolveGeometryAppearanceAssignments(
  parameterAssignments: Record<string, string>,
  semanticDraftAssignments: Record<string, string>,
  manualOverrides: Record<string, string>,
): Record<string, string> {
  return { ...semanticDraftAssignments, ...parameterAssignments, ...manualOverrides }
}

export function clearGeometryAppearanceOverrides(
  overrides: Record<string, string>,
  groupIds: string[],
): Record<string, string> {
  const cleared = { ...overrides }
  for (const groupId of groupIds) delete cleared[groupId]
  return cleared
}

function validAppearance(value: unknown): value is GeometryAppearance {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<GeometryAppearance>
  return typeof item.id === 'string' && typeof item.name === 'string' &&
    /^#[0-9a-f]{6}$/i.test(item.color ?? '') && typeof item.opacity === 'number' &&
    item.opacity >= 0.05 && item.opacity <= 1
}

export function parseGeometryAppearanceLibrary(raw: string | null): GeometryAppearance[] {
  if (!raw) return defaultGeometryAppearances
  try {
    const parsed = JSON.parse(raw) as unknown
    let stored: GeometryAppearance[] = []
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const versioned = parsed as { version?: number; items?: unknown[] }
      if (versioned.version === 3 && Array.isArray(versioned.items)) {
        stored = versioned.items.filter(validAppearance)
      }
      if (versioned.version === 2 && Array.isArray(versioned.items)) {
        stored = versioned.items.filter(validAppearance)
      }
    }
    const legacy = Array.isArray(parsed) ? parsed.filter(validAppearance) : stored
    const seeded = defaultGeometryAppearances.map((preset) => {
      const override = legacy.find((item) => item.id === preset.id)
      return override ? { ...preset, ...override } : preset
    })
    const custom = legacy.filter((item) =>
      !isGeometryAppearancePreset(item.id) && !retiredPresetIds.has(item.id),
    )
    return [...seeded, ...custom]
  } catch {
    return defaultGeometryAppearances
  }
}

export function loadGeometryAppearanceLibrary(storage: StorageLike = window.localStorage) {
  return parseGeometryAppearanceLibrary(storage.getItem(LIBRARY_KEY))
}

export function saveGeometryAppearanceLibrary(
  appearances: GeometryAppearance[],
  storage: StorageLike = window.localStorage,
) {
  storage.setItem(LIBRARY_KEY, JSON.stringify({ version: 3, items: appearances }))
}

export function loadGeometryAppearanceAssignments(
  resourceId: string,
  storage: StorageLike = window.localStorage,
): Record<string, string> {
  try {
    const value = JSON.parse(storage.getItem(assignmentKey(resourceId)) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).flatMap(([groupId, appearanceId]) =>
      typeof appearanceId === 'string' && !retiredPresetIds.has(appearanceId)
        ? [[groupId, appearanceId] as const]
        : [],
    ))
  } catch {
    return {}
  }
}

export function saveGeometryAppearanceAssignments(
  resourceId: string,
  assignments: Record<string, string>,
  storage: StorageLike = window.localStorage,
) {
  storage.setItem(assignmentKey(resourceId), JSON.stringify(assignments))
}

export function buildGeometryEntityAppearances(
  assignments: Record<string, string>,
  appearances: GeometryAppearance[],
  groupIds: string[] = [],
  defaultAppearanceId = 'default-cad',
) {
  const byId = new Map(appearances.map((appearance) => [appearance.id, appearance]))
  const resolvedAssignments = {
    ...Object.fromEntries(groupIds.map((groupId) => [groupId, defaultAppearanceId])),
    ...assignments,
  }
  const fallback = byId.get(defaultAppearanceId)
  return Object.fromEntries(Object.entries(resolvedAssignments).flatMap(([groupId, appearanceId]) => {
    const appearance = byId.get(appearanceId) ?? fallback
    return appearance ? [[groupId, { color: appearance.color, opacity: appearance.opacity }]] : []
  }))
}

export function newGeometryAppearance(
  name: string,
  color: string,
  opacity: number,
  id = `appearance-${Date.now().toString(36)}`,
): GeometryAppearance {
  return { id, name: name.trim() || 'Untitled appearance', color, opacity }
}
