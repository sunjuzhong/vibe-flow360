import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import STEPLibraryModal from './STEPLibraryModal'

describe('STEPLibraryModal', () => {
  it('presents independent upload, AI design, validation, and direct project creation', () => {
    const markup = renderToStaticMarkup(<STEPLibraryModal
      folder={{ id: 'folder-1', name: 'Designs', subfolders: [] }}
      onClose={() => undefined}
      onCreated={() => undefined}
    />)
    expect(markup).toContain('STEP library')
    expect(markup).toContain('Upload new asset')
    expect(markup).toContain('AI new design')
    expect(markup).toContain('downloading it later is optional')
    expect(markup).toContain('role="dialog"')
  })

  it('renders as an embedded management surface without a destination folder', () => {
    const markup = renderToStaticMarkup(<STEPLibraryModal embedded />)
    expect(markup).toContain('step-library-embedded')
    expect(markup).toContain('step-library-page-surface')
    expect(markup).toContain('role="region"')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).toContain('Upload new asset')
    expect(markup).not.toContain('Close STEP library')
  })
})
