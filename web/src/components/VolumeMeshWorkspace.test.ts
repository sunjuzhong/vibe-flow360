import { describe, expect, it } from 'vitest'
import type { ResourceDetail } from '../api/client'
import { computeReadiness } from './VolumeMeshWorkspace'

function buildDetail(status: string, summary?: Record<string, unknown>, errors?: Record<string, unknown>): ResourceDetail {
  return {
    type: 'VolumeMesh',
    id: 'vm-1',
    info: { name: 'test' } as ResourceDetail['info'],
    state: { status } as ResourceDetail['state'],
    summary: (summary ?? {}) as ResourceDetail['summary'],
    simulation_params: {},
    errors: (errors ?? {}) as ResourceDetail['errors'],
    results: null as unknown as ResourceDetail['results'],
  }
}

describe('computeReadiness', () => {
  it('marks success terminal state as ready', () => {
    const checks = computeReadiness(buildDetail('completed'))
    expect(checks[0].status).toBe('ready')
  })

  it('marks failed state as blocked', () => {
    const checks = computeReadiness(buildDetail('failed'))
    expect(checks[0].status).toBe('blocked')
    expect(checks[0].hint).toContain('failed')
  })

  it('marks running state as warning', () => {
    const checks = computeReadiness(buildDetail('running'))
    expect(checks[0].status).toBe('warning')
  })

  it('extracts cell count when present', () => {
    const checks = computeReadiness(buildDetail('completed', { cell_count: 12345 }))
    const cellCheck = checks.find((c) => c.label.includes('Cell count'))
    expect(cellCheck?.status).toBe('ready')
    expect(cellCheck?.hint).toContain('12,345')
  })

  it('reports missing cell count when absent', () => {
    const checks = computeReadiness(buildDetail('completed', {}))
    const cellCheck = checks.find((c) => c.label.includes('Cell count'))
    expect(cellCheck?.status).toBe('missing')
  })

  it('reports quality indicators when present', () => {
    const checks = computeReadiness(
      buildDetail('completed', { max_skewness: 0.82, min_orthogonality: 0.3 }),
    )
    const qualityCheck = checks.find((c) => c.label.includes('quality'))
    expect(qualityCheck?.status).toBe('ready')
  })

  it('marks partial read errors as warning', () => {
    const checks = computeReadiness(buildDetail('completed', { cell_count: 100 }, { summary: 'timeout' }))
    const errorCheck = checks.find((c) => c.label.includes('partial'))
    expect(errorCheck?.status).toBe('warning')
  })

  it('extracts metrics via aliases', () => {
    const checks = computeReadiness(buildDetail('completed', { num_cells: 42 }))
    const cellCheck = checks.find((c) => c.label.includes('Cell count'))
    expect(cellCheck?.status).toBe('ready')
    expect(cellCheck?.hint).toContain('42')
  })
})
