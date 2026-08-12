import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import STEPLibraryPage from './STEPLibraryPage'

describe('STEPLibraryPage', () => {
  it('exposes the independent library route and global navigation', () => {
    const markup = renderToStaticMarkup(<I18nProvider><MemoryRouter><STEPLibraryPage /></MemoryRouter></I18nProvider>)
    expect(markup).toContain('STEP geometry library')
    expect(markup).toContain('STEP library')
    expect(markup).toContain('href="/step-library"')
    expect(markup).toContain('href="/tutorials"')
    expect(markup).toContain('step-library-embedded')
    expect(markup).toContain('step-library-route')
    expect(markup).toContain('step-library-page-surface')
    expect(markup).toContain('role="region"')
    expect(markup).not.toContain('step-library-modal')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup).not.toContain('Close STEP library')
  })

  it('accepts a routed STEP asset detail path', () => {
    const markup = renderToStaticMarkup(<I18nProvider><MemoryRouter initialEntries={['/step-library/step-asset-1']}><STEPLibraryPage /></MemoryRouter></I18nProvider>)
    expect(markup).toContain('step-library-page-surface')
  })
})
