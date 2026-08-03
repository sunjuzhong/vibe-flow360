import { describe, expect, it } from 'vitest'
import {
  findFolderById,
  formatProjectCreatedAt,
  readWorkspaceSelectedFolder,
  workspaceSelectedFolderStorageKey,
  writeWorkspaceSelectedFolder,
} from './WorkspacePage'

describe('formatProjectCreatedAt', () => {
  it('formats a Flow360 creation timestamp for display', () => {
    const formatted = formatProjectCreatedAt('2026-08-03T12:52:09.687572841Z')

    expect(formatted).toContain('2026')
    expect(formatted).not.toBe('—')
  })

  it('uses a stable placeholder when creation time is unavailable', () => {
    expect(formatProjectCreatedAt()).toBe('—')
    expect(formatProjectCreatedAt('not-a-date')).toBe('—')
  })
})

describe('workspace folder selection', () => {
  const folders = [{
    id: 'parent',
    name: 'Parent',
    subfolders: [{ id: 'selected', name: 'Selected', subfolders: [] }],
  }]

  it('resolves a persisted nested folder against the latest tree', () => {
    expect(findFolderById(folders, 'selected')?.name).toBe('Selected')
    expect(findFolderById(folders, 'removed')).toBeNull()
  })

  it('stores only the selected folder id for the current session', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }

    writeWorkspaceSelectedFolder(storage, 'selected')

    expect(values.get(workspaceSelectedFolderStorageKey)).toBe('selected')
    expect(readWorkspaceSelectedFolder(storage)).toBe('selected')
  })

  it('ignores unavailable session storage', () => {
    const unavailable = {
      getItem: () => { throw new Error('unavailable') },
      setItem: () => { throw new Error('unavailable') },
    }

    expect(() => writeWorkspaceSelectedFolder(unavailable, 'selected')).not.toThrow()
    expect(readWorkspaceSelectedFolder(unavailable)).toBe('')
  })
})
