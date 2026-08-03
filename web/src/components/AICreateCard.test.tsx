import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AICreateCard from './AICreateCard'

describe('AICreateCard', () => {
  it('presents natural-language project creation and the approval boundary', () => {
    const markup = renderToStaticMarkup(
      <AICreateCard
        folder={{ id: 'folder-1', name: 'Experiments', subfolders: [] }}
        onCreated={() => undefined}
      />,
    )
    expect(markup).toContain('AI CREATE')
    expect(markup).toContain('Describe the simulation you want')
    expect(markup).toContain('Destination · Experiments')
    expect(markup).toContain('Paid remote meshing and solving still require approval')
    expect(markup).toContain('圆柱扰流仿真')
  })

  it('requires a destination folder', () => {
    const markup = renderToStaticMarkup(<AICreateCard folder={null} onCreated={() => undefined} />)
    expect(markup).toContain('Select a destination folder first')
    expect(markup).toContain('disabled=""')
  })
})
