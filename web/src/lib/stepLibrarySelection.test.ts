import { describe, expect, it } from 'vitest'
import { readSTEPFolderSelection, stepLibrarySelectedFolderStorageKey, writeSTEPFolderSelection } from './stepLibrarySelection'

describe('STEP library folder selection', () => {
  it('persists and restores the selected local folder', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    }
    expect(readSTEPFolderSelection(storage)).toBe('step-root')
    writeSTEPFolderSelection('stepfolder-designs', storage)
    expect(values.get(stepLibrarySelectedFolderStorageKey)).toBe('stepfolder-designs')
    expect(readSTEPFolderSelection(storage)).toBe('stepfolder-designs')
  })
})
