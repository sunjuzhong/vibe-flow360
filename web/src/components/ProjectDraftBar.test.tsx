import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { draftRecords } from './ProjectDraftBar'
import ProjectDraftBar from './ProjectDraftBar'

describe('ProjectDraftBar', () => {
  it('normalizes Flow360 Draft list envelopes', () => {
    expect(draftRecords({ drafts: [{ id: 'draft-1', name: 'Baseline' }] })).toHaveLength(1)
    expect(draftRecords({ records: [{ id: '', name: 'Invalid' }] })).toHaveLength(0)
    expect(draftRecords({ records: [{
      id: 'draft-2',
      name: 'Surface setup',
      source_item_id: 'sm-1',
      source_item_type: 'SurfaceMesh',
    }] })[0]).toMatchObject({ source_id: 'sm-1', source_type: 'SurfaceMesh' })
  })

  it('renders a read-only Resource mode Draft entry without editable parameters', () => {
    const markup = renderToStaticMarkup(
      <ProjectDraftBar
        mode="resource"
        drafts={[
          { id: 'draft-1', name: 'Geometry setup', source_id: 'geo-1' },
          { id: 'draft-2', name: 'Surface setup', source_id: 'sm-1' },
        ]}
        selectedId="draft-1"
        selectedDetail={null}
        loading={false}
        detailLoading={false}
        error=""
        onSelect={() => undefined}
        onEnter={() => undefined}
        onCreate={() => undefined}
        onInspect={() => undefined}
        onReview={() => undefined}
        onRefresh={() => undefined}
      />,
    )

    expect(markup).toContain('aria-label="Draft workspace"')
    expect(markup).toContain('Drafts 2')
    expect(markup).toContain('Open 2 Drafts in this Project')
    expect(markup).toContain('aria-label="About Project Drafts"')
    expect(markup).toContain('role="tooltip"')
    expect(markup).toContain('Drafts are editable configurations.')
    expect(markup).not.toContain('<small>Editable configurations in this Project</small>')
    expect(markup).not.toContain('Switch active Draft')
    expect(markup).not.toContain('Parameters')
  })

  it('renders an editable Draft mode with source context and parameter action', () => {
    const markup = renderToStaticMarkup(
      <ProjectDraftBar
        mode="draft"
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
        onEnter={() => undefined}
        onCreate={() => undefined}
        onInspect={() => undefined}
        onReview={() => undefined}
        onRefresh={() => undefined}
      />,
    )
    expect(markup).toContain('aria-label="Project drafts"')
    expect(markup).toContain('aria-label="Draft mode"')
    expect(markup).toContain('<strong>Draft</strong>')
    expect(markup).toContain('aria-label="About Draft mode"')
    expect(markup).toContain('Draft mode lets you edit parameters')
    expect(markup).not.toContain('Based on')
    expect(markup).not.toContain('Return to Resource mode')
    expect(markup).toContain('aria-label="Switch active Draft"')
    expect(markup).toContain('value="draft-2" selected=""')
    expect(markup).toContain('Parameters')
    expect(markup).toContain('Review &amp; Run')
    expect(markup).toContain('Validate, review, and run this Draft')
    expect(markup).toContain('aria-label="Refresh Drafts"')
    expect(markup).not.toContain('Active Draft')
    expect(markup).not.toContain('Draft menu')
  })
})
