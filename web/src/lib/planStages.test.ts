import { describe, expect, it } from 'vitest'
import {
  applyProposalToStagePatches,
  downstreamStages,
  hasPath,
  mergeStagePatches,
  partitionPatchByStages,
  planCompileBlockers,
  stageForPath,
  unwrapSimulationParams,
} from './planStages'

describe('stage-aware simulation planning', () => {
  it('derives exactly the downstream stages selected by Run up to', () => {
    expect(downstreamStages('Geometry', 'surface-mesh')).toEqual(['SurfaceMesh'])
    expect(downstreamStages('Geometry', 'volume-mesh')).toEqual(['SurfaceMesh', 'VolumeMesh'])
    expect(downstreamStages('Geometry', 'case')).toEqual(['SurfaceMesh', 'VolumeMesh', 'Case'])
    expect(downstreamStages('SurfaceMesh', 'volume-mesh')).toEqual(['VolumeMesh'])
    expect(downstreamStages('SurfaceMesh', 'case')).toEqual(['VolumeMesh', 'Case'])
    expect(downstreamStages('VolumeMesh', 'case')).toEqual(['Case'])
    expect(downstreamStages('Case', 'case')).toEqual(['Case'])
    expect(downstreamStages('VolumeMesh', 'surface-mesh')).toEqual([])
  })

  it('partitions one AI patch back into the active route without changing its meaning', () => {
    const stages = downstreamStages('Geometry', 'case')
    const partitioned = partitionPatchByStages({
      meshing: {
        defaults: {
          surface_max_edge_length: { value: 0.1, units: 'meter' },
          boundary_layer_growth_rate: 1.2,
        },
      },
      operating_condition: { alpha: { value: 3, units: 'degree' } },
    }, stages)
    expect(partitioned.SurfaceMesh).toEqual({
      meshing: { defaults: { surface_max_edge_length: { value: 0.1, units: 'meter' } } },
    })
    expect(partitioned.VolumeMesh).toEqual({
      meshing: { defaults: { boundary_layer_growth_rate: 1.2 } },
    })
    expect(partitioned.Case).toEqual({
      operating_condition: { alpha: { value: 3, units: 'degree' } },
    })
    expect(mergeStagePatches(stages, partitioned, {})).toEqual({
      meshing: {
        defaults: {
          surface_max_edge_length: { value: 0.1, units: 'meter' },
          boundary_layer_growth_rate: 1.2,
        },
      },
      operating_condition: { alpha: { value: 3, units: 'degree' } },
    })
  })

  it('deep-merges overlapping meshing defaults without losing either stage', () => {
    expect(mergeStagePatches(
      ['SurfaceMesh', 'VolumeMesh'],
      {
        SurfaceMesh: { meshing: { defaults: { surface_max_edge_length: 0.1 } } },
        VolumeMesh: { meshing: { defaults: { boundary_layer_growth_rate: 1.2 } } },
      },
      { meshing: { refinement_factor: 1.1 } },
    )).toEqual({
      meshing: {
        defaults: {
          surface_max_edge_length: 0.1,
          boundary_layer_growth_rate: 1.2,
        },
        refinement_factor: 1.1,
      },
    })
  })

  it('projects a sparse Agent proposal immediately without erasing existing form edits', () => {
    expect(applyProposalToStagePatches(
      ['Case'],
      {
        SurfaceMesh: {},
        VolumeMesh: {},
        Case: {
          operating_condition: { alpha: { value: 3, units: 'degree' } },
          time_stepping: { max_steps: 2000 },
        },
      },
      {
        models: [{ type: 'Wall', name: 'cylinder' }],
        time_stepping: { max_steps: 20000 },
      },
    ).Case).toEqual({
      operating_condition: { alpha: { value: 3, units: 'degree' } },
      models: [{ type: 'Wall', name: 'cylinder' }],
      time_stepping: { max_steps: 20000 },
    })
  })

  it('reads wrapped Flow360 SimulationParams and assigns paths to stages', () => {
    const params = unwrapSimulationParams({
      simulation_params: { operating_condition: { alpha: 2 }, meshing: { defaults: {} } },
    })
    expect(hasPath(params, 'operating_condition.alpha')).toBe(true)
    expect(stageForPath('meshing.defaults.surface_max_edge_length')).toBe('SurfaceMesh')
    expect(stageForPath('meshing.defaults.boundary_layer_growth_rate')).toBe('VolumeMesh')
    expect(stageForPath('models.0.type')).toBe('Case')
  })

  it('explains every prerequisite that keeps plan compilation disabled', () => {
    expect(planCompileBlockers({
      schemaLoading: false,
      hasSchema: true,
      name: 'Case variation',
    })).toEqual([])
    expect(planCompileBlockers({
      schemaLoading: true,
      hasSchema: false,
      name: '',
    })).toEqual([
      'Flow360 parameter schema is still loading.',
      'Add a plan / run name.',
    ])
    expect(planCompileBlockers({
      schemaLoading: false,
      hasSchema: true,
      name: 'Case variation',
    })).toEqual([])
  })
})
