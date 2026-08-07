import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import DraftManagerPanel from './DraftManagerPanel'

function render(node: ReactNode) {
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>)
}

describe('DraftManagerPanel', () => {
  it('exposes create, copy, rename, and confirmed-delete management', () => {
    const markup = render(
      <DraftManagerPanel
        drafts={[{ id: 'draft-1', name: 'Baseline', source_id: 'geo-1', source_type: 'Geometry' }]}
        selectedId="draft-1"
        resource={{ id: 'geo-1', name: 'Wing', type: 'Geometry', parent_id: null }}
        onClose={() => undefined}
        onSelect={() => undefined}
        onCreate={async () => undefined}
        onCopy={async () => undefined}
        onRename={async () => undefined}
        onDelete={async () => undefined}
      />,
    )
    expect(markup).toContain('aria-label="Manage Drafts"')
    expect(markup).toContain('Create Draft from this Resource')
    expect(markup).toContain('>Copy<')
    expect(markup).toContain('>Rename<')
    expect(markup).toContain('>Delete<')
    expect(markup).toContain('Creates an editable Draft without running Flow360.')
  })
})
