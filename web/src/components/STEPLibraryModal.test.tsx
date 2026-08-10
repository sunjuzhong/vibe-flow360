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
})
