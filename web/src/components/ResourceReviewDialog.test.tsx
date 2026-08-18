import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import {
  ResourceReviewDialog,
  ResourceReviewLauncher,
  ResourceReviewLaunchers,
  ResourceReviewToggle,
  resourceReviewDialogDismissesOnBackdrop,
} from './ResourceReviewDialog'

describe('ResourceReviewDialog', () => {
  it('can keep long-running review panels open when the backdrop is clicked', () => {
    expect(resourceReviewDialogDismissesOnBackdrop(false)).toBe(false)
    expect(resourceReviewDialogDismissesOnBackdrop()).toBe(true)
  })

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

  it('renders an inline review option as a compact stateful button', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ResourceReviewToggle label="Cell quality" summary="6 fields" checked onChange={() => undefined} />
      </I18nProvider>,
    )
    expect(html).toContain('role="checkbox"')
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('Cell quality')
    expect(html).toContain('6 fields')
    expect(html).not.toContain('resource-review-launchers')
  })
})
