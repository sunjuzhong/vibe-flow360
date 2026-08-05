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
        resourceUrl="https://example.com/geo-1"
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
    expect(markup).not.toContain('aria-label="Open resource details"')
  })
})
