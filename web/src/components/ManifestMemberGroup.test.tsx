import { renderToStaticMarkup } from 'react-dom/server'
import { Box } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import {
  ManifestMemberGroup,
  manifestVisibilityMap,
  visibleManifestMemberCount,
} from './ManifestMemberGroup'

const members = [
  { id: 'wall', visible: true },
  { id: 'farfield', visible: false },
  { id: 'symmetry' },
]

describe('ManifestMemberGroup', () => {
  it('shares complete visibility maps and respects manifest defaults', () => {
    expect(manifestVisibilityMap(members, false)).toEqual({
      wall: false,
      farfield: false,
      symmetry: false,
    })
    expect(visibleManifestMemberCount(members, {})).toBe(2)
    expect(visibleManifestMemberCount(members, { farfield: true, symmetry: false })).toBe(2)
  })

  it('renders a consistent one-row header with one contextual visibility action', () => {
    const markup = renderToStaticMarkup(
      <ManifestMemberGroup
        label="Geometry bodies"
        memberLabel="surfaces"
        icon={<Box size={13} />}
        total={3}
        visibleCount={2}
        onHideAll={vi.fn()}
        onShowAll={vi.fn()}
      >
        <div>members stay mounted</div>
      </ManifestMemberGroup>,
    )

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-label="Collapse Geometry bodies"')
    expect(markup).toContain('title="2/3 visible"')
    expect(markup).toContain('>2/3</span>')
    expect(markup).toContain('aria-label="Hide all surfaces"')
    expect(markup).not.toContain('aria-label="Show all surfaces"')
    expect(markup).toContain('members stay mounted')
  })

  it('disables empty groups and changes the action when every member is hidden', () => {
    const emptyMarkup = renderToStaticMarkup(
      <ManifestMemberGroup
        label="CAD edges"
        memberLabel="edges"
        icon={<Box size={13} />}
        total={0}
        visibleCount={0}
        onHideAll={vi.fn()}
        onShowAll={vi.fn()}
      >
        <p>No edges</p>
      </ManifestMemberGroup>,
    )
    expect(emptyMarkup.match(/disabled=""/g)).toHaveLength(1)

    const hiddenMarkup = renderToStaticMarkup(
      <ManifestMemberGroup
        label="Case surfaces"
        memberLabel="surfaces"
        icon={<Box size={13} />}
        total={2}
        visibleCount={0}
        onHideAll={vi.fn()}
        onShowAll={vi.fn()}
      >
        <p>Hidden surfaces</p>
      </ManifestMemberGroup>,
    )
    expect(hiddenMarkup).toContain('aria-label="Show all surfaces"')
    expect(hiddenMarkup).not.toContain('aria-label="Hide all surfaces"')
    expect(hiddenMarkup).not.toMatch(/aria-label="Show all surfaces"[^>]*disabled=""/)
  })
})
