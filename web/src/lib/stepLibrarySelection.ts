export const stepLibrarySelectedFolderStorageKey = 'vibesim.step-library.selected-folder'

export function readSTEPFolderSelection(storage?: Pick<Storage, 'getItem'>) {
  try {
    return storage?.getItem(stepLibrarySelectedFolderStorageKey)?.trim() || 'step-root'
  } catch {
    return 'step-root'
  }
}

export function writeSTEPFolderSelection(folderId: string, storage?: Pick<Storage, 'setItem'>) {
  try {
    storage?.setItem(stepLibrarySelectedFolderStorageKey, folderId)
  } catch {
    // Folder navigation remains usable when browser storage is unavailable.
  }
}
