import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProjectContextBar from './ProjectContextBar'

describe('ProjectContextBar', () => {
  it('combines one resource identity, stages and inline Draft controls', () => {
    const markup = renderToStaticMarkup(
      <ProjectContextBar
        resourceName="Wing"
        resourceType="Geometry"
        resourceId="geo-1"
        environment="dev"
        projectId="project-1"
        status="Processed"
        stages={['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case']}
        selectedStage={0}
        resourceIcon={<svg aria-hidden="true" />}
        draftControls={<span>Draft controls</span>}
      />,
    )

    expect(markup.match(/<strong>Wing<\/strong>/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="Simulation stages"')
    expect(markup).toContain('Draft controls')
    expect(markup).toContain('flow360.dev-simulation.cloud/workbench/project-1?id=geo-1&amp;type=Geometry')
    expect(markup).not.toContain('aria-label="Open resource details"')
  })

  it('renders linked stages as buttons and missing stages as disabled', () => {
    const markup = renderToStaticMarkup(
      <ProjectContextBar
        resourceName="Case"
        resourceType="Case"
        resourceId="case-1"
        projectId="project-1"
        status="Submitted"
        stages={['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case']}
        selectedStage={3}
        stageLinks={[
          { stage: 'Geometry', resource: { id: 'geo-1', name: 'Geometry', type: 'Geometry', parent_id: null } },
          { stage: 'SurfaceMesh' },
          { stage: 'VolumeMesh', resource: { id: 'vm-1', name: 'Volume', type: 'VolumeMesh', parent_id: 'geo-1' } },
          { stage: 'Case', resource: { id: 'case-1', name: 'Case', type: 'Case', parent_id: 'vm-1' } },
        ]}
        onStageSelect={() => undefined}
        resourceIcon={<svg aria-hidden="true" />}
        draftControls={<span />}
      />,
    )

    expect(markup).toContain('<button type="button" class="before clickable"')
    expect(markup).toContain('aria-disabled="true"')
    expect(markup).toContain('Surface Mesh')
  })

  it('renders existing but unavailable stages as disabled instead of clickable buttons', () => {
    const markup = renderToStaticMarkup(
      <ProjectContextBar
        resourceName="Case"
        resourceType="Case"
        resourceId="case-1"
        projectId="project-1"
        status="Draft"
        stages={['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case']}
        selectedStage={0}
        stageLinks={[
          { stage: 'Geometry', resource: { id: 'geo-1', name: 'Geometry', type: 'Geometry', parent_id: null }, available: true },
          { stage: 'SurfaceMesh', resource: { id: 'sm-1', name: 'Surface', type: 'SurfaceMesh', parent_id: 'geo-1' }, available: false },
          { stage: 'VolumeMesh', resource: { id: 'vm-1', name: 'Volume', type: 'VolumeMesh', parent_id: 'sm-1' }, available: false },
          { stage: 'Case', resource: { id: 'case-1', name: 'Case', type: 'Case', parent_id: 'vm-1' }, available: false },
        ]}
        onStageSelect={() => undefined}
        resourceIcon={<svg aria-hidden="true" />}
        draftControls={<span />}
      />,
    )

    expect(markup).toContain('<button type="button" class="current clickable"')
    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(3)
  })
})
