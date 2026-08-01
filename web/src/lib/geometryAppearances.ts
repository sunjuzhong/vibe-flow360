export type GeometryAppearance = {
  id: string
  name: string
  color: string
  opacity: number
  builtin?: boolean
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const LIBRARY_KEY = 'vibe-flow360.geometry-appearances.v1'
const assignmentKey = (resourceId: string) => `vibe-flow360.geometry-appearance-assignments.v1:${resourceId}`

export const defaultGeometryAppearances: GeometryAppearance[] = [
  { id: 'default-cad', name: 'Default CAD', color: '#6f8790', opacity: 0.9, builtin: true },
  { id: 'transparent', name: 'Transparent enclosure', color: '#8fb8c8', opacity: 0.28, builtin: true },
  { id: 'rotating', name: 'Rotating zone', color: '#d59a2d', opacity: 0.78, builtin: true },
]

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
    const custom = (JSON.parse(raw) as unknown[])
      .filter(validAppearance)
      .map((item) => ({ ...item, builtin: false }))
    return [...defaultGeometryAppearances, ...custom.filter((item) =>
      !defaultGeometryAppearances.some((preset) => preset.id === item.id),
    )]
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
  storage.setItem(LIBRARY_KEY, JSON.stringify(appearances.filter((item) => !item.builtin)))
}

export function loadGeometryAppearanceAssignments(
  resourceId: string,
  storage: StorageLike = window.localStorage,
): Record<string, string> {
  try {
    const value = JSON.parse(storage.getItem(assignmentKey(resourceId)) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
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
) {
  const byId = new Map(appearances.map((appearance) => [appearance.id, appearance]))
  return Object.fromEntries(Object.entries(assignments).flatMap(([groupId, appearanceId]) => {
    const appearance = byId.get(appearanceId)
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
