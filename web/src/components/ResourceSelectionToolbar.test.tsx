import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import {
  mergeSelectedResourceIds,
  removeSelectedResourceIds,
  ResourceSelectionToolbar,
} from './ResourceSelectionToolbar'

describe('ResourceSelectionToolbar', () => {
  it('selects and deselects a full filtered data set without depending on rendered rows', () => {
    const resultIds = Array.from({ length: 5_000 }, (_, index) => `face-${index}`)
    expect(mergeSelectedResourceIds(['outside'], resultIds)).toHaveLength(5_001)
    expect(removeSelectedResourceIds(['outside', ...resultIds], resultIds)).toEqual(['outside'])
  })

  it('distinguishes filtered results from the complete inventory', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ResourceSelectionToolbar
          allIds={['a', 'b', 'c']}
          resultIds={['b']}
          selectedIds={['a']}
          filtered
          onSelectionChange={() => undefined}
        />
      </I18nProvider>,
    )

    expect(html).toContain('1 selected · 1 results · 3 total')
    expect(html).toContain('Select results')
    expect(html).toContain('Select all')
    expect(html).toContain('aria-label="Clear selection"')
  })
})
