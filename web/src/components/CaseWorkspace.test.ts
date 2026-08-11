import { describe, expect, it } from 'vitest'
import type { ResourceDetail } from '../api/client'
import { caseArchiveLayerFromEntries, caseConfiguredVisualizationMembers, caseFieldForSelection, caseObjectFieldNames, caseResourceIdentity, caseSurfaceVisibilityMap, caseVisualizationGroupCounts, caseVisualizationSections, convergenceTrendLabel, findSliceArchive, findTimeSeriesArchives, groupCaseVisualizationMembers, isSliceArchiveResult, isVolumeSnapshotArchive, localizeConvergenceReason, mapCaseStatus, normalizeCase, isTerminal, reconcileCaseVisualizationSelection, timeSeriesArchiveKind, visibleCaseSurfaceCount } from './CaseWorkspace'
import { translate } from '../i18n/translations'

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

describe('convergenceTrendLabel', () => {
  it('normalizes supported trend values and prioritizes metric stability', () => {
    expect(convergenceTrendLabel({ stable: true, trend: 'increasing' })).toBe('stable')
    expect(convergenceTrendLabel({ stable: false, trend: 'Increasing' })).toBe('increasing')
    expect(convergenceTrendLabel({ stable: false, trend: 'decreasing' })).toBe('decreasing')
    expect(convergenceTrendLabel({ stable: false, trend: 'custom-trend' })).toBe('custom-trend')
  })
})

describe('localizeConvergenceReason', () => {
  it('translates each deterministic analyzer reason while preserving metric values', () => {
    const reason = '2_momy not stable: drift=2.08e-05; 2_momy oscillating'
    expect(localizeConvergenceReason(reason, (value) => translate(value, 'zh-CN'))).toBe(
      '2_momy 不稳定：漂移=2.08e-05; 2_momy 振荡',
    )
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

  it('counts configured placeholders in the total without treating them as visible', () => {
    const members = [
      { id: 'cylinder_surface', visible: false, entityIds: [] },
      { id: 'boundaries', visible: true, entityIds: ['wall'] },
    ]
    expect(caseVisualizationGroupCounts(members, {})).toEqual({ total: 2, visible: 1 })
  })
})

describe('Case archive layers', () => {
  it('turns a prepared archive frame into independently selectable Viewer groups', () => {
    const member = {
      id: 'case-output:cylinder', name: 'Cylinder_surface', color: '#789521', visible: false,
      entityIds: [], playbackKind: 'surfaces' as const, source: 'output' as const, path: ['surfaces'],
    }
    const frame = {
      manifest_path: 'surface.manifest.json', preview_manifest_path: 'surface.preview.manifest.json',
      vertices: 100, triangles: 80, preview_vertices: 50, preview_triangles: 40,
      bounds: [[-1, -2, 0], [3, 2, 1]] as [[number, number, number], [number, number, number]],
    }
    expect(caseArchiveLayerFromEntries(member, '/surface.preview.manifest.json', frame, [
      { id: 'piece-0', type: 'SolidGeometry', resources: { buffers: { sections: [
        { name: 'position' }, { name: 'Cp' }, { name: 'velocity' },
      ] } } },
      { id: 'surface-face-0', name: 'Cylinder_surface', type: 'Face' },
    ])).toMatchObject({
      memberId: 'case-output:cylinder',
      entityIds: ['archive:case-output:cylinder:surface-face-0'],
      fields: ['Cp', 'velocity'],
      manifest: {
        asset_url: '/surface.preview.manifest.json',
        elements: 40,
        vertices: 50,
        entity_id_prefix: 'archive:case-output:cylinder:',
        groups: [{ id: 'archive:case-output:cylinder:surface-face-0', name: 'Cylinder_surface', visible: true }],
      },
    })
  })
})

describe('Case visualization selection refresh', () => {
  const refreshedGroups = [{
    category: 'slices' as const,
    members: [{
      id: 'case-output:wake', name: 'wake_animation', color: '#789521', visible: true,
      entityIds: ['new-slice-face'], source: 'manifest' as const,
    }],
  }]

  it('preserves the logical item and migrates selection when refreshed entity IDs change', () => {
    expect(reconcileCaseVisualizationSelection(
      'case-output:wake',
      { groupId: 'old-slice-face', groupIds: ['old-slice-face'] },
      refreshedGroups,
    )).toEqual({
      selectedVisualizationId: 'case-output:wake',
      viewerSelection: { groupId: 'new-slice-face', groupIds: ['new-slice-face'] },
    })
  })

  it('clears selection only when the logical visualization item no longer exists', () => {
    expect(reconcileCaseVisualizationSelection(
      'case-output:removed',
      { groupId: 'old-slice-face' },
      refreshedGroups,
    )).toEqual({ selectedVisualizationId: null, viewerSelection: { groupId: null } })
  })

  it('keeps a stable resource identity while async detail data arrives', () => {
    expect(caseResourceIdentity('case-route-id', null)).toBe('case-route-id')
    expect(caseResourceIdentity('case-route-id', 'case-route-id')).toBe('case-route-id')
    expect(caseResourceIdentity(null, 'case-detail-id')).toBe('case-detail-id')
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
    expect(caseVisualizationSections(groups, true)[1].members).toMatchObject([{
      name: 'Time-series Slice archive',
      entityIds: [],
      playbackKind: 'slices',
    }])
  })

  it('does not duplicate Slices when the manifest already contains Slice geometry', () => {
    const groups = [
      { id: 'slice-y', name: 'Y plane', color: '#fff', visible: true, path: ['slices'] },
    ]
    expect(caseVisualizationSections(groups, true)).toHaveLength(1)
    expect(caseVisualizationSections(groups, true)[0].members).toHaveLength(1)
  })

  it('combines configured outputs with auto manifest containers into four Case items', () => {
    const groups = [
      { id: 'fluid/wall', name: 'fluid/wall', color: '#fff', visible: true, triangles: 624, path: ['surface_output', 'Boundaries (Auto)'] },
      { id: 'qcriterion', name: 'qcriterion', color: '#fff', visible: true, triangles: 3_688, path: ['isosurfaces', 'Isosurfaces (Auto)'] },
    ]
    const configured = caseConfiguredVisualizationMembers({
      outputs: [
        { output_type: 'SurfaceOutput', name: 'cylinder_surface', private_attribute_id: 'surface-1' },
        { output_type: 'SliceOutput', name: 'wake_animation', private_attribute_id: 'slice-1' },
        { output_type: 'ForceOutput', name: 'forces' },
      ],
    }, ['slices', 'surfaces'])
    const sections = caseVisualizationSections(groups, true, configured)

    expect(sections.map(({ category, members }) => ({
      category,
      members: members.map(({ name, entityIds, playbackKind }) => ({ name, entityIds, playbackKind })),
    }))).toEqual([
      { category: 'surfaces', members: [
        { name: 'Cylinder_surface', entityIds: [], playbackKind: 'surfaces' },
        { name: 'Boundaries (Auto)', entityIds: ['fluid/wall'], playbackKind: undefined },
      ] },
      { category: 'slices', members: [
        { name: 'Wake_animation', entityIds: [], playbackKind: 'slices' },
      ] },
      { category: 'isosurfaces', members: [
        { name: 'Isosurfaces (Auto)', entityIds: ['qcriterion'], playbackKind: undefined },
      ] },
    ])
  })

  it('merges a configured Slice output into its renderable manifest container', () => {
    const groups = [
      { id: 'midspan', name: 'midspan', color: '#fff', visible: false, triangles: 145_136, path: ['slices', 'wake_animation'] },
    ]
    const configured = caseConfiguredVisualizationMembers({
      outputs: [
        { output_type: 'SliceOutput', name: 'wake_animation', private_attribute_id: 'slice-1' },
      ],
    }, ['slices'])

    expect(caseVisualizationSections(groups, true, configured)[0].members).toMatchObject([{
      name: 'wake_animation',
      entityIds: ['midspan'],
      triangles: 145_136,
      playbackKind: 'slices',
      source: 'manifest',
    }])
  })
})

describe('Case object field capabilities', () => {
  const entities = [
    { id: 'wall', name: 'Wall', type: 'Face', parentId: 'body', children: [], fields: ['Cp', 'yPlus'] },
    { id: 'qcriterion', name: 'Q', type: 'SolidGeometry', parentId: 'isosurfaces', children: [], fields: ['Mach'] },
    { id: 'streamline', name: 'Wake', type: 'SolidGeometry', parentId: 'streamlines', children: [], fields: [] },
  ]

  it('returns only fields physically present on the selected render entity', () => {
    expect(caseObjectFieldNames(entities, 'wall')).toEqual(['Cp', 'yPlus'])
    expect(caseObjectFieldNames(entities, 'qcriterion')).toEqual(['Mach'])
    expect(caseObjectFieldNames(entities, 'streamline')).toEqual([])
    expect(caseObjectFieldNames(entities, null)).toEqual([])
  })

  it('clears a field that is not supported by the next selection', () => {
    expect(caseFieldForSelection('Cp', ['Cp', 'yPlus'])).toBe('Cp')
    expect(caseFieldForSelection('Cp', ['Mach'])).toBeNull()
    expect(caseFieldForSelection('Mach', [])).toBeNull()
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

  it('makes Slice and Surface time-series archives playable without misclassifying Volume snapshots', () => {
    expect(timeSeriesArchiveKind({ path: 'results/slices.tar.gz' })).toBe('slices')
    expect(timeSeriesArchiveKind({ path: 'results/surfaces.tar.gz' })).toBe('surfaces')
    expect(timeSeriesArchiveKind({ name: 'surfaces.tar.gz' })).toBe('surfaces')
    expect(timeSeriesArchiveKind({ path: 'results/volumes.tar.gz' })).toBeNull()
    expect(isVolumeSnapshotArchive({ path: 'results/volumes.tar.gz' })).toBe(true)
    expect(findTimeSeriesArchives([
      { path: 'results/surfaces.tar.gz' },
      { path: 'results/volumes.tar.gz' },
      { path: 'results/slices.tar.gz' },
    ]).map(({ kind }) => kind)).toEqual(['surfaces', 'slices'])
  })
})
