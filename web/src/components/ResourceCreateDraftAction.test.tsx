import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import ResourceCreateDraftAction from './ResourceCreateDraftAction'

describe('ResourceCreateDraftAction', () => {
  it('presents Draft creation as a parameter snapshot rather than a configuration workflow', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <ResourceCreateDraftAction onCreate={async () => undefined} />
      </I18nProvider>,
    )

    expect(markup).toContain('Create Draft')
    expect(markup).toContain('current SimulationParams')
    expect(markup).not.toContain('Configure')
  })
})
