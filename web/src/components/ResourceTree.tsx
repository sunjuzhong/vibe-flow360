import { Activity, Box, Boxes, ChevronDown, ScanLine, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectItem, ResourceNode } from '../api/client'

export function ResourceIcon({ type, size = 15 }: { type: string; size?: number }) {
  if (type === 'Geometry') return <Box size={size} />
  if (type === 'SurfaceMesh') return <ScanLine size={size} />
  if (type === 'VolumeMesh') return <Boxes size={size} />
  return <Activity size={size} />
}

function findAncestors(node: ResourceNode, targetId: string, path: string[] = []): string[] | null {
  if (node.id === targetId) return path
  for (const child of node.children) {
    const result = findAncestors(child, targetId, [...path, node.id])
    if (result) return result
  }
  return null
}

function TreeBranch({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
  onRef,
}: {
  node: ResourceNode
  depth: number
  selected: string
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (node: ResourceNode) => void
  onRef: (id: string, el: HTMLDivElement | null) => void
}) {
  const hasChildren = Boolean(node.children?.length)
  const isExpanded = expanded.has(node.id)
  const lineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onRef(node.id, lineRef.current)
    return () => onRef(node.id, null)
  }, [node.id, onRef])

  const isSelected = selected === node.id

  return (
    <div>
      <div
        ref={lineRef}
        className={`resource-tree-line ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {hasChildren ? (
          <button
            className={`resource-expand ${isExpanded ? 'expanded' : ''}`}
            onClick={() => onToggle(node.id)}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
          >
            <ChevronDown size={12} />
          </button>
        ) : <span className="resource-expand-spacer" />}
        <button className="resource-select" onClick={() => onSelect(node)} title={node.name}>
          <span className={`resource-type-icon type-${node.type.toLowerCase()}`}><ResourceIcon type={node.type} /></span>
          <span className="resource-name"><strong>{node.name}</strong><small>{node.type}</small></span>
          {hasChildren && !isExpanded && <span className="resource-child-count">{node.children.length}</span>}
        </button>
      </div>
      {hasChildren && isExpanded && node.children.map((child) => (
        <TreeBranch
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          onRef={onRef}
        />
      ))}
    </div>
  )
}

export default function ResourceTree({
  root,
  items,
  selected,
  onSelect,
}: {
  root: ResourceNode
  items: ProjectItem[]
  selected: string
  onSelect: (node: ResourceNode | ProjectItem) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root.id]))
  const [query, setQuery] = useState('')
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const setLineRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) lineRefs.current.set(id, el)
    else lineRefs.current.delete(id)
  }, [])

  useEffect(() => {
    const ancestors = findAncestors(root, selected)
    if (ancestors) {
      setExpanded((prev) => {
        const next = new Set(prev)
        ancestors.forEach((id) => next.add(id))
        next.add(root.id)
        return next
      })
    }
  }, [root, selected])

  useEffect(() => {
    if (query.trim()) return
    const el = lineRefs.current.get(selected)
    if (el && scrollContainerRef.current) {
      const container = scrollContainerRef.current
      const elRect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      const offset = elRect.top - containerRect.top - container.clientHeight / 2 + el.clientHeight / 2
      container.scrollBy({ top: offset, behavior: 'smooth' })
    }
  }, [selected, query])

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return []
    return items.filter((item) =>
      item.name.toLowerCase().includes(normalized) ||
      item.type.toLowerCase().includes(normalized) ||
      item.id.toLowerCase().includes(normalized)
    ).slice(0, 100)
  }, [items, query])

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="resource-tree">
      <label className="resource-search">
        <Search size={14} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter resources…" />
      </label>
      <div ref={scrollContainerRef} className="resource-tree-scroll">
        {query.trim() ? (
          matches.length ? matches.map((item) => (
            <button
              key={item.id}
              className={`resource-search-result ${selected === item.id ? 'selected' : ''}`}
              onClick={() => onSelect(item)}
            >
              <span className={`resource-type-icon type-${item.type.toLowerCase()}`}><ResourceIcon type={item.type} /></span>
              <span><strong>{item.name}</strong><small>{item.type} · {item.id}</small></span>
            </button>
          )) : <div className="resource-tree-empty">No matching resources</div>
        ) : (
          <TreeBranch
            node={root}
            depth={0}
            selected={selected}
            expanded={expanded}
            onToggle={toggle}
            onSelect={onSelect}
            onRef={setLineRef}
          />
        )}
      </div>
      <div className="resource-tree-footer">{items.length} resources</div>
    </div>
  )
}

