import { describe, expect, it } from 'vitest'
import { VIEWER_ANNOTATION_SCHEMA_VERSION, type ViewerAnnotation } from './types'
import {
  areCoordinateFramesCompatible,
  isAnnotationCompatible,
  resolveCompatibleAnnotations,
} from './compatibility'

function annotation(overrides: Partial<ViewerAnnotation> = {}): ViewerAnnotation {
  const resourceRef = { id: 'mesh-1', type: 'surface-mesh', version: 'v1' }
  return {
    schemaVersion: VIEWER_ANNOTATION_SCHEMA_VERSION,
    id: 'ann-1',
    projectId: 'project-1',
    resourceRef,
    coordinateFrame: { kind: 'asset-local', resourceRef },
    toolId: 'distance',
    points: [],
    result: { distance: 1 },
    style: {},
    visible: true,
    createdAt: '2026-08-03T00:00:00Z',
    updatedAt: '2026-08-03T00:00:00Z',
    ...overrides,
  }
}

describe('viewer annotation compatibility', () => {
  const viewer = {
    projectId: 'project-1',
    resourceRef: { id: 'mesh-1', type: 'surface-mesh', version: 'v1' },
    coordinateFrame: {
      kind: 'asset-local' as const,
      resourceRef: { id: 'mesh-1', type: 'surface-mesh', version: 'v1' },
    },
  }

  it('requires the same project, source resource and asset-local frame', () => {
    expect(isAnnotationCompatible(annotation(), viewer)).toBe(true)
    expect(isAnnotationCompatible(annotation({ projectId: 'project-2' }), viewer)).toBe(false)
    expect(isAnnotationCompatible(annotation({
      resourceRef: { id: 'mesh-2', type: 'surface-mesh', version: 'v1' },
    }), viewer)).toBe(false)
    expect(areCoordinateFramesCompatible(
      { kind: 'asset-local', resourceRef: viewer.resourceRef },
      { kind: 'asset-local', resourceRef: { ...viewer.resourceRef, version: 'v2' } },
    )).toBe(false)
  })

  it('only resolves visible annotations compatible with the current viewer', () => {
    expect(resolveCompatibleAnnotations([
      annotation(),
      annotation({ id: 'hidden', visible: false }),
      annotation({ id: 'other-project', projectId: 'project-2' }),
      annotation({ id: 'world', coordinateFrame: { kind: 'world' } }),
    ], viewer).map(({ id }) => id)).toEqual(['ann-1'])
  })

  it('accepts a world annotation only in a world-frame viewer of its source resource', () => {
    const worldAnnotation = annotation({ coordinateFrame: { kind: 'world' } })
    expect(isAnnotationCompatible(worldAnnotation, {
      ...viewer,
      coordinateFrame: { kind: 'world' },
    })).toBe(true)
  })
})
