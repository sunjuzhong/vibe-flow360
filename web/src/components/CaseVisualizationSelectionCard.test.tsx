import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import { CaseVisualizationSelectionCard } from './CaseVisualizationSelectionCard'

describe('CaseVisualizationSelectionCard', () => {
  it('keeps the single-Case property and display controls reusable', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CaseVisualizationSelectionCard
          items={[{ name: 'Cylinder wall', typeLabel: 'Surfaces', triangles: 120, vertices: 80, entityIds: ['wall'] }]}
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

  it('summarizes shared controls for multiple selected visualization objects', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CaseVisualizationSelectionCard
          items={[
            { name: 'Slice A', typeLabel: 'Slices', triangles: 120, vertices: 80, entityIds: ['a'] },
            { name: 'Slice B', typeLabel: 'Slices', triangles: 180, vertices: 100, entityIds: ['b'] },
          ]}
          visible
          fieldNames={['Mach']}
          fieldVisualizationEnabled
          activeField="Mach"
          onFocus={() => undefined}
          onIsolate={() => undefined}
          onToggleVisibility={() => undefined}
          onShowAll={() => undefined}
          onClear={() => undefined}
          onFieldVisualizationChange={() => undefined}
        />
      </I18nProvider>,
    )

    expect(markup).toContain('2 items selected')
    expect(markup).toContain('300')
    expect(markup).toContain('180')
    expect(markup).toContain('Mach')
  })
})
