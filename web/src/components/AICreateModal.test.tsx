import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AICreateModal from './AICreateModal'

describe('AICreateModal', () => {
  it('presents natural-language project creation and the approval boundary', () => {
    const markup = renderToStaticMarkup(
      <AICreateModal
        folder={{ id: 'folder-1', name: 'Experiments', subfolders: [] }}
        onClose={() => undefined}
        onCreated={() => undefined}
      />,
    )
    expect(markup).toContain('AI CREATE')
    expect(markup).toContain('Describe the simulation you want')
    expect(markup).toContain('Destination · Experiments')
    expect(markup).toContain('Paid remote meshing and solving still require approval')
    expect(markup).toContain('cylinder flow simulation')
    expect(markup).toContain('role="dialog"')
    expect(markup).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('requires a destination folder', () => {
    const markup = renderToStaticMarkup(<AICreateModal folder={null} onClose={() => undefined} onCreated={() => undefined} />)
    expect(markup).toContain('Select a destination folder first')
    expect(markup).toContain('disabled=""')
  })
})
