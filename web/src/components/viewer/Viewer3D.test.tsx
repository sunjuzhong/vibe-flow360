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
})
