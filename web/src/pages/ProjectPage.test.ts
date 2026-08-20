import { describe, expect, it } from 'vitest'
import type { ProjectItem, ProjectSyncManifest, ResourceNode } from '../api/client'
import {
  draftCreationBase,
  draftSourceNode,
  draftSourceResource,
  geometryContextId,
  hydrateResourceDetail,
  initialProjectPanel,
  isDraftDetailFor,
  mergeDraftAssetTopology,
  panelDismissesFromAmbientInteraction,
  projectDraftResourcePath,
  projectDraftRootPath,
  projectResourceSelectionPath,
  projectSyncProgress,
  resolveActiveDraftId,
  resourceContextLabel,
  resourceEstimatedSizeBytes,
  resourceStageLinks,
  resourceTransitionProgress,
  estimatedResourceLoadDurationMs,
} from './ProjectPage'

describe('Project panel defaults', () => {
  it('opens Project resources on first entry', () => {
    expect(initialProjectPanel).toBeNull()
  })

  it('keeps Draft parameters open for outside clicks and Escape', () => {
    expect(panelDismissesFromAmbientInteraction('parameters')).toBe(false)
    expect(panelDismissesFromAmbientInteraction('resources')).toBe(true)
    expect(panelDismissesFromAmbientInteraction('details')).toBe(true)
    expect(panelDismissesFromAmbientInteraction(null)).toBe(true)
  })
})

describe('resourceStageLinks', () => {
  const root: ResourceNode = {
    id: 'geo-1',
    name: 'Geometry',
    type: 'Geometry',
    children: [{
      id: 'sm-1',
      name: 'Surface',
      type: 'SurfaceMesh',
      children: [{
        id: 'vm-1',
        name: 'Volume',
        type: 'VolumeMesh',
        children: [{ id: 'case-1', name: 'Case', type: 'Case', children: [] }],
      }],
    }],
  }
  const items: ProjectItem[] = [
    { id: 'geo-1', name: 'Geometry', type: 'Geometry', parent_id: null },
    { id: 'sm-1', name: 'Surface', type: 'SurfaceMesh', parent_id: 'geo-1' },
    { id: 'vm-1', name: 'Volume', type: 'VolumeMesh', parent_id: 'sm-1' },
    { id: 'case-1', name: 'Case', type: 'Case', parent_id: 'vm-1' },
  ]

  it('resolves the full upstream chain for a selected Case', () => {
    expect(resourceStageLinks(['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case'], root, items, 'case-1').map((link) => link.resource?.id)).toEqual([
      'geo-1', 'sm-1', 'vm-1', 'case-1',
    ])
  })

  it('resolves downstream resources from the selected branch when they exist', () => {
    expect(resourceStageLinks(['Geometry', 'SurfaceMesh', 'VolumeMesh', 'Case'], root, items, 'sm-1').map((link) => link.resource?.id)).toEqual([
      'geo-1', 'sm-1', 'vm-1', 'case-1',
    ])
  })
})

describe('resourceContextLabel', () => {
  it('does not repeat a Project name for its same-named root resource', () => {
    expect(resourceContextLabel('Cylinder wake', 'Cylinder wake', 'Geometry')).toBe('Geometry resource')
    expect(resourceContextLabel('Cylinder wake', 'Baseline mesh', 'SurfaceMesh')).toBe('Baseline mesh')
  })
})

function manifest(values: Partial<ProjectSyncManifest>): ProjectSyncManifest {
  return {
    schema_version: 1,
    project_id: 'prj-1',
    namespace: 'production-default',
    local_path: '/tmp/projects/production-default/prj-1',
    artifact_policy: 'metadata-only',
    status: 'syncing',
    total_resources: 10,
    synced_resources: 0,
    failed_resources: 0,
    failures: {},
    resources: {},
    started_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...values,
  }
}

describe('projectSyncProgress', () => {
  it('counts both completed and failed resources as finished work', () => {
    expect(projectSyncProgress(manifest({
      synced_resources: 6,
      failed_resources: 2,
    }))).toBe(80)
  })

  it('keeps an indeterminate synchronization visible', () => {
    expect(projectSyncProgress(null)).toBe(4)
    expect(projectSyncProgress(manifest({ total_resources: 0 }))).toBe(4)
  })
})

describe('resource load estimates', () => {
  it('prefers the largest available resource-size signal', () => {
    const sync = manifest({
      resources: {
        'Geometry/geo-1': {
          id: 'geo-1',
          type: 'Geometry',
          status: 'completed',
          artifacts: {
            mesh: { path: 'mesh.bin', local_path: 'mesh.bin', size_bytes: 24_000_000, status: 'ready', synced_at: '' },
          },
        },
      },
    })
    expect(resourceEstimatedSizeBytes(
      { id: 'geo-1', name: 'Wing', type: 'Geometry', parent_id: null, size_bytes: 8_000_000 },
      { id: 'geo-1', type: 'Geometry', info: { size_bytes: 12_000_000 } },
      sync,
    )).toBe(24_000_000)
  })

  it('uses a conservative fallback and caps very large estimates', () => {
    expect(estimatedResourceLoadDurationMs()).toBe(12_000)
    expect(estimatedResourceLoadDurationMs(1024)).toBe(6_000)
    expect(estimatedResourceLoadDurationMs(10 * 1024 * 1024 * 1024)).toBe(60_000)
  })
})

describe('resourceTransitionProgress', () => {
  it('advances through detail, manifest, and measured asset loading', () => {
    expect(resourceTransitionProgress(false, false)).toEqual({ active: true, progress: 4, phase: 'detail' })
    expect(resourceTransitionProgress(true, false, { status: 'idle' })).toEqual({ active: true, progress: 4, phase: 'preview' })
    expect(resourceTransitionProgress(true, false, { status: 'loading', progress: 0.5 }))
      .toEqual({ active: true, progress: 49, phase: 'asset' })
  })

  it('finishes only after detail hydration, or immediately after a detail failure', () => {
    expect(resourceTransitionProgress(true, false, { status: 'ready' })).toEqual({ active: false, progress: 100, phase: 'complete' })
    expect(resourceTransitionProgress(false, false, { status: 'ready' })).toEqual({ active: true, progress: 4, phase: 'detail' })
    expect(resourceTransitionProgress(false, false, { status: 'error', message: 'preview unavailable' }))
      .toEqual({ active: true, progress: 4, phase: 'detail' })
    expect(resourceTransitionProgress(false, true)).toEqual({ active: false, progress: 100, phase: 'complete' })
  })

  it('keeps entry covered when cached preview wins the race with Case detail hydration', () => {
    const transition = resourceTransitionProgress(false, false, { status: 'ready' })

    expect(transition.active).toBe(true)
    expect(transition.phase).toBe('detail')
  })
})

describe('hydrateResourceDetail', () => {
  it('does not refetch an immutable complete Case snapshot', async () => {
    const calls: boolean[] = []
    const result = await hydrateResourceDetail(async (cacheOnly) => {
      calls.push(cacheOnly)
      if (!cacheOnly) throw new Error('live detail should not be requested')
      return {
        data: {
          id: 'case-1',
          type: 'Case',
          state: { status: 'completed' },
          simulation_params: { version: '1' },
          results: { records: [] },
        },
        source: 'cache',
      }
    }, true, () => {})

    expect(calls).toEqual([true])
    expect(result).toEqual({ cachedLoaded: true, liveLoaded: false })
  })

  it('does not repeat a failed large SimulationParams fetch for a terminal Case', async () => {
    const calls: boolean[] = []
    const result = await hydrateResourceDetail(async (cacheOnly) => {
      calls.push(cacheOnly)
      if (!cacheOnly) throw new Error('live detail should not be requested')
      return {
        data: {
          id: 'case-1',
          type: 'Case',
          state: { status: 'completed' },
          results: { records: [{ path: 'results/total_forces_v2.csv' }] },
          errors: { simulation_params: 'response exceeds 128 MiB' },
        },
        source: 'cache',
      }
    }, true, () => {})

    expect(calls).toEqual([true])
    expect(result).toEqual({ cachedLoaded: true, liveLoaded: false })
  })

  it('renders metadata cache first and then replaces it with full live Case detail', async () => {
    const calls: boolean[] = []
    const snapshots: string[] = []
    const result = await hydrateResourceDetail(async (cacheOnly) => {
      calls.push(cacheOnly)
      return cacheOnly
        ? { data: { id: 'case-1', type: 'Case', state: { status: 'completed' } }, source: 'cache' }
        : {
            data: {
              id: 'case-1',
              type: 'Case',
              state: { status: 'completed' },
              results: { records: [{ path: 'results/slices.tar.gz' }] },
            },
            source: 'live',
          }
    }, true, (response) => snapshots.push(`${response.source}:${response.data.results?.records?.length ?? 0}`))

    expect(calls).toEqual([true, false])
    expect(snapshots).toEqual(['cache:0', 'live:1'])
    expect(result).toEqual({ cachedLoaded: true, liveLoaded: true })
  })

  it('keeps the cached detail usable when the live refresh is unavailable', async () => {
    const snapshots: string[] = []
    const result = await hydrateResourceDetail(async (cacheOnly) => {
      if (!cacheOnly) throw new Error('offline')
      return { data: { id: 'case-1', type: 'Case' }, source: 'cache' }
    }, true, (response) => snapshots.push(response.source))

    expect(snapshots).toEqual(['cache'])
    expect(result.cachedLoaded).toBe(true)
    expect(result.liveLoaded).toBe(false)
    expect(result.error).toEqual(new Error('offline'))
  })
})

describe('geometryContextId', () => {
  const items: ProjectItem[] = [
    { id: 'geo-1', name: 'Geometry', type: 'Geometry', parent_id: null },
    { id: 'sm-1', name: 'Surface', type: 'SurfaceMesh', parent_id: 'geo-1' },
    { id: 'vm-1', name: 'Volume', type: 'VolumeMesh', parent_id: 'sm-1' },
    { id: 'case-1', name: 'Case', type: 'Case', parent_id: 'vm-1' },
  ]

  it('walks the selected CFD branch back to its Geometry', () => {
    expect(geometryContextId(items, 'case-1')).toBe('geo-1')
    expect(geometryContextId(items, 'vm-1')).toBe('geo-1')
  })

  it('falls back to the available Geometry when a parent is missing', () => {
    expect(geometryContextId(items, 'unknown')).toBe('geo-1')
  })
})

describe('Draft source resource context', () => {
  const items: ProjectItem[] = [
    { id: 'geo-1', name: 'Created Geometry', type: 'Geometry', parent_id: null },
    { id: 'vm-1', name: 'Volume Mesh', type: 'VolumeMesh', parent_id: 'geo-1' },
  ]

  it('uses the resource that the Draft was created from', () => {
    expect(draftSourceResource(items, {
      id: 'draft-1', name: 'Baseline', source_item_id: 'vm-1',
    }, null)?.id).toBe('vm-1')
  })

  it('falls back to Draft detail metadata when the list omits its source', () => {
    expect(draftSourceResource(items, { id: 'draft-1', name: 'Baseline' }, {
      id: 'draft-1', type: 'Draft', info: { source_id: 'geo-1' },
    })?.id).toBe('geo-1')
  })

  it('binds Draft actions to the actual source node instead of the visible Project root', () => {
    const root = {
      id: 'geo-1', name: 'Created Geometry', type: 'Geometry', children: [
        { id: 'vm-1', name: 'Volume Mesh', type: 'VolumeMesh', children: [] },
      ],
    }
    expect(draftSourceNode(root, items, {
      id: 'draft-1', name: 'Baseline', source_item_id: 'vm-1',
    }, null)).toEqual(root.children[0])
  })

  it('does not reuse stale detail metadata while switching Drafts', () => {
    expect(draftSourceResource(items, { id: 'draft-2', name: 'Variant' }, {
      id: 'draft-1', type: 'Draft', info: { source_id: 'geo-1' },
    })).toBeNull()
  })

  it('treats the live Draft detail as authoritative over stale list metadata', () => {
    expect(draftSourceResource(items, {
      id: 'draft-1', name: 'Baseline', source_item_id: 'vm-1',
    }, {
      id: 'draft-1', type: 'Draft', info: { source_id: 'geo-1' },
    })?.id).toBe('geo-1')
  })

  it('keeps the Draft query while the initial Project route resolves its resource', () => {
    expect(projectDraftResourcePath('prj-1', 'geo-1', 'draft/1')).toBe('/projects/prj-1/resources/geo-1?draft=draft%2F1')
  })

  it('keeps every Draft context on the Project tree root', () => {
    expect(projectDraftRootPath('prj-1', { id: 'geo-root' }, 'draft-1'))
      .toBe('/projects/prj-1/resources/geo-root?draft=draft-1')
  })

  it('keeps the active Draft query when selecting its source resource from the header or tree', () => {
    expect(projectResourceSelectionPath('prj-1', 'geo-1', 'draft-1'))
      .toBe('/projects/prj-1/resources/geo-1?draft=draft-1')
  })

  it('uses the Draft requested by the URL instead of retaining another active Draft', () => {
    const drafts = [
      { id: 'draft-old', name: 'Old Draft' },
      { id: 'draft-created', name: 'Created Draft' },
    ]
    expect(resolveActiveDraftId(drafts, 'draft-old', 'draft-created')).toBe('draft-created')
  })
})

describe('Current Draft identity', () => {
  it('accepts parameters only from the currently selected Draft', () => {
    expect(isDraftDetailFor('draft-current', { id: 'draft-current', type: 'Draft' })).toBe(true)
    expect(isDraftDetailFor('draft-current', { id: 'draft-other', type: 'Draft' })).toBe(false)
    expect(isDraftDetailFor('draft-current', { id: 'draft-current', type: 'Case' })).toBe(false)
  })
})

describe('Draft Geometry topology context', () => {
  it('restores missing selection-group metadata from the source Geometry', () => {
    const source = {
      private_attribute_asset_cache: {
        project_entity_info: {
          face_group_tag: 'faceName',
          grouped_faces: [[{ name: 'wing' }]],
          grouped_bodies: [[{ name: 'body00001' }]],
          bodies_face_edge_ids: { body00001: { face_ids: ['face-1'], edge_ids: ['edge-1'] } },
          draft_entities: [{ name: 'source-only' }],
        },
      },
    }
    const draft = {
      private_attribute_asset_cache: {
        project_entity_info: {
          grouped_faces: [],
          draft_entities: [{ name: 'draft-box' }],
        },
      },
    }

    const merged = mergeDraftAssetTopology(source, draft)
    const info = (merged.private_attribute_asset_cache as any).project_entity_info
    expect(info.face_group_tag).toBe('faceName')
    expect(info.grouped_faces).toEqual([[{ name: 'wing' }]])
    expect(info.grouped_bodies).toEqual([[{ name: 'body00001' }]])
    expect(info.bodies_face_edge_ids.body00001.edge_ids).toEqual(['edge-1'])
    expect(info.draft_entities).toEqual([{ name: 'draft-box' }])
  })

  it('keeps non-empty Draft topology metadata authoritative', () => {
    const source = {
      private_attribute_asset_cache: {
        project_entity_info: { grouped_faces: [[{ name: 'source-wing' }]] },
      },
    }
    const draft = {
      private_attribute_asset_cache: {
        project_entity_info: { grouped_faces: [[{ name: 'draft-wing' }]] },
      },
    }

    expect((mergeDraftAssetTopology(source, draft).private_attribute_asset_cache as any)
      .project_entity_info.grouped_faces).toEqual([[{ name: 'draft-wing' }]])
  })

  it('treats nested empty grouping schemes as missing topology', () => {
    const source = {
      private_attribute_asset_cache: {
        project_entity_info: { grouped_bodies: [[{ name: 'source-body' }]] },
      },
    }
    const draft = {
      private_attribute_asset_cache: {
        project_entity_info: { grouped_bodies: [[]] },
      },
    }

    expect((mergeDraftAssetTopology(source, draft).private_attribute_asset_cache as any)
      .project_entity_info.grouped_bodies).toEqual([[{ name: 'source-body' }]])
  })
})

describe('Draft creation base', () => {
  const items: ProjectItem[] = [
    { id: 'vm-1', name: 'Volume mesh', type: 'VolumeMesh', parent_id: null },
    { id: 'case-1', name: 'Errored case', type: 'Case', parent_id: 'vm-1' },
  ]

  it('recreates an errored resource from its parent while preserving its parameters', () => {
    const simulationParams = { time_stepping: { steps: 1500 } }
    expect(draftCreationBase(items, items[1], {
      id: 'case-1',
      type: 'Case',
      state: { status: 'error' },
      simulation_params: simulationParams,
    })).toEqual({ source: items[0], simulationParams })
  })

  it('forks a healthy resource directly', () => {
    expect(draftCreationBase(items, items[1], {
      id: 'case-1',
      type: 'Case',
      state: { status: 'completed' },
      simulation_params: { preserved: true },
    })).toEqual({ source: items[1] })
  })
})
