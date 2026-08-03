import { ChevronDown, Folder, FolderOpen, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FolderNode } from '../api/client'

function folderPath(nodes: FolderNode[], selectedId: string): string[] | null {
  for (const node of nodes) {
    if (node.id === selectedId) return [node.id]
    const childPath = folderPath(node.subfolders ?? [], selectedId)
    if (childPath) {
      return [node.id, ...childPath]
    }
  }
  return null
}

export function folderAncestorIds(nodes: FolderNode[], selectedId: string): string[] {
  return folderPath(nodes, selectedId)?.slice(0, -1) ?? []
}

function hasMatchingDescendant(node: FolderNode, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (node.name.toLowerCase().includes(q)) return true
  if (node.subfolders) {
    for (const child of node.subfolders) {
      if (hasMatchingDescendant(child, query)) return true
    }
  }
  return false
}

function Branch({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
  searchQuery,
}: {
  node: FolderNode
  depth: number
  selected: string
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (node: FolderNode) => void
  searchQuery: string
}) {
  const hasChildren = Boolean(node.subfolders?.length)
  const isExpanded = expanded.has(node.id)
  const matchesSearch = !searchQuery || node.name.toLowerCase().includes(searchQuery.toLowerCase())
  const childMatches = hasChildren && hasMatchingDescendant(node, searchQuery)

  if (searchQuery && !matchesSearch && !childMatches) return null

  return (
    <div className="folder-branch">
      <div className={`folder-line ${selected === node.id ? 'selected' : ''}`} style={{ paddingLeft: 5 + depth * 13 }}>
        {hasChildren ? (
          <button
            className={`folder-expand ${isExpanded || searchQuery ? 'expanded' : ''}`}
            onClick={() => onToggle(node.id)}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`}
          >
            <ChevronDown size={12} />
          </button>
        ) : <span className="folder-expand-spacer" />}
        <button className="folder-select" onClick={() => onSelect(node)} title={node.name}>
          {isExpanded || searchQuery ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{node.name}</span>
        </button>
      </div>
      {hasChildren && (isExpanded || searchQuery) && node.subfolders.map((child) => (
        <Branch
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  )
}

export default function FolderTree({
  folders,
  selected,
  onSelect,
}: {
  folders: FolderNode[]
  selected: string
  onSelect: (node: FolderNode) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!selected) return
    const ancestors = folderAncestorIds(folders, selected)
    if (!ancestors.length) return
    setExpanded((current) => {
      const next = new Set(current)
      let changed = false
      ancestors.forEach((id) => {
        if (next.has(id)) return
        next.add(id)
        changed = true
      })
      return changed ? next : current
    })
  }, [folders, selected])

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalFolders = useMemo(() => {
    let count = 0
    const walk = (nodes: FolderNode[]) => {
      count += nodes.length
      nodes.forEach((n) => walk(n.subfolders))
    }
    walk(folders)
    return count
  }, [folders])

  return (
    <div className="workspace-folder-tree">
      <div className="folder-search">
        <Search size={12} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search folders…"
        />
        {query && <button className="folder-search-clear" onClick={() => setQuery('')} aria-label="Clear search">×</button>}
      </div>
      <div className="folder-tree-count">{totalFolders} folders</div>
      {folders.map((folder) => (
        <Branch
          key={folder.id}
          node={folder}
          depth={0}
          selected={selected}
          expanded={expanded}
          onToggle={toggle}
          onSelect={onSelect}
          searchQuery={query}
        />
      ))}
      {query && <div className="folder-search-hint">Showing folders matching "{query}"</div>}
    </div>
  )
}
