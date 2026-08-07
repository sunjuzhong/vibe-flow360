import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import {
  ResourceReviewDialog,
  ResourceReviewLauncher,
  ResourceReviewLaunchers,
} from './ResourceReviewDialog'

describe('ResourceReviewDialog', () => {
  it('renders focused review content in an accessible modal', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ResourceReviewDialog
          title="Preflight evidence"
          subtitle="2 warnings"
          icon={<span>!</span>}
          onClose={() => undefined}
        >
          <p>Detailed finding</p>
        </ResourceReviewDialog>
      </I18nProvider>,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Preflight evidence')
    expect(html).toContain('Detailed finding')
    expect(html).toContain('aria-label="Close review details"')
  })

  it('renders concise launcher rows outside the dialog', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ResourceReviewLaunchers>
          <ResourceReviewLauncher icon={<span>!</span>} label="Quality controls" summary="4 fields" onClick={() => undefined} />
        </ResourceReviewLaunchers>
      </I18nProvider>,
    )

    expect(html).toContain('aria-label="Review details"')
    expect(html).toContain('Quality controls')
    expect(html).toContain('4 fields')
  })
})
