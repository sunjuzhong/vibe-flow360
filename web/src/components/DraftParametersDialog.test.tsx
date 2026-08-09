import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import DraftParametersDialog from './DraftParametersDialog'
import { I18nProvider } from '../i18n'

describe('DraftParametersDialog', () => {
  it('renders a focused parameters-only dialog', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider><DraftParametersDialog
        draftId="draft-1"
        draftName="High AoA"
        detail={{ id: 'draft-1', type: 'Draft', simulation_params: { operating_condition: {} } }}
        loading={false}
        error=""
        onClose={() => undefined}
        onRetry={() => undefined}
      /></I18nProvider>,
    )

    expect(markup).toContain('aria-label="Current Draft"')
    expect(markup).toContain('High AoA')
    expect(markup).toContain('draft-1')
    expect(markup).toContain('Changes save automatically to Flow360.')
    expect(markup).toContain('Loading the installed Flow360 schema…')
    expect(markup).not.toContain('Resource details')
    expect(markup).not.toContain('Overview')
    expect(markup).not.toContain('Summary')
  })

  it('keeps parameter loading and failures inside the same dialog', () => {
    const loading = renderToStaticMarkup(
      <I18nProvider><DraftParametersDialog
        draftId="draft-1"
        draftName="High AoA"
        detail={null}
        loading
        error=""
        onClose={() => undefined}
        onRetry={() => undefined}
      /></I18nProvider>,
    )
    const failed = renderToStaticMarkup(
      <I18nProvider><DraftParametersDialog
        draftId="draft-1"
        draftName="High AoA"
        detail={null}
        loading={false}
        error="Failed to fetch"
        onClose={() => undefined}
        onRetry={() => undefined}
      /></I18nProvider>,
    )

    expect(loading).toContain('Reading Draft parameters…')
    expect(failed).toContain('Could not read Draft parameters')
    expect(failed).toContain('Retry')
  })
})
