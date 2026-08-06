import { describe, expect, it } from 'vitest'
import type { ProjectItem, ProjectSyncManifest } from '../api/client'
import { draftsForResource, geometryContextId, initialProjectPanel, projectSyncProgress, resourceContextLabel } from './ProjectPage'

describe('Project panel defaults', () => {
  it('opens Project resources on first entry', () => {
    expect(initialProjectPanel).toBeNull()
  })
})

describe('resourceContextLabel', () => {
  it('does not repeat a Project name for its same-named root resource', () => {
    expect(resourceContextLabel('Cylinder wake', 'Cylinder wake', 'Geometry')).toBe('Geometry resource')
    expect(resourceContextLabel('Cylinder wake', 'Baseline mesh', 'SurfaceMesh')).toBe('Baseline mesh')
  })
})

describe('draftsForResource', () => {
  it('links Drafts to their source Resource by stable ID instead of name', () => {
    const drafts = [
      { id: 'draft-1', name: 'Same name', source_id: 'geo-1' },
      { id: 'draft-2', name: 'Same name', source_id: 'sm-1' },
      { id: 'draft-3', name: 'Legacy Draft' },
    ]

    expect(draftsForResource(drafts, 'geo-1').map((draft) => draft.id)).toEqual(['draft-1'])
    expect(draftsForResource(drafts, 'sm-1').map((draft) => draft.id)).toEqual(['draft-2'])
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
