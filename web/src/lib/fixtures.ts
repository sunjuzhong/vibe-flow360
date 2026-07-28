import type { ProjectItem, ResourceNode } from '../api/client'

const TYPES = ['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case'] as const
type ResourceType = (typeof TYPES)[number]

export type FixtureProject = {
  root: ResourceNode
  items: ProjectItem[]
}

function pad(n: number, width = 3) {
  return String(n).padStart(width, '0')
}

/**
 * Build a deterministic fixture for a Project with a given number of Cases.
 * Geometry and SurfaceMesh resources are shared parents and are created once
 * per group so that the tree stays realistic (Geometry -> SurfaceMesh ->
 * VolumeMesh -> Case). All ids are derived from the index so test assertions
 * stay stable between runs.
 */
export function buildLargeProjectFixture(options: {
  projectId?: string
  caseCount?: number
  groups?: number
} = {}): FixtureProject {
  const projectId = options.projectId ?? 'fixture-project'
  const caseCount = Math.max(1, Math.min(options.caseCount ?? 120, 500))
  const groups = Math.max(1, options.groups ?? Math.min(10, Math.ceil(caseCount / 12)))

  const items: ProjectItem[] = []
  const byId = new Map<string, ResourceNode>()

  const makeNode = (type: ResourceType, index: number, nameSuffix = ''): ResourceNode => {
    const id = `${type.toLowerCase()}-${pad(index)}`
    const name = `${type} ${pad(index)}${nameSuffix}`
    const node: ResourceNode = { id, name, type, children: [] }
    byId.set(id, node)
    items.push({ id, name, type, parent_id: null })
    return node
  }

  const root = makeNode('Geometry', 0)

  for (let g = 0; g < groups; g++) {
    const groupSuffix = ` #${g + 1}`
    const surfaceMesh = makeNode('SurfaceMesh', g, groupSuffix)
    surfaceMesh.children = []
    items[items.length - 1].parent_id = root.id
    root.children.push(surfaceMesh)

    const casesInGroup = Math.ceil(caseCount / groups)
    for (let c = 0; c < casesInGroup; c++) {
      const volumeMesh = makeNode('VolumeMesh', g * 100 + c, groupSuffix)
      volumeMesh.children = []
      items[items.length - 1].parent_id = surfaceMesh.id
      surfaceMesh.children.push(volumeMesh)

      const caseIndex = g * casesInGroup + c
      if (caseIndex >= caseCount) continue
      const caseNode = makeNode('Case', caseIndex, groupSuffix)
      caseNode.children = []
      items[items.length - 1].parent_id = volumeMesh.id
      volumeMesh.children.push(caseNode)
    }
  }

  // Update parent_id references now that children are wired.
  for (const node of walk(root)) {
    for (const child of node.children) {
      const idx = items.findIndex((it) => it.id === child.id)
      if (idx >= 0) items[idx] = { ...items[idx], parent_id: node.id }
    }
  }

  return { root, items }
}

export function* walk(node: ResourceNode): Generator<ResourceNode> {
  yield node
  for (const child of node.children) {
    yield* walk(child)
  }
}

export function countNodes(node: ResourceNode): number {
  let n = 0
  for (const _ of walk(node)) n++
  return n
}

export function findNodeInTree(node: ResourceNode, id: string): ResourceNode | null {
  if (node.id === id) return node
  for (const child of node.children) {
    const found = findNodeInTree(child, id)
    if (found) return found
  }
  return null
}
