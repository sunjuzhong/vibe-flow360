import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n'
import type { SlicePlayerJob } from '../api/client'
import CaseSlicePlayerPanel, { caseTimeSeriesPlayerTitle, formatSlicePlayerDuration, selectPlaybackAsset, selectedSliceFieldRange, sliceFieldPanelVisible, sliceFrameAssetURL, slicePlaybackFrameAtTime, slicePlaybackFrameKey, slicePlaybackFullscreenLabel, slicePlaybackPrefetchIndices, slicePlaybackReadyFrameKey, slicePlaybackStableBounds, slicePlaybackTimeline, slicePlaybackTrackNames, slicePlayerAssetURL, slicePlayerPartialPlaybackReady, stageLabel, SLICE_PLAYBACK_FPS_OPTIONS } from './CaseSlicePlayerPanel'

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

  it('formats cache timing metrics for quick and long preparations', () => {
    expect(formatSlicePlayerDuration(47)).toBe('47 ms')
    expect(formatSlicePlayerDuration(1470)).toBe('1.5 s')
    expect(formatSlicePlayerDuration(125_000)).toBe('2m 5s')
  })

  it('recognizes a progressive playback report before final indexing completes', () => {
    const job = {
      status: 'running',
      report: {
        partial_ready: true,
        playback: { ready: true, frame_count: 1 },
      },
    } as SlicePlayerJob
    expect(slicePlayerPartialPlaybackReady(job)).toBe(true)
    expect(slicePlayerPartialPlaybackReady({ ...job, status: 'completed' })).toBe(false)
    expect(stageLabel('preparing-remaining-frames')).toBe('First frames are ready while remaining frames continue preparing')
  })

  it('uses preview assets during playback and full resolution while paused', () => {
    const frame = {
      slice: 'slice_Wake',
      fields: ['Mach'],
      field_ranges: { Mach: [0, 3] as [number, number] },
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
    expect(selectPlaybackAsset(frame, true)).toEqual({
      manifestPath: 'frame.preview.manifest.json',
      vertices: 30_000,
      triangles: 40_000,
    })
  })

  it('uses wall-clock playback and skips frames when rendering falls behind', () => {
    expect(slicePlaybackFrameAtTime(3, 0, 10, 100)).toBe(3)
    expect(slicePlaybackFrameAtTime(3, 450, 10, 100)).toBe(7)
    expect(slicePlaybackFrameAtTime(98, 350, 10, 100)).toBe(1)
  })

  it('offers smooth playback frame rates while retaining low-bandwidth choices', () => {
    expect(SLICE_PLAYBACK_FPS_OPTIONS).toEqual([1, 2, 5, 10, 15, 20, 24, 30])
  })

  it('shows Field controls only while playback is paused', () => {
    expect(sliceFieldPanelVisible(false)).toBe(true)
    expect(sliceFieldPanelVisible(true)).toBe(false)
  })

  it('labels the fullscreen control from the browser fullscreen state', () => {
    expect(slicePlaybackFullscreenLabel(false)).toBe('Enter full screen')
    expect(slicePlaybackFullscreenLabel(true)).toBe('Exit full screen')
  })

  it('prefetches two frames ahead and keeps one frame behind with wraparound', () => {
    expect(slicePlaybackPrefetchIndices(0, 10)).toEqual([1, 2, 9])
    expect(slicePlaybackPrefetchIndices(9, 10)).toEqual([0, 1, 8])
    expect(slicePlaybackPrefetchIndices(0, 2)).toEqual([1])
  })

  it('builds an encoded immutable frame asset URL', () => {
    expect(sliceFrameAssetURL('case/1', 'job 1', {
      slice: 'slice_Wake',
      fields: [],
      field_ranges: {},
      manifest_path: 'slice frame/1.manifest.json',
      vertices: 1,
      triangles: 1,
      bounds: [[0, 0, 0], [1, 1, 1]],
    })).toBe('/api/flow360/resources/Case/case%2F1/slice-player/jobs/job%201/assets/slice%20frame/1.manifest.json')
    expect(slicePlayerAssetURL('case/1', 'job 1', 'surface frame/1.preview.manifest.json'))
      .toBe('/api/flow360/resources/Case/case%2F1/slice-player/jobs/job%201/assets/surface%20frame/1.preview.manifest.json')
  })

  it('keys frame readiness by every selected slice asset', () => {
    const bounds = [[0, 0, 0], [1, 1, 1]] as [[number, number, number], [number, number, number]]
    const frame = (slice: string, path: string) => ({
      slice, fields: [], manifest_path: path, vertices: 1, triangles: 1, bounds,
    })
    const first = frame('a', 'a-100.json')
    const second = frame('b', 'b-100.json')
    const combinedKey = slicePlaybackFrameKey('case-1', 'job-1', [first, second])
    expect(combinedKey).toBe([
      '/api/flow360/resources/Case/case-1/slice-player/jobs/job-1/assets/a-100.json',
      '/api/flow360/resources/Case/case-1/slice-player/jobs/job-1/assets/b-100.json',
    ].join('|'))
    const primaryOnly = slicePlaybackFrameKey('case-1', 'job-1', [first])
    expect(combinedKey).not.toBe(primaryOnly)
    expect(slicePlaybackReadyFrameKey(combinedKey, combinedKey)).toBe(combinedKey)
    expect(slicePlaybackReadyFrameKey(primaryOnly, combinedKey)).toBe('')
  })

  it('groups named slices and synchronizes multiple selections by common steps', () => {
    const bounds = [[0, 0, 0], [1, 1, 1]] as [[number, number, number], [number, number, number]]
    const frames = [
      { slice: 'wake-y', step: 100, fields: ['Mach'], manifest_path: 'y-100.json', vertices: 1, triangles: 1, bounds },
      { slice: 'wake-z', step: 100, fields: ['Mach'], manifest_path: 'z-100.json', vertices: 1, triangles: 1, bounds },
      { slice: 'wake-y', step: 200, fields: ['Mach'], manifest_path: 'y-200.json', vertices: 1, triangles: 1, bounds },
      { slice: 'wake-z', step: 300, fields: ['Mach'], manifest_path: 'z-300.json', vertices: 1, triangles: 1, bounds },
    ]
    expect(slicePlaybackTrackNames(frames)).toEqual(['wake-y', 'wake-z'])
    expect(slicePlaybackTimeline(frames, ['wake-y', 'wake-z'])).toEqual([{
      step: 100,
      frames: [frames[0], frames[1]],
    }])
    expect(slicePlaybackStableBounds([
      { ...frames[0], bounds: [[-1, 0, 0], [1, 2, 0]] },
      { ...frames[2], bounds: [[0, -2, 0], [3, 1, 0]] },
      frames[1],
    ], ['wake-y'])).toEqual([[-1, -2, 0], [3, 2, 0]])
  })

  it('excludes single-frame static snapshots from playback tracks', () => {
    const bounds = [[0, 0, 0], [1, 1, 1]] as [[number, number, number], [number, number, number]]
    const frames = [
      { slice: 'slice_wake', fields: [], manifest_path: 'wake.json', vertices: 1, triangles: 1, bounds },
      { slice: 'slice_wake_time', step: 100, fields: [], manifest_path: 'wake-100.json', vertices: 1, triangles: 1, bounds },
      { slice: 'slice_wake_time', step: 200, fields: [], manifest_path: 'wake-200.json', vertices: 1, triangles: 1, bounds },
    ]
    expect(slicePlaybackTrackNames(frames)).toEqual(['slice_wake_time'])
  })

  it('aligns tracks by ordinal frame when global steps are unavailable', () => {
    const bounds = [[0, 0, 0], [1, 1, 1]] as [[number, number, number], [number, number, number]]
    const frames = [
      { slice: 'a', fields: [], manifest_path: 'a-0.json', vertices: 1, triangles: 1, bounds },
      { slice: 'a', fields: [], manifest_path: 'a-1.json', vertices: 1, triangles: 1, bounds },
      { slice: 'b', fields: [], manifest_path: 'b-0.json', vertices: 1, triangles: 1, bounds },
    ]
    expect(slicePlaybackTimeline(frames, ['a', 'b'])).toEqual([{ step: undefined, frames: [frames[0], frames[2]] }])
  })

  it('uses one stable field range across every frame of only the selected slices', () => {
    const bounds = [[0, 0, 0], [1, 1, 1]] as [[number, number, number], [number, number, number]]
    const frame = (slice: string, path: string, range: [number, number]) => ({
      slice, fields: ['Mach'], field_ranges: { Mach: range }, manifest_path: path,
      vertices: 1, triangles: 1, bounds,
    })
    const frames = [
      frame('a', 'a-0.json', [0, 1]),
      frame('a', 'a-1.json', [0.2, 2]),
      frame('b', 'b-0.json', [-3, 0.5]),
      frame('unselected', 'c-0.json', [-100, 100]),
    ]
    expect(selectedSliceFieldRange(frames, ['a', 'b'], 'Mach')).toEqual([-3, 2])
    expect(selectedSliceFieldRange(frames, ['a'], 'Mach')).toEqual([0, 2])
  })
})
