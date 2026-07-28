import { ChevronDown, Folder, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import type { FolderNode } from '../api/client'

function Branch({
  node,
  depth,
  selected,
  expanded,
  onToggle,
  onSelect,
}: {
  node: FolderNode
  depth: number
  selected: string
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (node: FolderNode) => void
}) {
  const hasChildren = Boolean(node.subfolders?.length)
  const isExpanded = expanded.has(node.id)

  return (
    <div className="folder-branch">
      <div className={`folder-line ${selected === node.id ? 'selected' : ''}`} style={{ paddingLeft: 5 + depth * 13 }}>
        {hasChildren ? (
          <button
            className={`folder-expand ${isExpanded ? 'expanded' : ''}`}
            onClick={() => onToggle(node.id)}
            aria-label={`${isExpanded ? '收起' : '展开'} ${node.name}`}
          >
            <ChevronDown size={12} />
          </button>
        ) : <span className="folder-expand-spacer" />}
        <button className="folder-select" onClick={() => onSelect(node)} title={node.name}>
          {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
          <span>{node.name}</span>
        </button>
      </div>
      {hasChildren && isExpanded && node.subfolders.map((child) => (
        <Branch
          key={child.id}
          node={child}
          depth={depth + 1}
          selected={selected}
          expanded={expanded}
          onToggle={onToggle}
          onSelect={onSelect}
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

  const toggle = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="workspace-folder-tree">
      {folders.map((folder) => (
        <Branch
          key={folder.id}
          node={folder}
          depth={0}
          selected={selected}
          expanded={expanded}
          onToggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

