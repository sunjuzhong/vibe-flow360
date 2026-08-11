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
    expect(markup).not.toContain('Close STEP library')
  })
})
