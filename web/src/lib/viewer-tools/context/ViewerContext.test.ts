import { describe, expect, it } from 'vitest'
import type { ViewerAnnotation } from '../types'
import {
  coordinateFrameIdForAsset,
  createViewerContext,
  findLengthUnit,
  isAnnotationAvailableInContext,
} from './ViewerContext'

function annotation(
  resourceId: string,
  frameResourceId = resourceId,
): ViewerAnnotation {
  const resourceRef = { id: resourceId, type: resourceId.startsWith('geo') ? 'Geometry' : 'Case' }
  const frameResourceRef = {
    id: frameResourceId,
    type: frameResourceId.startsWith('geo') ? 'Geometry' : 'Case',
  }
  return {
    schemaVersion: 1,
    id: `ann-${resourceId}`,
    projectId: 'project-1',
    resourceRef,
    coordinateFrame: { kind: 'asset-local', resourceRef: frameResourceRef },
    toolId: 'distance',
    points: [],
    result: null,
    style: {},
    visible: true,
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
  }
}

describe('ViewerContext', () => {
  it('builds a stable coordinate frame from asset identity, not display data', () => {
    const ref = { id: 'asset/a', type: 'Geometry', version: 'v 2' }
    expect(coordinateFrameIdForAsset(ref)).toBe('asset-local:Geometry:asset%2Fa:v%202')
    expect(coordinateFrameIdForAsset({ ...ref })).toBe(coordinateFrameIdForAsset(ref))
  })

  it('uses the workspace resource for a primary asset', () => {
    const resourceRef = { id: 'case-1', type: 'Case' }
    const context = createViewerContext({
      projectId: 'project-1',
      resourceRef,
      assetSource: 'primary',
      fallbackAssetRef: { id: 'geo-1', type: 'Geometry' },
    })
    expect(context.resourceRef).toEqual(resourceRef)
    expect(context.assetRef).toEqual(resourceRef)
    expect(context.assetSource).toBe('primary')
  })

  it('uses the source Geometry frame for a Case fallback', () => {
    const context = createViewerContext({
      projectId: 'project-1',
      resourceRef: { id: 'case-1', type: 'Case' },
      assetSource: 'fallback',
      fallbackAssetRef: { id: 'geo-1', type: 'Geometry' },
    })
    expect(context.resourceRef).toEqual({ id: 'case-1', type: 'Case' })
    expect(context.assetRef).toEqual({ id: 'geo-1', type: 'Geometry' })
    expect(context.coordinateFrame).toEqual({
      kind: 'asset-local',
      resourceRef: { id: 'geo-1', type: 'Geometry' },
    })
    expect(isAnnotationAvailableInContext(annotation('geo-1'), context)).toBe(true)
    expect(isAnnotationAvailableInContext(annotation('case-1'), context)).toBe(false)
  })

  it('accepts a Case-owned annotation when its frame matches the fallback Geometry', () => {
    const context = createViewerContext({
      projectId: 'project-1',
      resourceRef: { id: 'case-1', type: 'Case' },
      assetSource: 'fallback',
      fallbackAssetRef: { id: 'geo-1', type: 'Geometry' },
    })
    expect(isAnnotationAvailableInContext(annotation('case-1', 'geo-1'), context)).toBe(true)
  })

  it('does not project annotations from another project or hidden records', () => {
    const context = createViewerContext({
      projectId: 'project-1',
      resourceRef: { id: 'case-1', type: 'Case' },
    })
    expect(isAnnotationAvailableInContext({ ...annotation('case-1'), projectId: 'project-2' }, context)).toBe(false)
    expect(isAnnotationAvailableInContext({ ...annotation('case-1'), visible: false }, context)).toBe(false)
  })

  it('finds nested length units and falls back when none are reported', () => {
    expect(findLengthUnit({ meshing: { length_unit: 'mm' } })).toBe('mm')
    expect(findLengthUnit({ solver: { cfl: 1 } })).toBeNull()
  })
})
