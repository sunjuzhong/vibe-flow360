import { AlertTriangle, Check, ChevronDown, FolderInput, FolderPlus, Loader2, Pencil, Search, Trash2, X } from 'lucide-react'
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { api, type FolderMutationResult, type FolderNode } from '../api/client'
import { useFocusTrap } from '../lib/useFocusTrap'

export type FolderMutationMode = 'create' | 'rename' | 'move' | 'delete'

export type FolderOption = {
  id: string
  name: string
  depth: number
  path: string
}

export function folderOptions(root: FolderNode, excludeSubtreeId = ''): FolderOption[] {
  const options: FolderOption[] = []
  const walk = (node: FolderNode, depth: number, parentPath: string) => {
    if (node.id === excludeSubtreeId) return
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name
    options.push({ id: node.id, name: node.name, depth, path })
    node.subfolders.forEach((child) => walk(child, depth + 1, path))
  }
  walk(root, 0, '')
  return options
}

export function filterFolderOptions(options: FolderOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return options
  return options.filter((option) => option.path.toLocaleLowerCase().includes(normalized))
}

function ParentFolderPicker({
  options,
  value,
  onChange,
}: {
  options: FolderOption[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selected = options.find((option) => option.id === value) ?? options[0]
  const filtered = useMemo(() => filterFolderOptions(options, query), [options, query])

  return (
    <div className="folder-parent-picker">
      <button
        type="button"
        className="folder-parent-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.path || 'Choose a parent folder'}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="folder-parent-popover">
          <div className="folder-parent-search">
            <Search size={13} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search parent folders…"
              aria-label="Search parent folders"
              autoFocus
            />
          </div>
          <div className="folder-parent-options" role="listbox" aria-label="Parent folder">
            {filtered.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected={option.id === value}
                key={option.id}
                onClick={() => {
                  onChange(option.id)
                  setOpen(false)
                  setQuery('')
                }}
                style={{ paddingLeft: 10 + option.depth * 14 }}
                title={option.path}
              >
                <span>{option.name}</span>
                {option.id === value && <Check size={13} />}
              </button>
            ))}
            {!filtered.length && <div className="folder-parent-empty">No matching folders</div>}
          </div>
        </div>
      )}
    </div>
  )
}

const modeCopy: Record<FolderMutationMode, {
  title: string
  description: string
  submit: string
}> = {
  create: {
    title: 'Create folder',
    description: 'Add a new Flow360 folder under the selected parent.',
    submit: 'Create folder',
  },
  rename: {
    title: 'Rename folder',
    description: 'Change the display name of this Flow360 folder.',
    submit: 'Save name',
  },
  move: {
    title: 'Move folder',
    description: 'Choose a new parent. A folder cannot be moved into itself or its descendants.',
    submit: 'Move folder',
  },
  delete: {
    title: 'Delete folder',
    description: 'Delete this Flow360 folder. Flow360 may reject folders that still contain projects or child folders.',
    submit: 'Delete folder',
  },
}

function ModeIcon({ mode }: { mode: FolderMutationMode }) {
  if (mode === 'create') return <FolderPlus size={19} />
  if (mode === 'rename') return <Pencil size={19} />
  if (mode === 'move') return <FolderInput size={19} />
  return <Trash2 size={19} />
}

export default function FolderMutationDialog({
  mode,
  folder,
  root,
  onClose,
  onComplete,
}: {
  mode: FolderMutationMode
  folder: FolderNode
  root: FolderNode
  onClose: () => void
  onComplete: (result: FolderMutationResult) => void | Promise<void>
}) {
  const titleId = useId()
  const [name, setName] = useState(mode === 'rename' ? folder.name : '')
  const [parentId, setParentId] = useState(mode === 'create' ? folder.id : root.id)
  const [tags, setTags] = useState('')
  const [deleteConfirmed, setDeleteConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose, 'button.folder-dialog-close')
  const copy = modeCopy[mode]
  const destinations = useMemo(
    () => folderOptions(root, mode === 'move' ? folder.id : ''),
    [folder.id, mode, root],
  )

  useEffect(() => {
    setName(mode === 'rename' ? folder.name : '')
    setParentId(mode === 'create' ? folder.id : root.id)
    setTags('')
    setDeleteConfirmed(false)
    setError('')
  }, [folder, mode, root.id])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      let result: FolderMutationResult
      if (mode === 'create') {
        result = await api.createFolder({
          name: name.trim(),
          parent_folder_id: parentId,
          tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        })
      } else if (mode === 'rename') {
        result = await api.renameFolder(folder.id, name.trim())
      } else if (mode === 'move') {
        result = await api.moveFolder(folder.id, parentId)
      } else {
        result = await api.deleteFolder(folder.id, deleteConfirmed)
      }
      await onComplete(result)
    } catch (cause) {
      setError(String(cause).replace('Error: ', ''))
    } finally {
      setBusy(false)
    }
  }

  const submitDisabled = busy ||
    ((mode === 'create' || mode === 'rename') && !name.trim()) ||
    (mode === 'move' && !parentId) ||
    (mode === 'delete' && !deleteConfirmed)

  return (
    <div className="folder-dialog-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <div ref={dialogRef} className={`folder-dialog mode-${mode}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <span><ModeIcon mode={mode} /></span>
          <div><small>FLOW360 FOLDER</small><h2 id={titleId}>{copy.title}</h2></div>
          <button type="button" className="folder-dialog-close icon-button" onClick={onClose} disabled={busy} aria-label="Close folder dialog">
            <X size={17} />
          </button>
        </header>
        <form onSubmit={submit}>
          <p>{copy.description}</p>
          <div className="folder-dialog-target"><small>Target</small><strong>{folder.name}</strong><code>{folder.id}</code></div>

          {(mode === 'create' || mode === 'rename') && (
            <label>
              Folder name
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={128} autoFocus placeholder="e.g. Baseline studies" />
            </label>
          )}

          {(mode === 'create' || mode === 'move') && (
            <div className="folder-dialog-field">
              <span>Parent folder</span>
              <ParentFolderPicker options={destinations} value={parentId} onChange={setParentId} />
            </div>
          )}

          {mode === 'create' && (
            <label>
              Tags <small>Optional, comma-separated</small>
              <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="e.g. aero, validation" />
            </label>
          )}

          {mode === 'delete' && (
            <label className="folder-delete-confirm">
              <input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} />
              <span><AlertTriangle size={16} /><strong>I understand this permanently deletes “{folder.name}”.</strong></span>
            </label>
          )}

          {error && <div className="folder-dialog-error"><AlertTriangle size={14} />{error}</div>}

          <footer>
            <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className={mode === 'delete' ? 'danger' : 'primary'} disabled={submitDisabled}>
              {busy ? <Loader2 size={15} className="spin" /> : <ModeIcon mode={mode} />}
              {busy ? 'Working…' : copy.submit}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
