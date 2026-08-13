import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../../i18n'
import { createViewerClipPlane, ViewerClipButton, ViewerClipPopover, viewerClipBounds } from './ViewerClipTool'

describe('shared viewer clipping tool', () => {
  it('uses the selected manifest axis bounds and creates a clipping plane', () => {
    const bounds = { min: [-4, -2, 3], max: [8, 6, 9] } as {
      min: [number, number, number]
      max: [number, number, number]
    }
    expect(viewerClipBounds(bounds, 'y')).toEqual([-2, 6])
    expect(createViewerClipPlane(true, 'z', 5)).toEqual({ normal: [0, 0, 1], constant: -5 })
    expect(createViewerClipPlane(false, 'z', 5)).toBeNull()
  })

  it('renders localized, dismissible axis and position controls', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ViewerClipPopover
          axis="y"
          position={2}
          bounds={[-2, 6]}
          onAxisChange={() => undefined}
          onPositionChange={() => undefined}
          onClose={() => undefined}
        />
      </I18nProvider>,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-label="Inspection tools"')
    expect(html).toContain('aria-label="Close inspection tools"')
    expect(html).toContain('aria-label="Clipping plane position"')
    expect(html).toContain('min="-2"')
    expect(html).toContain('max="6"')
    expect(html).toContain('<option value="y" selected="">Y plane</option>')
  })

  it('renders the common toolbar action for every shared viewer', () => {
    const html = renderToStaticMarkup(
      <I18nProvider><ViewerClipButton enabled onToggle={() => undefined} /></I18nProvider>,
    )
    expect(html).toContain('aria-label="Toggle clipping plane"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('Clip')
  })
})
