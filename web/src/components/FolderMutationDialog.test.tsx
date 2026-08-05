import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import FolderMutationDialog, { folderOptions } from './FolderMutationDialog'

const root = {
  id: 'ROOT.FLOW360',
  name: 'Workspace',
  subfolders: [{
    id: 'folder-a',
    name: 'A',
    subfolders: [{ id: 'folder-child', name: 'Child', subfolders: [] }],
  }, { id: 'folder-b', name: 'B', subfolders: [] }],
}

describe('folderOptions', () => {
  it('excludes a move target and its complete subtree', () => {
    expect(folderOptions(root, 'folder-a').map((option) => option.id)).toEqual([
      'ROOT.FLOW360',
      'folder-b',
    ])
  })
})

describe('FolderMutationDialog', () => {
  it('renders an explicit irreversible deletion boundary', () => {
    const markup = renderToStaticMarkup(
      <FolderMutationDialog
        mode="delete"
        folder={root.subfolders[0]}
        root={root}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('permanently deletes “A”')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Delete folder')
  })
})
