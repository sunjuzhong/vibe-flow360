import { describe, expect, it } from 'vitest'
import { importPlanRequestPath } from './client'

describe('import request metadata', () => {
  it('encodes reviewed form metadata into the API query', () => {
    const form = new FormData()
    form.set('name', ' T01 experiment ')
    form.set('source_type', 'geometry')
    form.set('unit', 'm')
    form.set('workflow', 'standard')
    form.set('solver_version', 'release-25.10')
    form.set('folder_id', 'folder-1')
    form.set('tags', 'tutorial,T01')
    form.set('files', new Blob(['geometry']), 'geometry.csm')

    const path = importPlanRequestPath(form)
    const url = new URL(path, 'http://localhost')
    expect(url.pathname).toBe('/api/imports')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      name: 'T01 experiment',
      source_type: 'geometry',
      unit: 'm',
      workflow: 'standard',
      solver_version: 'release-25.10',
      folder_id: 'folder-1',
      tags: 'tutorial,T01',
    })
  })
})
