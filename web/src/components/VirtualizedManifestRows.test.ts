import { describe, expect, it } from 'vitest'
import { virtualManifestRowWindow } from './VirtualizedManifestRows'

describe('virtualManifestRowWindow', () => {
  it('renders only the visible large-list window with overscan', () => {
    expect(virtualManifestRowWindow(7_000, 0, 720, 40)).toEqual({ start: 0, end: 36 })
    expect(virtualManifestRowWindow(7_000, 3_640, 720, 40)).toEqual({ start: 92, end: 128 })
  })

  it('clamps the final window to the item count', () => {
    expect(virtualManifestRowWindow(12, 5_000, 720, 0)).toEqual({ start: 12, end: 12 })
  })
})
