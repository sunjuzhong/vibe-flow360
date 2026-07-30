import { describe, expect, it } from 'vitest'
import { buildUVFAsset, extractFieldCatalog, applyFieldColoring, parseUVFManifest, safeUVFBufferPath } from '.'

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
    expect(asset.object.children).toHaveLength(2)
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
    // Apply field coloring
    applyFieldColoring(asset, 'pressure', 'grayscale')
    // Clear field coloring
    applyFieldColoring(asset, null, 'viridis')
    asset.dispose()
  })
})
