import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import CaseSlicePlayerPanel from './CaseSlicePlayerPanel'

describe('CaseSlicePlayerPanel', () => {
  it('starts with a bounded large-file preparation state', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CaseSlicePlayerPanel caseId="case-1" resultPath="results/slices.tar.gz" sizeBytes={1024} />
      </I18nProvider>,
    )
    expect(markup).toContain('Reading Slice player state')
    expect(markup).not.toContain('type="file"')
  })
})
