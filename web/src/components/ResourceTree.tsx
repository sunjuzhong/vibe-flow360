import { Activity, Box, Boxes, ChevronDown, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectItem, ResourceNode } from '../api/client'
import {
  RESOURCE_TYPES,
  buildDescendantCount,
  buildNodeIndex,
  collectAncestorIds,
  flattenTree,
  groupByType,
} from '../lib/tree'

export function ResourceIcon({ type, size = 15 }: { type: string; size?: number }) {
  if (type === 'Geometry') return <Box size={size} />
  if (type === 'SurfaceMesh') return <Boxes size={size} />
  if (type === 'VolumeMesh') return <Boxes size={size} />
  return <Activity size={size} />
}

type ViewMode = 'tree' | 'flat' | 'grouped'

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
  // Start collapsed except for the root — expanding everything by default
  // made 100+ Case projects unusable (AC-1). Selected node ancestors are
  // auto-expanded via the effect below to preserve deep-link correctness.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([root.id]))
  const [query, setQuery] = useState('')
  const [typesFilter, setTypesFilter] = useState<Set<string>>(new Set(RESOURCE_TYPES))
  const [viewMode, setViewMode] = useState<ViewMode>('tree')
  const lineRefs = useRef<Map<string, HTMLElement>>(new Map())
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const activeRowIdRef = useRef<string | null>(null)

  const nodeIndex = useMemo(() => buildNodeIndex(root), [root])
  const descendantCounts = useMemo(() => buildDescendantCount(root), [root])

  const setLineRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) lineRefs.current.set(id, el)
    else lineRefs.current.delete(id)
  }, [])

  // Auto-expand ancestors of the currently selected resource so deep-links
  // and browser back/forward keep the selection visible.
  useEffect(() => {
    const ancestors = collectAncestorIds(root, selected)
    if (ancestors.length === 0) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (const id of ancestors) next.add(id)
      next.add(root.id)
      return next
    })
  }, [root, selected])

  // Scroll the selected row into view on selection change (when the user is
  // not actively searching — search mode has its own result rendering).
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
      item.id.toLowerCase().includes(normalized),
    )
  }, [items, query])

  const typeFilterFn = useCallback((node: ResourceNode): boolean => {
    if (typesFilter.size === RESOURCE_TYPES.length) return true
    return typesFilter.has(node.type)
  }, [typesFilter])

  // When the user filters by resource type, auto-expand the ancestors of
  // every matching node so the filtered rows actually become reachable
  // via the tree walk. Without this, a filter-only tree view is empty
  // because `flattenTree` only recurses through nodes in `expanded`.
  const effectiveExpanded = useMemo(() => {
    if (typesFilter.size === RESOURCE_TYPES.length) return expanded
    const next = new Set(expanded)
    const walker = (node: ResourceNode, path: string[]): boolean => {
      const matches = typesFilter.has(node.type)
      let anyMatch = matches
      for (const child of node.children) {
        if (walker(child, [...path, node.id])) {
          next.add(node.id)
          anyMatch = true
        }
      }
      return anyMatch
    }
    walker(root, [])
    return next
  }, [expanded, root, typesFilter])

  const { rows } = useMemo(() => {
    if (viewMode !== 'tree') return { rows: [] as ReturnType<typeof flattenTree>['rows'] }
    return flattenTree(root, effectiveExpanded, typeFilterFn)
  }, [root, effectiveExpanded, typeFilterFn, viewMode])

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const visibleRowIds = useMemo(() => rows.map((r) => r.node.id), [rows])

  const focusRow = useCallback((id: string) => {
    activeRowIdRef.current = id
    const el = lineRefs.current.get(id)
    if (el) el.focus()
  }, [])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (viewMode !== 'tree') return
    const visible = visibleRowIds
    if (visible.length === 0) return
    const current = activeRowIdRef.current ?? selected
    const index = visible.indexOf(current)

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = visible[(index + 1) % visible.length]
      focusRow(next)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const prev = visible[(index - 1 + visible.length) % visible.length]
      focusRow(prev)
    } else if (event.key === 'ArrowRight' || event.key === 'Enter') {
      event.preventDefault()
      const node = nodeIndex.get(current)
      if (node && node.children.length && !expanded.has(current)) toggle(current)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      const node = nodeIndex.get(current)
      if (node && node.children.length && expanded.has(current)) toggle(current)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusRow(visible[0])
    } else if (event.key === 'End') {
      event.preventDefault()
      focusRow(visible[visible.length - 1])
    } else if (event.key === 'a' || event.key === 'A') {
      event.preventDefault()
      onSelect(nodeIndex.get(current) ?? root)
    }
  }, [viewMode, visibleRowIds, selected, nodeIndex, expanded, toggle, onSelect, root, focusRow])

  const toggleTypeFilter = (type: string) => {
    setTypesFilter((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        if (next.size === 1) return new Set(RESOURCE_TYPES)
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const grouped = useMemo(() => groupByType(items), [items])

  const renderFlatList = () => {
    const filtered = items.filter((it) =>
      (typesFilter.size === RESOURCE_TYPES.length || typesFilter.has(it.type))
      && (!query.trim() || matches.some((m) => m.id === it.id)),
    )
    if (!filtered.length) return <div className="resource-tree-empty">No matching resources</div>
    return filtered.map((item) => (
      <button
        key={item.id}
        ref={(el) => setLineRef(item.id, el)}
        className={`resource-search-result ${selected === item.id ? 'selected' : ''}`}
        onFocus={() => (activeRowIdRef.current = item.id)}
        onClick={() => onSelect(item)}
        role="treeitem"
        aria-selected={selected === item.id}
        tabIndex={selected === item.id ? 0 : -1}
      >
        <span className={`resource-type-icon type-${item.type.toLowerCase()}`}><ResourceIcon type={item.type} /></span>
        <span><strong>{item.name}</strong><small>{item.type} · {item.id}</small></span>
      </button>
    ))
  }

  const renderGroupedList = () => {
    const queryNorm = query.trim().toLowerCase()
    return (
      <>
        {RESOURCE_TYPES.filter((type) => typesFilter.has(type)).map((type) => {
          const list = (grouped[type] ?? []).filter((item) =>
            !queryNorm
            || item.name.toLowerCase().includes(queryNorm)
            || item.type.toLowerCase().includes(queryNorm)
            || item.id.toLowerCase().includes(queryNorm),
          )
          if (!list.length) return null
          return (
            <div key={type} className="resource-group" role="group" aria-label={`${type} resources`}>
              <div className="resource-group-title">
                <ResourceIcon type={type} />
                <strong>{type}</strong>
                <span>{list.length}</span>
              </div>
              {list.map((item) => (
                <button
                  key={item.id}
                  ref={(el) => setLineRef(item.id, el)}
                  className={`resource-search-result ${selected === item.id ? 'selected' : ''}`}
                  onFocus={() => (activeRowIdRef.current = item.id)}
                  onClick={() => onSelect(item)}
                  role="treeitem"
                  aria-selected={selected === item.id}
                  tabIndex={selected === item.id ? 0 : -1}
                >
                  <span><strong>{item.name}</strong><small>{item.id}</small></span>
                </button>
              ))}
            </div>
          )
        })}
      </>
    )
  }

  const renderTree = () => {
    if (query.trim()) {
      if (!matches.length) return <div className="resource-tree-empty">No matching resources</div>
      return matches.map((item) => (
        <button
          key={item.id}
          ref={(el) => setLineRef(item.id, el)}
          className={`resource-search-result ${selected === item.id ? 'selected' : ''}`}
          onFocus={() => (activeRowIdRef.current = item.id)}
          onClick={() => onSelect(item)}
          role="treeitem"
          aria-selected={selected === item.id}
          tabIndex={selected === item.id ? 0 : -1}
        >
          <span className={`resource-type-icon type-${item.type.toLowerCase()}`}><ResourceIcon type={item.type} /></span>
          <span><strong>{item.name}</strong><small>{item.type} · {item.id}</small></span>
        </button>
      ))
    }
    return rows.map(({ node, depth, hasChildren }) => {
      const isOpen = expanded.has(node.id)
      const isSelected = selected === node.id
      const count = descendantCounts.get(node.id) ?? 0
      return (
        <div
          key={node.id}
          ref={(el) => setLineRef(node.id, el)}
          className={`resource-tree-line ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          role="treeitem"
          aria-expanded={hasChildren ? isOpen : undefined}
          aria-selected={isSelected}
          aria-level={depth + 1}
          onFocus={() => (activeRowIdRef.current = node.id)}
          tabIndex={isSelected ? 0 : -1}
        >
          {hasChildren ? (
            <button
              className={`resource-expand ${isOpen ? 'expanded' : ''}`}
              onClick={() => toggle(node.id)}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}
              tabIndex={-1}
            >
              <ChevronDown size={12} />
            </button>
          ) : <span className="resource-expand-spacer" />}
          <button
            className="resource-select"
            onClick={() => onSelect(node)}
            title={node.name}
            tabIndex={-1}
          >
            <span className={`resource-type-icon type-${node.type.toLowerCase()}`}><ResourceIcon type={node.type} /></span>
            <span className="resource-name">
              <strong>{node.name}</strong>
              <small>{node.type}{count > 0 ? ` · ${count} descendants` : ''}</small>
            </span>
            {hasChildren && !isOpen && <span className="resource-child-count">{node.children.length}</span>}
          </button>
        </div>
      )
    })
  }

  const typeChips = RESOURCE_TYPES.map((type) => (
    <button
      key={type}
      className={`resource-type-chip ${typesFilter.has(type) ? 'active' : ''}`}
      onClick={() => toggleTypeFilter(type)}
      aria-pressed={typesFilter.has(type)}
      title={`Filter by ${type}`}
    >
      <ResourceIcon type={type} size={12} />
      <span>{type}</span>
    </button>
  ))

  return (
    <div className="resource-tree" ref={treeRef} onKeyDown={onKeyDown} role="tree" aria-label="Resources">
      <label className="resource-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter resources…"
          aria-label="Filter resources by name, type, or id"
        />
      </label>
      <div className="resource-tree-toolbar">
        <div className="resource-type-filters" role="group" aria-label="Resource type filters">
          {typeChips}
        </div>
        <div className="resource-view-mode" role="group" aria-label="Resource view mode">
          <button
            className={viewMode === 'tree' ? 'active' : ''}
            onClick={() => setViewMode('tree')}
            aria-pressed={viewMode === 'tree'}
            title="Hierarchical tree view"
          >Tree</button>
          <button
            className={viewMode === 'flat' ? 'active' : ''}
            onClick={() => setViewMode('flat')}
            aria-pressed={viewMode === 'flat'}
            title="Flat list of all resources"
          >Flat</button>
          <button
            className={viewMode === 'grouped' ? 'active' : ''}
            onClick={() => setViewMode('grouped')}
            aria-pressed={viewMode === 'grouped'}
            title="Group resources by type"
          >Grouped</button>
        </div>
      </div>
      <div ref={scrollContainerRef} className="resource-tree-scroll" role="group" aria-label="Resource list">
        {viewMode === 'tree' && renderTree()}
        {viewMode === 'flat' && renderFlatList()}
        {viewMode === 'grouped' && renderGroupedList()}
      </div>
      <div className="resource-tree-footer">{items.length} resources</div>
    </div>
  )
}
