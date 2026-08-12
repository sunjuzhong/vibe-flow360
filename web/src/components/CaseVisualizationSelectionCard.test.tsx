import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { CaseVisualizationSelectionCard } from './CaseVisualizationSelectionCard'

describe('CaseVisualizationSelectionCard', () => {
  it('keeps the single-Case property and display controls reusable', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CaseVisualizationSelectionCard
          item={{ name: 'Cylinder wall', typeLabel: 'Surfaces', triangles: 120, vertices: 80, entityIds: ['wall'] }}
          visible
          fieldNames={['Cp', 'CfVec']}
          fieldVisualizationEnabled
          activeField="Cp"
          onFocus={() => undefined}
          onIsolate={() => undefined}
          onToggleVisibility={() => undefined}
          onShowAll={() => undefined}
          onClear={() => undefined}
          onFieldVisualizationChange={() => undefined}
        />
      </I18nProvider>,
    )

    expect(markup).toContain('Cylinder wall')
    expect(markup).toContain('Cp')
    expect(markup).toContain('Focus')
    expect(markup).toContain('Isolate')
    expect(markup).toContain('Hide')
    expect(markup).toContain('Field visualization')
  })
})
