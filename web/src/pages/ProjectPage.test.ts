import { describe, expect, it } from 'vitest'
import type { ProjectItem, ProjectSyncManifest } from '../api/client'
import {
  draftCreationBase,
  draftSourceResource,
  geometryContextId,
  initialProjectPanel,
  panelDismissesFromAmbientInteraction,
  projectDraftResourcePath,
  projectSyncProgress,
  resourceContextLabel,
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

  it('does not reuse stale detail metadata while switching Drafts', () => {
    expect(draftSourceResource(items, { id: 'draft-2', name: 'Variant' }, {
      id: 'draft-1', type: 'Draft', info: { source_id: 'geo-1' },
    })).toBeNull()
  })

  it('keeps the Draft query while the initial Project route resolves its resource', () => {
    expect(projectDraftResourcePath('prj-1', 'geo-1', 'draft/1')).toBe('/projects/prj-1/resources/geo-1?draft=draft%2F1')
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
