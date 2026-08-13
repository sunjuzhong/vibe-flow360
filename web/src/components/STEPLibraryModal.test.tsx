import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { api } from '../api/client'
import { I18nProvider } from '../i18n'
import STEPLibraryModal, { conciseSTEPError, resolveSTEPAssetSelection } from './STEPLibraryModal'

describe('STEPLibraryModal', () => {
  it('presents independent upload, AI design, validation, and direct project creation', () => {
    const markup = renderToStaticMarkup(<I18nProvider><STEPLibraryModal
      folder={{ id: 'folder-1', name: 'Designs', subfolders: [] }}
      onClose={() => undefined}
      onCreated={() => undefined}
    /></I18nProvider>)
    expect(markup).toContain('STEP library')
    expect(markup).toContain('Upload new asset')
    expect(markup).toContain('AI Design')
    expect(markup).toContain('downloading it later is optional')
    expect(markup).toContain('role="dialog"')
  })

  it('renders as an embedded management surface without a destination folder', () => {
    const markup = renderToStaticMarkup(<I18nProvider><STEPLibraryModal embedded /></I18nProvider>)
    expect(markup).toContain('step-library-embedded')
    expect(markup).toContain('step-library-page-surface')
    expect(markup).toContain('role="region"')
    expect(markup).not.toContain('role="dialog"')
    expect(markup).not.toContain('Add an existing STEP file')
    expect(markup).toContain('Upload new asset')
    expect(markup).not.toContain('Close STEP library')
  })

  it('reduces backend preview tracebacks to actionable validation evidence', () => {
    expect(conciseSTEPError('Traceback (most recent call last):\n  File "/tmp/preview.py", line 18\nValueError: STEP File could not be loaded')).toBe('ValueError: STEP File could not be loaded')
    expect(conciseSTEPError('preview process stopped')).toBe('preview process stopped')
  })

  it('requests the current shaded technical thumbnail style', () => {
    expect(api.stepVersionThumbnailURL('asset 1', 'version 1')).toBe('/api/step-assets/asset%201/versions/version%201/thumbnail.svg?style=v2')
  })

  it('keeps the routed asset authoritative over the current folder selection', () => {
    const assets = [
      { id: 'car', folder_id: 'test', name: 'car', versions: [], created_at: '', updated_at: '' },
      { id: 'wheel', folder_id: 'test', name: 'wheel', versions: [], created_at: '', updated_at: '' },
    ]
    expect(resolveSTEPAssetSelection('wheel', 'car', assets)).toBe('wheel')
    expect(resolveSTEPAssetSelection('missing-route', 'car', assets)).toBe('missing-route')
    expect(resolveSTEPAssetSelection('', 'car', assets)).toBe('car')
  })
})
