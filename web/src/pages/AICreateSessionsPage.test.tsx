import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n'
import AICreateSessionsPage from './AICreateSessionsPage'

describe('AICreateSessionsPage', () => {
  it('renders the persisted session library chrome with localized source copy', () => {
    const markup = renderToStaticMarkup(<I18nProvider><MemoryRouter><AICreateSessionsPage /></MemoryRouter></I18nProvider>)
    expect(markup).toContain('AI Create sessions')
    expect(markup).toContain('PERSISTED AI WORK')
    expect(markup).toContain('Loading AI Create sessions')
    expect(markup).toContain('Sessions')
    expect(markup).not.toMatch(/[\u4e00-\u9fff]/)
  })
})
