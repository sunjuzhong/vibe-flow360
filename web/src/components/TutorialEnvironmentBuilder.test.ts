import { describe, expect, it } from 'vitest'
import { preferredTutorialFolder, tutorialFolderOptions } from './TutorialEnvironmentBuilder'

describe('tutorial environment folder selection', () => {
  it('flattens nested workspace folders with readable paths', () => {
    expect(tutorialFolderOptions({
      id: 'root',
      name: 'Workspace',
      subfolders: [{
        id: 'tutorials',
        name: 'Tutorials',
        subfolders: [{ id: 'aero', name: 'Aerodynamics', subfolders: [] }],
      }],
    })).toEqual([
      { id: 'tutorials', label: 'Tutorials' },
      { id: 'aero', label: 'Tutorials / Aerodynamics' },
    ])
  })

  it('prefers the dedicated tutorials folder over an unrelated first folder', () => {
    expect(preferredTutorialFolder([
      { id: 'personal', label: 'Personal' },
      { id: 'tutorials', label: 'tutorials' },
    ])).toBe('tutorials')
  })
})
