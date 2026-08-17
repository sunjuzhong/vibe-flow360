import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { nextParameterPresetSelection, ParameterSelectionGroups } from './ParameterSelectionGroups'

describe('ParameterSelectionGroups', () => {
  it('replaces, combines, and removes complete preset selections', () => {
    expect(nextParameterPresetSelection(['other'], ['a', 'b'], false)).toEqual(['a', 'b'])
    expect(nextParameterPresetSelection(['other', 'a'], ['a', 'b'], true)).toEqual(['other', 'a', 'b'])
    expect(nextParameterPresetSelection(['other', 'a', 'b'], ['a', 'b'], true)).toEqual(['other'])
  })

  it('derives complete and partial group state from the normal item selection', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ParameterSelectionGroups
          presets={[
            { id: 'wing', label: 'Wing', tag: 'groupName', memberIds: ['a', 'b'] },
            { id: 'body', label: 'Body', tag: 'bodyId', memberIds: ['a', 'b', 'c'] },
          ]}
          selectedIds={['a', 'b']}
          visibility={{ a: true, b: true, c: false }}
          onSelectionChange={vi.fn()}
          onSetVisibility={vi.fn()}
        />
      </I18nProvider>,
    )

    expect(html).toContain('Selection groups')
    expect(html).toContain('aria-pressed="true" title="Select Wing')
    expect(html).toContain('aria-pressed="mixed" title="Select Body')
    expect(html).toContain('2 items · groupName')
    expect(html).toContain('aria-label="Hide group Wing"')
  })
})
