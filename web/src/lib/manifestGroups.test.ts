import { describe, expect, it } from 'vitest'
import { meshGroupManifestHints, meshGroupMatchesKey, normalizeManifestHint } from './manifestGroups'

describe('manifest group hints', () => {
  const group = {
    id: 'face-17',
    name: 'Rendered face',
    color: '#aaa',
    visible: true,
    path: ['root_group', 'Wake Slice (Flat)'],
  }

  it('keeps parent containers together with leaf identity', () => {
    expect(meshGroupManifestHints(group)).toEqual([
      'root_group',
      'Wake Slice (Flat)',
      'face-17',
      'Rendered face',
    ])
    expect(meshGroupMatchesKey(group, 'wake-slice-flat')).toBe(true)
  })

  it('uses the same stable normalization as Case manifest categorization', () => {
    expect(normalizeManifestHint('Wake Slice (Flat)')).toBe('wakesliceflat')
  })
})
