import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Flow360IdLink from './Flow360IdLink'

describe('Flow360IdLink', () => {
  it('renders resource IDs as external workbench links', () => {
    const html = renderToStaticMarkup(
      <Flow360IdLink environment="dev" projectId="project-1" resourceId="geometry-1" resourceType="Geometry" />,
    )

    expect(html).toContain('href="https://flow360.dev-simulation.cloud/workbench/project-1?id=geometry-1&amp;type=Geometry"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('>geometry-1</a>')
  })

  it('renders Project IDs with the Project workbench URL', () => {
    const html = renderToStaticMarkup(<Flow360IdLink environment="uat" projectId="project-1" />)
    expect(html).toContain('href="https://flow360.uat-simulation.cloud/workbench/project-1"')
    expect(html).toContain('>project-1</a>')
  })
})
