import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import CaseSlicePlayerPanel, { selectPlaybackAsset, SLICE_PLAYBACK_FPS_OPTIONS } from './CaseSlicePlayerPanel'

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

  it('uses the same full-resolution asset during playback and pause', () => {
    const frame = {
      manifest_path: 'frame.manifest.json',
      preview_manifest_path: 'frame.preview.manifest.json',
      vertices: 100_000,
      triangles: 200_000,
      preview_vertices: 30_000,
      preview_triangles: 40_000,
      bounds: [[0, 0, 0], [1, 1, 1]] as [[number, number, number], [number, number, number]],
    }
    expect(selectPlaybackAsset(frame)).toEqual({
      manifestPath: 'frame.manifest.json',
      vertices: 100_000,
      triangles: 200_000,
    })
  })

  it('offers smooth playback frame rates while retaining low-bandwidth choices', () => {
    expect(SLICE_PLAYBACK_FPS_OPTIONS).toEqual([1, 2, 5, 10, 15, 20, 24, 30])
  })
})
