import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n'
import { ViewerFieldDiagnostics } from './ViewerFieldDiagnostics'

describe('ViewerFieldDiagnostics', () => {
  it('renders shared distribution, extreme, and probe evidence for the active field', () => {
    const onLocateExtreme = vi.fn()
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ViewerFieldDiagnostics
          field={{ name: 'Aspect Ratio', kind: 'scalar', min: 1, max: 10 }}
          range={[2, 8]}
          histogram={{
            field: { name: 'Aspect Ratio', kind: 'scalar', min: 1, max: 10 },
            sampleCount: 12,
            bins: [
              { min: 1, max: 2, count: 3 },
              { min: 2, max: 8, count: 9 },
            ],
          }}
          extrema={{
            field: { name: 'Aspect Ratio', kind: 'scalar', min: 1, max: 10 },
            min: null,
            max: { fieldName: 'Aspect Ratio', entityId: 'zone-1', value: 9.5, position: [1, 2, 3] },
          }}
          probe={{ fieldName: 'Aspect Ratio', entityId: 'zone-1', value: 4.5, position: [1, 2, 3] }}
          entityNames={{ 'zone-1': 'fluid' }}
          riskDirection="max"
          onLocateExtreme={onLocateExtreme}
        />
      </I18nProvider>,
    )

    expect(html).toContain('viewer-field-diagnostics')
    expect(html).toContain('Aspect Ratio distribution with 12 samples')
    expect(html).toContain('Locate highest value · 9.5000')
    expect(html).toContain('Probe ·')
    expect(html).toContain('fluid')
    expect(html).toContain('class="in-range"')
  })

  it('does not show stale evidence from another field', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <ViewerFieldDiagnostics
          field={{ name: 'Aspect Ratio', kind: 'scalar', min: 1, max: 10 }}
          range={[1, 10]}
          histogram={{
            field: { name: 'Skewness', kind: 'scalar', min: 0, max: 1 },
            sampleCount: 4,
            bins: [{ min: 0, max: 1, count: 4 }],
          }}
          extrema={null}
          probe={null}
          entityNames={{}}
          riskDirection="max"
          onLocateExtreme={() => undefined}
        />
      </I18nProvider>,
    )

    expect(html).toBe('')
  })
})
