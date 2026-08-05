import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ProjectRecord } from '../api/client'
import ProjectMutationDialog from './ProjectMutationDialog'

const project: ProjectRecord = {
  id: 'prj-123',
  name: 'Aero baseline',
  root_item_type: 'Geometry',
  solver_version: 'release-26.1',
  statistics: {},
}

describe('ProjectMutationDialog', () => {
  it('prefills the current project name for rename', () => {
    const markup = renderToStaticMarkup(
      <ProjectMutationDialog mode="rename" project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    )

    expect(markup).toContain('Rename project')
    expect(markup).toContain('value="Aero baseline"')
    expect(markup).toContain('prj-123')
  })

  it('keeps permanent deletion disabled until explicitly confirmed', () => {
    const markup = renderToStaticMarkup(
      <ProjectMutationDialog mode="delete" project={project} onClose={vi.fn()} onComplete={vi.fn()} />,
    )

    expect(markup).toContain('permanently deletes “Aero baseline”')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('Delete project')
  })
})
