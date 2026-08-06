import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Viewer3D } from './Viewer3D'

describe('Viewer3D layout state', () => {
  it('marks the container as loading without rendering the controls gutter content', () => {
    const html = renderToStaticMarkup(
      <Viewer3D
        manifest={null}
        state={{ status: 'loading', message: 'Preparing 3D preview…' }}
        toolbar={<button type="button">Tools</button>}
      />,
    )

    expect(html).toContain('data-viewer-status="loading"')
    expect(html).toContain('Preparing 3D preview…')
    expect(html).not.toContain('viewer-controls-rail')
  })

  it('allows resource pages to suppress a duplicate manifest warning', () => {
    const manifest = {
      format: 'flow360-uvf',
      asset_url: '',
      bounding_box: { min: [0, 0, 0], max: [1, 1, 1] },
      groups: [],
      vertices: 0,
      elements: 0,
      warnings: ['Showing Geometry as spatial context.'],
    } satisfies import('./Viewer3D').ViewerManifest
    const visible = renderToStaticMarkup(
      <Viewer3D manifest={manifest} state={{ status: 'loading' }} />,
    )
    const suppressed = renderToStaticMarkup(
      <Viewer3D manifest={manifest} state={{ status: 'loading' }} showWarnings={false} />,
    )

    expect(visible).toContain('Showing Geometry as spatial context.')
    expect(suppressed).not.toContain('Showing Geometry as spatial context.')
  })
})
