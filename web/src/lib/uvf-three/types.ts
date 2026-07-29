export type UVFBufferSection = {
  name: 'indices' | 'position' | 'normal' | 'edgePosition' | string
  dType: 'uint32' | 'float32' | string
  dimension: number
  offset: number
  length: number
}

export type UVFBuffer = {
  type: 'buffers'
  path: string
  sections: UVFBufferSection[]
}

export type UVFLOD = {
  type: 'lod'
  default?: number
  levels: UVFBuffer[]
}

export type UVFBufferLocation = {
  bufNum: number
  startIndex: number
  endIndex: number
}

export type UVFEntry = {
  id: string
  name?: string
  type: 'GeometryGroup' | 'SolidGeometry' | 'Face' | 'Edge' | string
  attributions?: {
    packedParentId?: string
    faces?: string[]
    edges?: string[]
    members?: string[]
  }
  properties?: {
    alpha?: number
    color?: number
    boundsMin?: [number, number, number]
    boundsMax?: [number, number, number]
    bufferLocations?: {
      indices?: UVFBufferLocation[]
    }
  }
  resources?: {
    buffers?: UVFBuffer | UVFLOD
  }
}

export type UVFLoadProgress = {
  loadedFiles: number
  totalFiles: number
  progress: number
  path: string
}

export type UVFAsset = {
  object: import('three').Group
  faces: number
  edges: number
  vertices: number
  triangles: number
  dispose: () => void
}
