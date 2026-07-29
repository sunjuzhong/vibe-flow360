import { describe, expect, it } from 'vitest'
import type { ProjectSyncManifest } from '../api/client'
import { projectSyncProgress } from './ProjectPage'

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
