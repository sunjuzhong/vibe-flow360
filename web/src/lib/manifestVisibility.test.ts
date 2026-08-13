import { describe, expect, it } from 'vitest'
import { isolatedManifestVisibility } from './manifestVisibility'

describe('isolatedManifestVisibility', () => {
  const items = [
    { id: 'root' },
    { id: 'body', path: ['root'] },
    { id: 'face-a', path: ['root', 'body'] },
    { id: 'face-b', path: ['root', 'body'] },
    { id: 'face-c', path: ['root', 'body'] },
    { id: 'slice', path: ['root'] },
  ]

  it('keeps all selected leaves and their ancestors visible', () => {
    expect(isolatedManifestVisibility(items, ['face-a', 'face-b', 'face-c'])).toEqual({
      root: true,
      body: true,
      'face-a': true,
      'face-b': true,
      'face-c': true,
      slice: false,
    })
  })

  it('keeps descendants visible when isolating a parent', () => {
    expect(isolatedManifestVisibility(items, ['body'])).toEqual({
      root: true,
      body: true,
      'face-a': true,
      'face-b': true,
      'face-c': true,
      slice: false,
    })
  })

  it('ignores stale selected ids', () => {
    expect(isolatedManifestVisibility(items, ['missing'])).toEqual(
      Object.fromEntries(items.map((item) => [item.id, false])),
    )
  })
})
