import { describe, expect, it } from 'vitest'
import type { ResourceDetail } from '../api/client'
import { caseSurfaceVisibilityMap, caseVisualizationSections, findSliceArchive, groupCaseVisualizationMembers, isSliceArchiveResult, mapCaseStatus, normalizeCase, isTerminal, visibleCaseSurfaceCount } from './CaseWorkspace'

function detail(state: Record<string, unknown>, info?: Record<string, unknown>, summary?: Record<string, unknown>): ResourceDetail {
  return {
    type: 'Case',
    id: 'case-1',
    info: info ?? { status: 'running' },
    state,
    summary: summary ?? {},
    simulation_params: {},
    errors: {},
    results: { records: [] },
  }
}

describe('mapCaseStatus', () => {
  it('maps queued', () => {
    expect(mapCaseStatus(detail({ status: 'queued' }))).toBe('queued')
  })
  it('maps pending as queued', () => {
    expect(mapCaseStatus(detail({ status: 'pending' }))).toBe('queued')
  })
  it('maps preprocessing', () => {
    expect(mapCaseStatus(detail({ status: 'preprocessing' }))).toBe('preprocessing')
  })
  it('maps running', () => {
    expect(mapCaseStatus(detail({ status: 'running' }))).toBe('running')
  })
  it('maps completed', () => {
    expect(mapCaseStatus(detail({ status: 'completed' }))).toBe('completed')
  })
  it('maps failed', () => {
    expect(mapCaseStatus(detail({ status: 'failed' }))).toBe('failed')
  })
  it('falls back to unknown', () => {
    expect(mapCaseStatus(detail({ status: 'weird' }))).toBe('unknown')
  })
  it('is terminal for completed and failed', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('running')).toBe(false)
  })
})

describe('normalizeCase', () => {
  it('extracts elapsed time and result count', () => {
    const d = detail(
      { status: 'completed' },
      { status: 'completed' },
      { elapsed_time: 42.5 },
    )
    d.results = { records: [{ name: 'result.csv', path: 'out.csv', file_type: 'csv', size_bytes: 1234 }] }
    const vm = normalizeCase(d)
    expect(vm.status).toBe('completed')
    expect(vm.runTime).toContain('42')
    expect(vm.resultCount).toBe(1)
  })

  it('returns "Not reported" for missing operating conditions', () => {
    const vm = normalizeCase(detail({ status: 'running' }))
    expect(vm.operatingPoint).toEqual({})
  })

  it('extracts turbulence model', () => {
    const d = detail(
      { status: 'running' },
      { status: 'running' },
      { turbulence_model: 'k-epsilon' },
    )
    const vm = normalizeCase(d)
    expect(vm.turbulenceModel).toBe('k-epsilon')
  })
})

describe('Case surface visibility', () => {
  const groups = [
    { id: 'wall', visible: true },
    { id: 'farfield', visible: false },
  ]

  it('resolves manifest defaults and controlled overrides', () => {
    expect(visibleCaseSurfaceCount(groups, {})).toBe(1)
    expect(visibleCaseSurfaceCount(groups, { wall: false, farfield: true })).toBe(1)
  })

  it('builds complete Show all and Hide all maps', () => {
    expect(caseSurfaceVisibilityMap(groups, true)).toEqual({ wall: true, farfield: true })
    expect(caseSurfaceVisibilityMap(groups, false)).toEqual({ wall: false, farfield: false })
  })
})

describe('groupCaseVisualizationMembers', () => {
  it('uses the generic manifest hierarchy path to classify Case render objects', () => {
    const groups = [
      { id: 'fluid/wall', name: 'fluid/wall', color: '#fff', visible: true, path: ['boundaries', 'Boundaries (Auto)'] },
      { id: 'slice-y', name: 'Y plane', color: '#fff', visible: true, path: ['slices', 'Slices (Auto)'] },
      { id: 'qcriterion', name: 'Q criterion', color: '#fff', visible: true, path: ['isosurfaces', 'Isosurfaces (Auto)'] },
      { id: 'seed-1', name: 'Wake', color: '#fff', visible: true, path: ['streamlines', 'Streamlines (Auto)'] },
    ]

    expect(groupCaseVisualizationMembers(groups).map(({ category, members }) => ({
      category,
      ids: members.map((member) => member.id),
    }))).toEqual([
      { category: 'surfaces', ids: ['fluid/wall'] },
      { category: 'slices', ids: ['slice-y'] },
      { category: 'isosurfaces', ids: ['qcriterion'] },
      { category: 'streamlines', ids: ['seed-1'] },
    ])
  })

  it('treats uncategorized and boundary objects as surfaces and omits empty categories', () => {
    const groups = [
      { id: 'wall', name: 'Wall', color: '#fff', visible: true, path: ['boundaries'] },
      { id: 'body', name: 'Body', color: '#fff', visible: true },
    ]
    expect(groupCaseVisualizationMembers(groups)).toHaveLength(1)
    expect(groupCaseVisualizationMembers(groups)[0].category).toBe('surfaces')
    expect(groupCaseVisualizationMembers(groups)[0].members).toHaveLength(2)
  })

  it('adds a Slice player section when only the time-series archive exists', () => {
    const groups = [
      { id: 'wall', name: 'Wall', color: '#fff', visible: true, path: ['boundaries'] },
      { id: 'qcriterion', name: 'Q', color: '#fff', visible: true, path: ['isosurfaces'] },
    ]
    expect(caseVisualizationSections(groups, true).map((section) => section.category)).toEqual([
      'surfaces',
      'slices',
      'isosurfaces',
    ])
    expect(caseVisualizationSections(groups, true)[1].members).toEqual([])
  })

  it('does not duplicate Slices when the manifest already contains Slice geometry', () => {
    const groups = [
      { id: 'slice-y', name: 'Y plane', color: '#fff', visible: true, path: ['slices'] },
    ]
    expect(caseVisualizationSections(groups, true)).toHaveLength(1)
    expect(caseVisualizationSections(groups, true)[0].members).toHaveLength(1)
  })
})

describe('findSliceArchive', () => {
  it('detects only the canonical Case Slice archive', () => {
    expect(findSliceArchive([
      { path: 'results/forces.csv' },
      { path: 'results/slices.tar.gz', size_bytes: 123 },
    ])).toMatchObject({ path: 'results/slices.tar.gz', size_bytes: 123 })
    expect(findSliceArchive([{ name: 'slices.tar.gz' }])).toMatchObject({ name: 'slices.tar.gz' })
    expect(findSliceArchive([{ path: 'results/surfaces.tar.gz' }])).toBeNull()
  })

  it('only makes the canonical Slice archive playable', () => {
    expect(isSliceArchiveResult({ path: 'results/slices.tar.gz' })).toBe(true)
    expect(isSliceArchiveResult({ path: `results\\slices.tar.gz` })).toBe(true)
    expect(isSliceArchiveResult({ name: 'slices.tar.gz' })).toBe(true)
    expect(isSliceArchiveResult({ path: 'results/surfaces.tar.gz' })).toBe(false)
    expect(isSliceArchiveResult({ path: 'downloads/slices.tar.gz' })).toBe(false)
  })
})
