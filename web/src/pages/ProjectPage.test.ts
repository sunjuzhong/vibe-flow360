import { describe, expect, it } from 'vitest'
import type { ProjectItem, ProjectSyncManifest } from '../api/client'
import { geometryContextId, projectSyncProgress } from './ProjectPage'

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
