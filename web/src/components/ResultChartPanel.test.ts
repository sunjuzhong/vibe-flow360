import { describe, expect, it } from 'vitest'
import { parseResultTable } from './ResultTablePreview'
import { datasetCompatibility, profileResultTable, recommendResultChart } from './ResultChartPanel'

describe('result chart inference', () => {
  it('uses row index by default even for a monotonic solver step', () => {
    const table = parseResultTable('pseudo_step,residual,force\n1,1,0.2\n2,0.01,0.3\n3,0.0001,0.4', 'residual.csv')
    const recommendation = recommendResultChart(table)

    expect(recommendation.xColumn).toBeNull()
    expect(recommendation.kind).toBe('line')
    expect(recommendation.scale).toBe('log')
    expect(recommendation.yColumns).toContain('residual')
  })

  it('uses row index when physical and pseudo steps repeat or reset', () => {
    const table = parseResultTable('physical_step,pseudo_step,linearIterations,0_cont,1_momx\n0,10,6,1,0.5\n0,20,7,0.1,0.05\n0,30,5,0.01,0.005', 'linear.csv')
    const recommendation = recommendResultChart(table)

    expect(recommendation.xColumn).toBeNull()
    expect(recommendation.yColumns.slice(0, 2)).toEqual(['0_cont', '1_momx'])
    expect(recommendation.scale).toBe('log')
  })

  it('keeps compact categorical columns available without selecting them by default', () => {
    const table = parseResultTable('surface,drag\nwing,10\ntail,3\nbody,6', 'forces.csv')
    const recommendation = recommendResultChart(table)

    expect(recommendation.xColumn).toBeNull()
    expect(recommendation.kind).toBe('line')
    expect(recommendation.yColumns).toEqual(['drag'])
    expect(recommendation.profiles.some((profile) => profile.name === 'surface')).toBe(true)
  })

  it('profiles mixed columns without treating sparse text as numeric', () => {
    const table = parseResultTable('step,value,label\n1,0.2,a\n2,,b\n3,0.4,c', 'mixed.csv')
    const profiles = profileResultTable(table)

    expect(profiles.find((profile) => profile.name === 'step')?.monotonic).toBe(true)
    expect(profiles.find((profile) => profile.name === 'value')?.numeric).toBe(true)
    expect(profiles.find((profile) => profile.name === 'label')?.numeric).toBe(false)
  })
})

describe('datasetCompatibility', () => {
  it('accepts equal-length datasets with shared numeric columns', () => {
    const base = parseResultTable('step,force\n1,0.2\n2,0.3', 'x.csv')
    const candidate = parseResultTable('step,force,heat\n1,0.4,3\n2,0.5,4', 'y.csv')
    const result = datasetCompatibility(base, candidate)

    expect(result.compatible).toBe(true)
    expect(result.commonNumeric).toEqual(['step', 'force'])
  })

  it('rejects row-count and shared-column mismatches with a reason', () => {
    const base = parseResultTable('step,force\n1,0.2\n2,0.3', 'x.csv')
    const short = parseResultTable('step,force\n1,0.4', 'short.csv')
    const different = parseResultTable('iteration,heat\n1,3\n2,4', 'different.csv')

    expect(datasetCompatibility(base, short).reason).toContain('Row count differs')
    expect(datasetCompatibility(base, different).reason).toContain('No shared numeric measurement columns')
  })
})
