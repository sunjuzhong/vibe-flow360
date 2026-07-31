import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { applyFieldColoring, buildUVFAsset, collectFieldValues, createFieldHistogram, extractFieldCatalog, parseUVFManifest, probeFieldAtIntersection, safeUVFBufferPath, setEntityVisibility } from '.'

describe('Flow360 UVF Three.js library', () => {
  it('decodes indexed faces and edge positions', () => {
    const manifest = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        attributions: { faces: ['face-1'], edges: ['edge-1'] },
        resources: {
          buffers: {
            type: 'buffers',
            path: 'body.bin',
            sections: [
              { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 12 },
              { name: 'position', dType: 'float32', dimension: 3, offset: 12, length: 36 },
              { name: 'normal', dType: 'float32', dimension: 3, offset: 48, length: 36 },
              { name: 'edgePosition', dType: 'float32', dimension: 3, offset: 84, length: 24 },
            ],
          },
        },
      },
      {
        id: 'face-1',
        name: 'Face 1',
        type: 'Face',
        attributions: { packedParentId: 'body-1' },
        properties: {
          bufferLocations: { indices: [{ bufNum: 0, startIndex: 0, endIndex: 3 }] },
        },
      },
      {
        id: 'edge-1',
        name: 'Edge 1',
        type: 'Edge',
        attributions: { packedParentId: 'body-1' },
        properties: {
          bufferLocations: { indices: [{ bufNum: 0, startIndex: 0, endIndex: 6 }] },
        },
      },
    ])
    const data = new ArrayBuffer(108)
    new Uint32Array(data, 0, 3).set([0, 1, 2])
    new Float32Array(data, 12, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])
    new Float32Array(data, 48, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1])
    new Float32Array(data, 84, 6).set([0, 0, 0, 1, 0, 0])

    const asset = buildUVFAsset(manifest, new Map([['body.bin', data]]))
    expect(asset.faces).toBe(1)
    expect(asset.edges).toBe(1)
    expect(asset.vertices).toBe(3)
    expect(asset.triangles).toBe(1)
    expect(asset.object.children).toHaveLength(1)
    expect(asset.getEntityObject('face-1')?.parent).toBe(asset.getEntityObject('body-1'))
    expect(asset.getEntityObject('edge-1')?.parent).toBe(asset.getEntityObject('body-1'))
    asset.dispose()
  })

  it('rejects traversal and unsupported buffers', () => {
    for (const path of ['../body.bin', '/body.bin', 'body.glb', 'nested//body.bin', String.raw`nested\body.bin`]) {
      expect(() => safeUVFBufferPath(path)).toThrow()
    }
  })

  it('extracts field catalog from non-structural sections', () => {
    const entries = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        resources: {
          buffers: {
            type: 'buffers',
            path: 'body.bin',
            sections: [
              { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 12 },
              { name: 'position', dType: 'float32', dimension: 3, offset: 12, length: 36 },
              { name: 'pressure', dType: 'float32', dimension: 1, offset: 48, length: 12 },
              { name: 'velocity', dType: 'float32', dimension: 3, offset: 60, length: 36 },
            ],
            bounds: {
              pressure: [100, 200],
              velocity: [-10, 10],
            },
          },
        },
      },
    ])
    const fields = extractFieldCatalog(entries)
    expect(fields).toHaveLength(2)
    const pressure = fields.find((f) => f.name === 'pressure')
    expect(pressure?.kind).toBe('scalar')
    expect(pressure?.min).toBe(100)
    expect(pressure?.max).toBe(200)
    const velocity = fields.find((f) => f.name === 'velocity')
    expect(velocity?.kind).toBe('vector')
  })

  it('extracts field catalog from LOD buffers', () => {
    const entries = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        resources: {
          buffers: {
            type: 'lod',
            default: 0,
            levels: [
              {
                type: 'buffers',
                path: 'body-lod0.bin',
                sections: [
                  { name: 'position', dType: 'float32', dimension: 3, offset: 0, length: 36 },
                  { name: 'temperature', dType: 'float32', dimension: 1, offset: 36, length: 12 },
                ],
                bounds: { temperature: [300, 500] },
              },
              {
                type: 'buffers',
                path: 'body-lod1.bin',
                sections: [
                  { name: 'position', dType: 'float32', dimension: 3, offset: 0, length: 12 },
                ],
              },
            ],
          },
        },
      },
    ])
    const fieldsLod0 = extractFieldCatalog(entries, 0)
    expect(fieldsLod0).toHaveLength(1)
    expect(fieldsLod0[0].name).toBe('temperature')
    const fieldsLod1 = extractFieldCatalog(entries, 1)
    expect(fieldsLod1).toHaveLength(0)
  })

  it('aggregates scalar and vector bounds declared on entity locations', () => {
    const entries = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        resources: {
          buffers: {
            type: 'buffers',
            path: 'body.bin',
            sections: [
              { name: 'position', dType: 'float32', dimension: 3, offset: 0, length: 36 },
              { name: 'scalarField', dType: 'float32', dimension: 1, offset: 36, length: 12 },
              { name: 'vectorField', dType: 'float32', dimension: 3, offset: 48, length: 36 },
            ],
          },
        },
      },
      {
        id: 'entity-1',
        type: 'Face',
        properties: {
          bufferLocations: {
            indices: [{
              bufNum: 0,
              startIndex: 0,
              endIndex: 3,
              bounds: [
                { name: 'scalarField', minVal: -2, maxVal: 7 },
                { name: 'vectorField', minMag: 1, maxMag: 9, minVal: [-1, 0, 0], maxVal: [9, 0, 0] },
              ],
            }],
          },
        },
      },
    ])

    expect(extractFieldCatalog(entries)).toEqual([
      { name: 'scalarField', kind: 'scalar', dimension: 1, min: -2, max: 7 },
      { name: 'vectorField', kind: 'vector', dimension: 3, min: 1, max: 9 },
    ])
  })

  it('reports LOD levels in asset', () => {
    const manifest = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        attributions: { faces: ['face-1'] },
        resources: {
          buffers: {
            type: 'lod',
            default: 0,
            levels: [
              {
                type: 'buffers',
                path: 'body-lod0.bin',
                sections: [
                  { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 12 },
                  { name: 'position', dType: 'float32', dimension: 3, offset: 12, length: 36 },
                ],
              },
              {
                type: 'buffers',
                path: 'body-lod1.bin',
                sections: [
                  { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 6 },
                  { name: 'position', dType: 'float32', dimension: 3, offset: 6, length: 12 },
                ],
              },
            ],
          },
        },
      },
      {
        id: 'face-1',
        type: 'Face',
        properties: { bufferLocations: { indices: [{ bufNum: 0, startIndex: 0, endIndex: 3 }] } },
      },
    ])
    const data0 = new ArrayBuffer(48)
    new Uint32Array(data0, 0, 3).set([0, 1, 2])
    new Float32Array(data0, 12, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const asset = buildUVFAsset(manifest, new Map([['body-lod0.bin', data0]]), 0)
    expect(asset.lodLevels).toBe(2)
    expect(asset.currentLOD).toBe(0)
    expect(asset.entityLODs).toEqual({ 'body-1': { levels: 2, current: 0 } })
    asset.dispose()
  })

  it('applyFieldColoring sets and clears vertex colors', () => {
    const manifest = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        attributions: { faces: ['face-1'] },
        resources: {
          buffers: {
            type: 'buffers',
            path: 'body.bin',
            sections: [
              { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 12 },
              { name: 'position', dType: 'float32', dimension: 3, offset: 12, length: 36 },
              { name: 'pressure', dType: 'float32', dimension: 1, offset: 48, length: 12 },
            ],
            bounds: { pressure: [0, 1] },
          },
        },
      },
      {
        id: 'face-1',
        type: 'Face',
        properties: { bufferLocations: { indices: [{ bufNum: 0, startIndex: 0, endIndex: 3 }] } },
      },
    ])
    const data = new ArrayBuffer(60)
    new Uint32Array(data, 0, 3).set([0, 1, 2])
    new Float32Array(data, 12, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])
    new Float32Array(data, 48, 3).set([0, 0.5, 1.0])
    const asset = buildUVFAsset(manifest, new Map([['body.bin', data]]))
    expect(asset.fields).toHaveLength(1)
    expect(asset.fields[0]).toMatchObject({ name: 'pressure', min: 0, max: 1, dimension: 1 })
    const face = asset.getEntityObject('face-1')!
    expect(face).toHaveProperty('geometry')
    expect((face as import('three').Mesh).geometry.getAttribute('pressure').count).toBe(3)
    // Apply field coloring
    applyFieldColoring(asset, 'pressure', 'grayscale')
    const colorAttribute = (face as import('three').Mesh).geometry.getAttribute('color')
    expect(colorAttribute.count).toBe(3)
    expect(Array.from(collectFieldValues(asset, 'pressure'))).toEqual([0, 0.5, 1])
    expect(createFieldHistogram(asset, 'pressure', 2)).toMatchObject({
      sampleCount: 3,
      bins: [{ min: 0, max: 0.5, count: 1 }, { min: 0.5, max: 1, count: 2 }],
    })
    applyFieldColoring(asset, 'pressure', 'grayscale', {
      range: [0.4, 0.6],
      outsideColor: [0.25, 0.25, 0.25],
    })
    const rangedColors = (face as import('three').Mesh).geometry.getAttribute('color')
    expect(rangedColors.getX(0)).toBeCloseTo(0.25)
    expect(rangedColors.getX(1)).toBeCloseTo(0.5)
    expect(rangedColors.getX(2)).toBeCloseTo(0.25)
    const probe = probeFieldAtIntersection(
      asset,
      face as THREE.Mesh,
      'pressure',
      0,
      new THREE.Vector3(0.25, 0.25, 0),
    )
    expect(probe).toMatchObject({
      fieldName: 'pressure',
      entityId: 'face-1',
      position: [0.25, 0.25, 0],
    })
    expect(probe?.value).toBeCloseTo(0.375)
    // Clear field coloring
    applyFieldColoring(asset, null, 'viridis')
    asset.dispose()
  })

  it('builds entity hierarchy and applies group transforms', () => {
    const manifest = parseUVFManifest([
      {
        id: 'root-group',
        name: 'Assembly',
        type: 'GeometryGroup',
        attributions: { members: ['body-1'] },
        properties: {
          transform: [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            2, 3, 4, 1,
          ],
        },
      },
      {
        id: 'body-1',
        type: 'SolidGeometry',
        attributions: { faces: ['face-1'] },
        resources: {
          buffers: {
            type: 'buffers',
            path: 'body.bin',
            sections: [
              { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 12 },
              { name: 'position', dType: 'float32', dimension: 3, offset: 12, length: 36 },
            ],
          },
        },
      },
      {
        id: 'face-1',
        type: 'Face',
        properties: { bufferLocations: { indices: [{ bufNum: 0, startIndex: 0, endIndex: 3 }] } },
      },
    ])
    const data = new ArrayBuffer(48)
    new Uint32Array(data, 0, 3).set([0, 1, 2])
    new Float32Array(data, 12, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])

    const asset = buildUVFAsset(manifest, new Map([['body.bin', data]]))
    const group = asset.getEntityObject('root-group')!
    const solid = asset.getEntityObject('body-1')!
    const face = asset.getEntityObject('face-1')!
    asset.object.updateMatrixWorld(true)

    expect(asset.object.children).toEqual([group])
    expect(solid.parent).toBe(group)
    expect(face.parent).toBe(solid)
    expect(group.position.toArray()).toEqual([2, 3, 4])
    expect(asset.entities).toEqual([
      { id: 'root-group', name: 'Assembly', type: 'GeometryGroup', parentId: null, children: ['body-1'] },
      { id: 'body-1', name: 'body-1', type: 'SolidGeometry', parentId: 'root-group', children: ['face-1'] },
      { id: 'face-1', name: 'face-1', type: 'Face', parentId: 'body-1', children: [] },
    ])

    setEntityVisibility(asset, 'root-group', false)
    expect(group.visible).toBe(false)
    asset.dispose()
  })

  it('rejects missing, cyclic, and multiply-parented group members', () => {
    expect(() => buildUVFAsset(parseUVFManifest([
      { id: 'group-1', type: 'GeometryGroup', attributions: { members: ['missing'] } },
    ]), new Map())).toThrow(/missing member/)

    expect(() => buildUVFAsset(parseUVFManifest([
      { id: 'group-1', type: 'GeometryGroup', attributions: { members: ['group-2'] } },
      { id: 'group-2', type: 'GeometryGroup', attributions: { members: ['group-1'] } },
    ]), new Map())).toThrow(/cycle/)

    expect(() => buildUVFAsset(parseUVFManifest([
      { id: 'group-1', type: 'GeometryGroup', attributions: { members: ['body-1'] } },
      { id: 'group-2', type: 'GeometryGroup', attributions: { members: ['body-1'] } },
      {
        id: 'body-1',
        type: 'SolidGeometry',
        resources: {
          buffers: {
            type: 'buffers',
            path: 'body.bin',
            sections: [{ name: 'position', dType: 'float32', dimension: 3, offset: 0, length: 12 }],
          },
        },
      },
    ]), new Map())).toThrow(/multiple parents/)
  })

  it('rejects duplicate IDs, invalid transforms, missing faces, and invalid edge ranges', () => {
    expect(() => buildUVFAsset(parseUVFManifest([
      { id: 'duplicate', type: 'GeometryGroup' },
      { id: 'duplicate', type: 'GeometryGroup' },
    ]), new Map())).toThrow(/duplicate entity/)

    expect(() => buildUVFAsset(parseUVFManifest([
      { id: 'group-1', type: 'GeometryGroup', properties: { transform: [1, 0, 0] } },
    ]), new Map())).toThrow(/invalid transform/)

    const missingFaceManifest = parseUVFManifest([{
      id: 'body-1',
      type: 'SolidGeometry',
      attributions: { faces: ['missing-face'] },
      resources: {
        buffers: {
          type: 'buffers',
          path: 'body.bin',
          sections: [{ name: 'position', dType: 'float32', dimension: 3, offset: 0, length: 12 }],
        },
      },
    }])
    expect(() => buildUVFAsset(
      missingFaceManifest,
      new Map([['body.bin', new ArrayBuffer(12)]]),
    )).toThrow(/missing Face/)

    const invalidEdgeManifest = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        attributions: { faces: ['face-1'], edges: ['edge-1'] },
        resources: {
          buffers: {
            type: 'buffers',
            path: 'body.bin',
            sections: [
              { name: 'position', dType: 'float32', dimension: 3, offset: 0, length: 36 },
              { name: 'edgePosition', dType: 'float32', dimension: 3, offset: 36, length: 24 },
            ],
          },
        },
      },
      {
        id: 'face-1',
        type: 'Face',
        properties: { bufferLocations: { indices: [{ bufNum: 0, startIndex: 0, endIndex: 9 }] } },
      },
      {
        id: 'edge-1',
        type: 'Edge',
        properties: { bufferLocations: { indices: [{ bufNum: 0, startIndex: 0, endIndex: 9 }] } },
      },
    ])
    expect(() => buildUVFAsset(
      invalidEdgeManifest,
      new Map([['body.bin', new ArrayBuffer(60)]]),
    )).toThrow(/invalid value range/)
  })

  it('uses the selected LOD edge range', () => {
    const manifest = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        attributions: { faces: ['face-1'], edges: ['edge-1'] },
        resources: {
          buffers: {
            type: 'lod',
            default: 1,
            levels: [
              {
                type: 'buffers',
                path: 'body-full.bin',
                sections: [
                  { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 24 },
                  { name: 'position', dType: 'float32', dimension: 3, offset: 24, length: 48 },
                  { name: 'edgePosition', dType: 'float32', dimension: 3, offset: 72, length: 36 },
                ],
              },
              {
                type: 'buffers',
                path: 'body-preview.bin',
                sections: [
                  { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 12 },
                  { name: 'position', dType: 'float32', dimension: 3, offset: 12, length: 36 },
                  { name: 'edgePosition', dType: 'float32', dimension: 3, offset: 48, length: 24 },
                ],
              },
            ],
          },
        },
      },
      {
        id: 'face-1',
        type: 'Face',
        properties: {
          bufferLocations: {
            indices: [
              { bufNum: 0, startIndex: 0, endIndex: 6 },
              { bufNum: 0, startIndex: 0, endIndex: 3 },
            ],
          },
        },
      },
      {
        id: 'edge-1',
        type: 'Edge',
        properties: {
          bufferLocations: {
            indices: [
              { bufNum: 0, startIndex: 0, endIndex: 9 },
              { bufNum: 0, startIndex: 0, endIndex: 6 },
            ],
          },
        },
      },
    ])
    const data = new ArrayBuffer(72)
    new Uint32Array(data, 0, 3).set([0, 1, 2])
    new Float32Array(data, 12, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])
    new Float32Array(data, 48, 6).set([0, 0, 0, 1, 0, 0])

    const asset = buildUVFAsset(manifest, new Map([['body-preview.bin', data]]))
    const edge = asset.getEntityObject('edge-1')!
    expect(edge.children).toHaveLength(1)
    expect((edge.children[0] as import('three').Line).geometry.getAttribute('position').count).toBe(2)
    asset.dispose()
  })

  it('uses the selected LOD face range and reports its effective level', () => {
    const manifest = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        attributions: { faces: ['face-1'] },
        resources: {
          buffers: {
            type: 'lod',
            default: 1,
            levels: [
              {
                type: 'buffers',
                path: 'body-full.bin',
                sections: [
                  { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 24 },
                  { name: 'position', dType: 'float32', dimension: 3, offset: 24, length: 48 },
                ],
              },
              {
                type: 'buffers',
                path: 'body-preview.bin',
                sections: [
                  { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 12 },
                  { name: 'position', dType: 'float32', dimension: 3, offset: 12, length: 36 },
                ],
              },
            ],
          },
        },
      },
      {
        id: 'face-1',
        type: 'Face',
        properties: {
          bufferLocations: {
            indices: [
              { bufNum: 0, startIndex: 0, endIndex: 6 },
              { bufNum: 0, startIndex: 0, endIndex: 3 },
            ],
          },
        },
      },
    ])
    const data = new ArrayBuffer(48)
    new Uint32Array(data, 0, 3).set([0, 1, 2])
    new Float32Array(data, 12, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])

    const asset = buildUVFAsset(manifest, new Map([['body-preview.bin', data]]))
    expect(asset.currentLOD).toBe(1)
    expect(asset.entityLODs['body-1']).toEqual({ levels: 2, current: 1 })
    expect(asset.triangles).toBe(1)
    asset.dispose()
  })

  it('toggles entity visibility without domain-specific knowledge', () => {
    const manifest = parseUVFManifest([
      {
        id: 'body-1',
        type: 'SolidGeometry',
        attributions: { faces: ['entity-1'] },
        resources: {
          buffers: {
            type: 'buffers',
            path: 'body.bin',
            sections: [
              { name: 'indices', dType: 'uint32', dimension: 1, offset: 0, length: 12 },
              { name: 'position', dType: 'float32', dimension: 3, offset: 12, length: 36 },
            ],
          },
        },
      },
      {
        id: 'entity-1',
        type: 'Face',
        properties: { bufferLocations: { indices: [{ bufNum: 0, startIndex: 0, endIndex: 3 }] } },
      },
    ])
    const data = new ArrayBuffer(48)
    new Uint32Array(data, 0, 3).set([0, 1, 2])
    new Float32Array(data, 12, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0])
    const asset = buildUVFAsset(manifest, new Map([['body.bin', data]]))

    setEntityVisibility(asset, 'entity-1', false)
    expect(asset.getEntityObject('entity-1')?.visible).toBe(false)
    setEntityVisibility(asset, 'entity-1', true)
    expect(asset.getEntityObject('entity-1')?.visible).toBe(true)
    asset.dispose()
  })
})
