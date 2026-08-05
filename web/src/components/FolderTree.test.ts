import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import FolderTree, { folderAncestorIds } from './FolderTree'

describe('folderAncestorIds', () => {
  const folders = [{
    id: 'root-child',
    name: 'Root child',
    subfolders: [{
      id: 'parent',
      name: 'Parent',
      subfolders: [{ id: 'selected', name: 'Selected', subfolders: [] }],
    }],
  }]

  it('returns every ancestor required to reveal a nested selection', () => {
    expect(folderAncestorIds(folders, 'selected')).toEqual(['root-child', 'parent'])
  })

  it('does not expand the selected folder itself or unrelated branches', () => {
    expect(folderAncestorIds(folders, 'root-child')).toEqual([])
    expect(folderAncestorIds(folders, 'missing')).toEqual([])
  })

  it('renders the workspace root as the first selectable tree node', () => {
    const root = { id: 'ROOT.FLOW360', name: 'My workspace', subfolders: folders }
    const markup = renderToStaticMarkup(createElement(FolderTree, {
      root,
      selected: '',
      onSelect: vi.fn(),
      onCreateRoot: vi.fn(),
      onCreateChild: vi.fn(),
      onRename: vi.fn(),
      onMove: vi.fn(),
      onDelete: vi.fn(),
    }))

    expect(markup).toContain('>My workspace<')
    expect(markup.indexOf('>My workspace<')).toBeLessThan(markup.indexOf('>Root child<'))
  })
})
