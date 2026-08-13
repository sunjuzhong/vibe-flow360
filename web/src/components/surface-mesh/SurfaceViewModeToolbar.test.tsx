import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SurfaceViewModeToolbar } from './SurfaceViewModeToolbar'

describe('SurfaceViewModeToolbar', () => {
  it('keeps mesh quality out of the viewer toolbar', () => {
    const markup = renderToStaticMarkup(
      <SurfaceViewModeToolbar mode="quality" onChange={vi.fn()} />,
    )

    expect(markup).toContain('Plain')
    expect(markup).toContain('Boundaries')
    expect(markup).not.toContain('Mesh Quality')
    expect(markup).toMatch(/aria-pressed="true"[^>]*>.*Boundaries/)
  })
})
