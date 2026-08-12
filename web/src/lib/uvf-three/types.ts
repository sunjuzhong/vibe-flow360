export type UVFBufferSection = {
  name: 'indices' | 'position' | 'normal' | 'edgePosition' | string
  dType: 'uint32' | 'float32' | string
  dimension: number
  offset: number
  length: number
  path?: string
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
  bounds?: UVFFieldBounds[]
}

export type UVFFieldBounds = {
  name: string
  minVal?: number | number[]
  maxVal?: number | number[]
  minMag?: number
  maxMag?: number
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
    transform?: number[]
    type?: number
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
  dimension?: number
}

export type UVFFieldHistogramBin = {
  min: number
  max: number
  count: number
}

export type UVFFieldHistogram = {
  field: UVFFieldInfo
  sampleCount: number
  bins: UVFFieldHistogramBin[]
}

export type UVFFieldScale = 'auto' | 'linear' | 'log'
export type UVFResolvedFieldScale = Exclude<UVFFieldScale, 'auto'>

export type UVFFieldColorOptions = {
  range?: [number, number] | null
  outsideColor?: [number, number, number]
  scale?: UVFResolvedFieldScale
  entityIds?: string[] | null
}

export type UVFFieldColorResult = {
  scopedMeshes: number
  coloredMeshes: number
}

export type UVFVectorVisualizationOptions = {
  lic: boolean
  arrows: boolean
  entityIds?: string[] | null
  maxArrows?: number
}

export type UVFVectorVisualizationResult = {
  licSurfaces: number
  arrows: number
}

export type UVFFieldProbe = {
  fieldName: string
  value: number
  entityId: string
  position: [number, number, number]
}

export type UVFFieldExtrema = {
  field: UVFFieldInfo
  min: UVFFieldProbe | null
  max: UVFFieldProbe | null
}

export type UVFFieldFilterRule = {
  id: string
  fieldName: string
  min: number
  max: number
}

export type UVFFieldFilter = {
  enabled: boolean
  operator: 'and' | 'or'
  rules: UVFFieldFilterRule[]
}

export type UVFEntityInfo = {
  id: string
  name: string
  type: string
  parentId: string | null
  children: string[]
  fields: string[]
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
  entityLODs: Record<string, { levels: number; current: number }>
  entities: UVFEntityInfo[]
  getEntityObject: (entityId: string) => import('three').Object3D | undefined
  dispose: () => void
}
