import { describe, expect, it } from 'vitest'
import type { ResourceNode } from '../api/client'
import { buildLargeProjectFixture, countNodes, findNodeInTree } from './fixtures'
import {
  buildDescendantCount,
  buildNodeIndex,
  collectAncestorIds,
  flattenTree,
  groupByType,
} from './tree'

describe('buildLargeProjectFixture', () => {
  it('creates a Geometry root with the requested number of Cases', () => {
    const { root, items } = buildLargeProjectFixture({ caseCount: 60, groups: 5 })
    expect(root.type).toBe('Geometry')
    expect(items.filter((it) => it.type === 'Case').length).toBe(60)
    expect(countNodes(root)).toBe(items.length)
  })

  it('scales to 120+ cases deterministically', () => {
    const a = buildLargeProjectFixture({ caseCount: 120, groups: 6 })
    const b = buildLargeProjectFixture({ caseCount: 120, groups: 6 })
    expect(a.items.map((it) => it.id)).toEqual(b.items.map((it) => it.id))
    expect(a.items.filter((it) => it.type === 'Case').length).toBe(120)
  })
})

describe('flattenTree', () => {
  it('only renders the root when nothing is expanded', () => {
    const { root } = buildLargeProjectFixture({ caseCount: 20, groups: 4 })
    const { rows } = flattenTree(root, new Set())
    expect(rows.map((r) => r.node.id)).toEqual([root.id])
  })

  it('expands ancestors when the target node id is expanded', () => {
    const { root } = buildLargeProjectFixture({ caseCount: 20, groups: 4 })
    const target = findNodeInTree(root, 'case-000')!
    const ancestors = collectAncestorIds(root, target.id)
    const expanded = new Set<string>([root.id, ...ancestors])
    const { rows } = flattenTree(root, expanded)
    const ids = rows.map((r) => r.node.id)
    expect(ids).toContain(target.id)
    expect(ids).toContain(root.id)
  })

  it('filters by resource type', () => {
    const { root } = buildLargeProjectFixture({ caseCount: 30, groups: 3 })
    // When filtering by type we still need to traverse the ancestors of
    // the matching nodes, so pre-expand every node that lies on the
    // path to a Case.
    const expanded = new Set<string>([root.id])
    const walkForFilter = (node: ResourceNode): boolean => {
      const nodeMatches = node.type === 'Case'
      let anyMatch = nodeMatches
      for (const child of node.children) {
        if (walkForFilter(child)) {
          expanded.add(node.id)
          anyMatch = true
        }
      }
      return anyMatch
    }
    walkForFilter(root)
    const matches = (node: ResourceNode) => node.type === 'Case' || node.id === root.id
    const { rows } = flattenTree(root, expanded, matches)
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.every((r) => r.node.type === 'Case' || r.node.id === root.id)).toBe(true)
    expect(rows.some((r) => r.node.type === 'Case')).toBe(true)
  })
})

describe('buildNodeIndex', () => {
  it('makes lookups O(1) for large trees', () => {
    const { root } = buildLargeProjectFixture({ caseCount: 200, groups: 10 })
    const index = buildNodeIndex(root)
    expect(index.size).toBeGreaterThan(200)
    expect(index.get('case-042')?.type).toBe('Case')
    expect(index.get('geometry-000')?.type).toBe('Geometry')
  })
})

describe('buildDescendantCount', () => {
  it('counts descendants post-order', () => {
    const { root } = buildLargeProjectFixture({ caseCount: 12, groups: 3 })
    const counts = buildDescendantCount(root)
    const totalNodes = countNodes(root)
    // Root descendants = everything except root.
    expect(counts.get(root.id)).toBe(totalNodes - 1)
    // Each VolumeMesh in the fixture wraps exactly one Case, so it has
    // a descendant count of 1 (the Case itself).
    let vmCount = 0
    for (const [id, count] of counts.entries()) {
      if (id.startsWith('volumemesh-')) {
        expect(count).toBe(1)
        vmCount++
      }
    }
    expect(vmCount).toBeGreaterThan(0)
    // Root has at least one descendant (a non-empty tree invariant).
    expect(totalNodes - 1).toBeGreaterThan(0)
  })
})

describe('groupByType', () => {
  it('groups items by type', () => {
    const { items } = buildLargeProjectFixture({ caseCount: 15, groups: 5 })
    const groups = groupByType(items)
    expect(groups.Geometry?.length).toBe(1)
    expect(groups.Case?.length).toBe(15)
    expect(groups.SurfaceMesh?.length).toBe(5)
    // Each Case is wrapped by a dedicated VolumeMesh in the fixture,
    // so there are as many VolumeMesh items as Cases.
    expect(groups.VolumeMesh?.length).toBe(15)
  })
})

describe('collectAncestorIds', () => {
  it('returns the ids along the path from the root to the target', () => {
    const { root } = buildLargeProjectFixture({ caseCount: 20, groups: 4 })
    const target = findNodeInTree(root, 'case-005')!
    const ancestors = collectAncestorIds(root, target.id)
    expect(ancestors.length).toBe(3) // geometry -> surfacemesh -> volumemesh
    expect(ancestors[0]).toBe(root.id)
  })

  it('returns empty array when the target id is not found', () => {
    const { root } = buildLargeProjectFixture({ caseCount: 5 })
    expect(collectAncestorIds(root, 'missing')).toEqual([])
  })
})
