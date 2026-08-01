import { describe, expect, it } from 'vitest'
import { geometryDiagnosticAgentAction, geometryReviewTemplates } from './geometryAdvanced'

describe('advanced Geometry review', () => {
  it('provides domain-specific review templates', () => {
    expect(geometryReviewTemplates.map((item) => item.id)).toEqual([
      'aircraft', 'automotive', 'rotating-machinery', 'thermal',
    ])
  })

  it('preserves unavailable evidence in a review-only plan', () => {
    const action = geometryDiagnosticAgentAction({
      project: { id: 'prj-1', name: 'Wing' } as never,
      geometryId: 'geo-1',
      geometryName: 'Wing',
      templateId: 'aircraft',
      comparison: null,
      report: {
        schema_version: 1,
        geometry_id: 'geo-1',
        fingerprint: 'abc',
        settings: { small_surface_ratio: 0.1, curvature_angle_deg: 30 },
        capabilities: [{ key: 'gap', status: 'unavailable', detail: 'No distance evidence.' }],
        evidence: [],
        findings: [{ id: 'gap', kind: 'gap', severity: 'unknown', title: 'Gap unavailable', detail: 'No evidence.' }],
        grouping_proposals: [],
      },
    })
    const proposal = action.proposals?.[0]
    expect(proposal?.patch).toEqual({})
    expect(proposal?.fields.find((field) => field.key === 'geometry_diagnostic_findings')).toBeTruthy()
    expect(proposal?.validation_hints).toContain('Do not treat unavailable diagnostic checks as passed: gap')
  })
})
