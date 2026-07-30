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
  bounds?: Record<string, [number, number]>
}

export type UVFLOD = {
  type: 'lod'
  default?: number
  levels: UVFBuffer[]
  bounds?: Record<string, [number, number]>
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

export type UVFFieldInfo = {
  name: string
  kind: 'scalar' | 'vector'
  min: number
  max: number
}

export type UVFAsset = {
  object: import('three').Group
  faces: number
  edges: number
  vertices: number
  triangles: number
  fields: UVFFieldInfo[]
  lodLevels: number
  currentLOD: number
  dispose: () => void
}
