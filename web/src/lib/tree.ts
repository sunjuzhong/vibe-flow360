import type { ProjectItem, ResourceNode } from '../api/client'

export type FlatRow = {
  node: ResourceNode
  depth: number
  hasChildren: boolean
  parentIds: string[]
}

/**
 * Flatten a resource tree into the sequence of rows that are currently
 * visible given the expanded set. Using an explicit `expanded` set rather
 * than recursively rendering keeps the tree O(visible-nodes) regardless of
 * total size, and lets us drive virtualization later without changing the
 * tree model.
 *
 * The `filter` argument controls which nodes are *emitted* as rows —
 * non-matching nodes are still traversed when their parent is expanded so
 * that descendants (which may match the filter) are not lost.
 */
export function flattenTree(
  root: ResourceNode,
  expanded: Set<string>,
  filter?: (node: ResourceNode) => boolean,
): { rows: FlatRow[]; visibleIds: Set<string> } {
  const rows: FlatRow[] = []
  const visibleIds = new Set<string>()

  const walk = (node: ResourceNode, depth: number, parentIds: string[]) => {
    if (!filter || filter(node)) {
      visibleIds.add(node.id)
      rows.push({ node, depth, hasChildren: Boolean(node.children?.length), parentIds })
    }
    const isOpen = expanded.has(node.id)
    if (isOpen) {
      for (const child of node.children) {
        walk(child, depth + 1, [...parentIds, node.id])
      }
    }
  }

  walk(root, 0, [])
  return { rows, visibleIds }
}

/**
 * Return the smallest set of ids that must be expanded to reveal the
 * node with `targetId` (used to auto-open ancestors during deep-link).
 */
export function collectAncestorIds(root: ResourceNode, targetId: string): string[] {
  const walk = (node: ResourceNode, path: string[]): string[] | null => {
    if (node.id === targetId) return path
    for (const child of node.children) {
      const found = walk(child, [...path, node.id])
      if (found) return found
    }
    return null
  }
  return walk(root, []) ?? []
}

/**
 * Build an id -> node map so `findNode` is O(1) instead of O(n) per lookup.
 */
export function buildNodeIndex(root: ResourceNode): Map<string, ResourceNode> {
  const map = new Map<string, ResourceNode>()
  const walk = (node: ResourceNode) => {
    map.set(node.id, node)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return map
}

/**
 * Build an id -> descendant-count map in a single post-order pass.
 */
export function buildDescendantCount(root: ResourceNode): Map<string, number> {
  const counts = new Map<string, number>()
  const walk = (node: ResourceNode): number => {
    let total = 0
    for (const child of node.children) total += 1 + walk(child)
    counts.set(node.id, total)
    return total
  }
  walk(root)
  return counts
}

/**
 * Build a flat list of items for the search/filter view, optionally
 * grouping by type.
 */
export function groupByType(items: ProjectItem[]): Record<string, ProjectItem[]> {
  const groups: Record<string, ProjectItem[]> = {}
  for (const item of items) {
    ;(groups[item.type] ??= []).push(item)
  }
  return groups
}

export const RESOURCE_TYPES = ['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case'] as const
export type ResourceType = (typeof RESOURCE_TYPES)[number]
