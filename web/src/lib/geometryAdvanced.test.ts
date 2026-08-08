import { describe, expect, it } from 'vitest'
import { translate } from '../i18n/translations'
import {
  geometryDiagnosticAgentAction,
  geometryReviewTemplates,
  localizeDiagnosticCapability,
  localizeDiagnosticFinding,
} from './geometryAdvanced'

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

  it('localizes server-backed capability and finding keys without losing unknown fallbacks', () => {
    const t = (value: string) => translate(value, 'zh-CN')
    expect(localizeDiagnosticCapability({
      key: 'curvature-analysis',
      status: 'proxy',
      detail: 'backend detail',
    }, t)).toEqual({
      label: '曲率分析',
      status: '代理',
      detail: '使用每个面的最大离散法向变化，并非 CAD 曲率半径。',
    })
    expect(localizeDiagnosticFinding({
      id: 'gap-analysis-unavailable',
      kind: 'gap',
      severity: 'unknown',
      title: 'backend title',
      detail: 'backend detail',
      recommendation: 'backend recommendation',
    }, t)).toEqual({
      title: '间隙分析不可用',
      detail: '同步的可视化证据中没有多实体距离结果。',
      recommendation: '应用间隙容差前，请使用 CAD 内核或网格器支持的间隙诊断。',
    })
    expect(localizeDiagnosticFinding({
      id: 'future-check',
      kind: 'future',
      severity: 'info',
      title: 'Future title',
      detail: 'Future detail',
    }, t)).toEqual({ title: 'Future title', detail: 'Future detail', recommendation: '' })
  })
})
