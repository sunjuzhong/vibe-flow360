import { ChevronDown, Folder, FolderInput, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Search, Trash2 } from 'lucide-react'
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
  isRoot = false,
  selected,
  expanded,
  onToggle,
  onSelect,
  menuFor,
  onToggleMenu,
  onCreateChild,
  onRename,
  onMove,
  onDelete,
  searchQuery,
}: {
  node: FolderNode
  depth: number
  isRoot?: boolean
  selected: string
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (node: FolderNode) => void
  menuFor: string
  onToggleMenu: (id: string) => void
  onCreateChild: (node: FolderNode) => void
  onRename: (node: FolderNode) => void
  onMove: (node: FolderNode) => void
  onDelete: (node: FolderNode) => void
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
        <button className="folder-actions-button" onClick={() => onToggleMenu(node.id)} aria-label={`Manage ${node.name}`} aria-expanded={menuFor === node.id}>
          <MoreHorizontal size={14} />
        </button>
      </div>
      {menuFor === node.id && (
        <div className="folder-actions-menu" role="menu" aria-label={`Folder actions for ${node.name}`}>
          <button role="menuitem" onClick={() => onCreateChild(node)}><FolderPlus size={13} /> New subfolder</button>
          {!isRoot && <button role="menuitem" onClick={() => onRename(node)}><Pencil size={13} /> Rename</button>}
          {!isRoot && <button role="menuitem" onClick={() => onMove(node)}><FolderInput size={13} /> Move</button>}
          {!isRoot && <button role="menuitem" className="danger" onClick={() => onDelete(node)}><Trash2 size={13} /> Delete</button>}
        </div>
      )}
      {hasChildren && (isExpanded || searchQuery) && node.subfolders.map((child) => (
        <Branch
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
          menuFor={menuFor}
          onToggleMenu={onToggleMenu}
          onCreateChild={onCreateChild}
          onRename={onRename}
          onMove={onMove}
          onDelete={onDelete}
          searchQuery={searchQuery}
        />
      ))}
    </div>
  )
}

export default function FolderTree({
  root,
  selected,
  onSelect,
  onCreateRoot,
  onCreateChild,
  onRename,
  onMove,
  onDelete,
}: {
  root: FolderNode
  selected: string
  onSelect: (node: FolderNode) => void
  onCreateRoot: () => void
  onCreateChild: (node: FolderNode) => void
  onRename: (node: FolderNode) => void
  onMove: (node: FolderNode) => void
  onDelete: (node: FolderNode) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([root.id]))
  const [query, setQuery] = useState('')
  const [menuFor, setMenuFor] = useState('')

  const runAction = (action: (node: FolderNode) => void) => (node: FolderNode) => {
    setMenuFor('')
    action(node)
  }

  useEffect(() => {
    if (!selected) return
    const ancestors = folderAncestorIds([root], selected)
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
  }, [root, selected])

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
    walk(root.subfolders)
    return count
  }, [root])

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
      <div className="folder-tree-count">
        <span>{totalFolders} folders</span>
        <button onClick={onCreateRoot} aria-label="Create top-level folder"><FolderPlus size={12} /> New</button>
      </div>
      <Branch
        node={root}
        depth={0}
        isRoot
        selected={selected}
        expanded={expanded}
        onToggle={toggle}
        onSelect={onSelect}
        menuFor={menuFor}
        onToggleMenu={(id) => setMenuFor((current) => current === id ? '' : id)}
        onCreateChild={runAction(onCreateChild)}
        onRename={runAction(onRename)}
        onMove={runAction(onMove)}
        onDelete={runAction(onDelete)}
        searchQuery={query}
      />
      {query && <div className="folder-search-hint">Showing folders matching "{query}"</div>}
    </div>
  )
}
