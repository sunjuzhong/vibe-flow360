import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import CaseSlicePlayerPanel, { caseTimeSeriesPlayerTitle, selectPlaybackAsset, sliceFieldPanelVisible, sliceFrameAssetURL, slicePlaybackPrefetchIndices, slicePlayerAssetURL, SLICE_PLAYBACK_FPS_OPTIONS } from './CaseSlicePlayerPanel'

describe('CaseSlicePlayerPanel', () => {
  it('starts with a bounded large-file preparation state', () => {
    const markup = renderToStaticMarkup(
      <I18nProvider>
        <CaseSlicePlayerPanel caseId="case-1" resultPath="results/slices.tar.gz" archiveKind="slices" sizeBytes={1024} />
      </I18nProvider>,
    )
    expect(markup).toContain('Reading time-series player state')
    expect(markup).not.toContain('type="file"')
  })

  it('uses archive-specific player titles', () => {
    expect(caseTimeSeriesPlayerTitle('slices')).toBe('Time-series Slice player')
    expect(caseTimeSeriesPlayerTitle('surfaces')).toBe('Time-series Surface player')
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

  it('shows Field controls only while playback is paused', () => {
    expect(sliceFieldPanelVisible(false)).toBe(true)
    expect(sliceFieldPanelVisible(true)).toBe(false)
  })

  it('prefetches two frames ahead and keeps one frame behind with wraparound', () => {
    expect(slicePlaybackPrefetchIndices(0, 10)).toEqual([1, 2, 9])
    expect(slicePlaybackPrefetchIndices(9, 10)).toEqual([0, 1, 8])
    expect(slicePlaybackPrefetchIndices(0, 2)).toEqual([1])
  })

  it('builds an encoded immutable frame asset URL', () => {
    expect(sliceFrameAssetURL('case/1', 'job 1', {
      manifest_path: 'slice frame/1.manifest.json',
      vertices: 1,
      triangles: 1,
      bounds: [[0, 0, 0], [1, 1, 1]],
    })).toBe('/api/flow360/resources/Case/case%2F1/slice-player/jobs/job%201/assets/slice%20frame/1.manifest.json')
    expect(slicePlayerAssetURL('case/1', 'job 1', 'surface frame/1.preview.manifest.json'))
      .toBe('/api/flow360/resources/Case/case%2F1/slice-player/jobs/job%201/assets/surface%20frame/1.preview.manifest.json')
  })
})
