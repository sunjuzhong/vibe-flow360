import { describe, expect, it } from 'vitest'
import {
  mergeTutorialPatch,
  t01Baseline,
  t01ParamsForAlpha,
  tutorialProgress,
  validateT01Setup,
} from './t01'

describe('T01 browser tutorial', () => {
  it('uses the committed SimulationParams artifact as its baseline', () => {
    const checks = validateT01Setup(t01Baseline)
    expect(checks).toHaveLength(6)
    expect(checks.every((check) => check.passed)).toBe(true)
  })

  it('applies only the controlled five-degree patch', () => {
    const variant = t01ParamsForAlpha(5)
    const condition = variant.operating_condition as Record<string, Record<string, unknown>>
    const baselineCondition = t01Baseline.operating_condition as Record<string, Record<string, unknown>>

    expect(condition.alpha.value).toBe(5)
    expect(condition.private_attribute_input_cache.alpha).toEqual({ units: 'degree', value: 5 })
    expect(condition.velocity_magnitude).toEqual(baselineCondition.velocity_magnitude)
    expect(variant.meshing).toEqual(t01Baseline.meshing)
    expect(variant.models).toEqual(t01Baseline.models)
  })

  it('implements RFC 7396 deletion without mutating the source', () => {
    const source = { nested: { keep: 1, remove: 2 } }
    expect(mergeTutorialPatch(source, { nested: { remove: null } })).toEqual({ nested: { keep: 1 } })
    expect(source.nested.remove).toBe(2)
  })

  it('counts only known, unique lesson steps', () => {
    expect(tutorialProgress(['question', 'question', 'unknown'])).toBe(17)
    expect(tutorialProgress(['question', 'geometry', 'setup', 'variant', 'evidence', 'run'])).toBe(100)
  })
})
