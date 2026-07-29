import { describe, expect, it } from 'vitest'
import { buildUVFAsset, parseUVFManifest, safeUVFBufferPath } from '.'

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
})
