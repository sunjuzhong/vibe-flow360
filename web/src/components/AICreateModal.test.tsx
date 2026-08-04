import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AICreateModal, { AICreateClarificationForm } from './AICreateModal'

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
    expect(markup).toContain('builds the goal over multiple steps')
    expect(markup).toContain('collect missing dimensions and operating decisions step by step')
    expect(markup).toContain('role="dialog"')
    expect(markup).not.toMatch(/[\u4e00-\u9fff]/)
  })

  it('requires a destination folder', () => {
    const markup = renderToStaticMarkup(<AICreateModal folder={null} onClose={() => undefined} onCreated={() => undefined} />)
    expect(markup).toContain('Select a destination folder first')
    expect(markup).toContain('disabled=""')
  })

  it('renders agent clarification fields as an engineering form', () => {
    const markup = renderToStaticMarkup(
      <AICreateClarificationForm
        round={2}
        busy={false}
        fields={[
          { id: 'diameter', label: 'Cylinder diameter', description: 'Reference diameter', type: 'number', required: true, unit: 'm', min: 0.001, max: 100 },
          { id: 'domain', label: 'Domain model', type: 'select', required: true, options: [{ value: 'periodic', label: 'Thin periodic' }, { value: 'finite', label: 'Finite span' }] },
          { id: 'wind_tunnel', label: 'Use a wind tunnel?', type: 'boolean', required: false },
          { id: 'objective', label: 'Study objective', type: 'text', required: true },
        ]}
        values={{ diameter: 1, domain: 'periodic', wind_tunnel: false, objective: 'Vortex shedding' }}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    expect(markup).toContain('Clarification round 2')
    expect(markup).toContain('Cylinder diameter')
    expect(markup).toContain('m</b>')
    expect(markup).toContain('Thin periodic')
    expect(markup).toContain('Use a wind tunnel?')
    expect(markup).toContain('Continue with answers')
  })
})
