import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { draftRecords } from './ProjectDraftBar'
import ProjectDraftBar from './ProjectDraftBar'

describe('ProjectDraftBar', () => {
  it('normalizes Flow360 Draft list envelopes', () => {
    expect(draftRecords({ drafts: [{ id: 'draft-1', name: 'Baseline' }] })).toHaveLength(1)
    expect(draftRecords({ records: [{ id: '', name: 'Invalid' }] })).toHaveLength(0)
  })

  it('renders a compound Draft menu with switch and secondary actions', () => {
    const markup = renderToStaticMarkup(
      <ProjectDraftBar
        drafts={[
          { id: 'draft-1', name: 'Baseline', status: 'draft' },
          { id: 'draft-2', name: 'High AoA', status: 'submitted' },
        ]}
        selectedId="draft-2"
        selectedDetail={{ id: 'draft-2', type: 'Draft', state: { status: 'submitted' } }}
        loading={false}
        detailLoading={false}
        error=""
        onSelect={() => undefined}
        onInspect={() => undefined}
        onRefresh={() => undefined}
      />,
    )
    expect(markup).toContain('aria-label="Project drafts"')
    expect(markup).toContain('aria-label="Open Draft menu, active Draft High AoA"')
    expect(markup).toContain('Draft · High AoA')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('hidden=""')
    expect(markup).toContain('aria-label="Switch active Draft"')
    expect(markup).toContain('value="draft-2" selected=""')
    expect(markup).toContain('Parameters')
    expect(markup).toContain('<span>Refresh Drafts</span>')
  })
})
