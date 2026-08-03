import { describe, expect, it } from 'vitest'
import { folderAncestorIds } from './FolderTree'

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
})
