import { describe, expect, it } from 'vitest'
import { buildFlow360ProjectUrl, buildFlow360ResourceUrl, getFlow360Domain } from './flow360Urls'

describe('Flow360 workbench URLs', () => {
  it('maps supported environments and falls back to production', () => {
    expect(getFlow360Domain('dev')).toBe('flow360.dev-simulation.cloud')
    expect(getFlow360Domain('development')).toBe('flow360.dev-simulation.cloud')
    expect(getFlow360Domain('UAT')).toBe('flow360.uat-simulation.cloud')
    expect(getFlow360Domain('unknown')).toBe('flow360.simulation.cloud')
  })

  it('encodes project and resource identifiers', () => {
    expect(buildFlow360ProjectUrl('prod', 'project/one'))
      .toBe('https://flow360.simulation.cloud/workbench/project%2Fone')
    expect(buildFlow360ResourceUrl('uat', 'project one', 'case/one', 'Case'))
      .toBe('https://flow360.uat-simulation.cloud/workbench/project%20one?id=case%2Fone&type=Case')
  })
})
