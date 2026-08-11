import type { MeshGroupData } from '../components/viewer/LazyViewer3D'

/**
 * Return every stable manifest hint for a renderable group. UVF business
 * semantics are often attached to a parent GeometryGroup, so consumers must
 * not inspect only the leaf face id/name.
 */
export function meshGroupManifestHints(group: MeshGroupData): string[] {
  return [...(group.path ?? []), group.id, group.name]
    .map((value) => value.trim())
    .filter(Boolean)
}

export function meshGroupMatchesKey(group: MeshGroupData, key: string): boolean {
  const normalized = normalizeManifestHint(key)
  return meshGroupManifestHints(group).some((hint) => normalizeManifestHint(hint) === normalized)
}

export function normalizeManifestHint(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll(/[^a-z0-9]/g, '')
}
