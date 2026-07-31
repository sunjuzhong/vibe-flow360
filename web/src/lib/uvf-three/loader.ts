import * as THREE from 'three'
import { parseUVFManifest, resolveUVFBuffer, resolveUVFBufferLocations, resolveUVFLODLevel, safeUVFBufferPath } from './parser'
import { sampleColormap, type ColormapName } from './colormap'
import type { UVFAsset, UVFBuffer, UVFBufferLocation, UVFBufferSection, UVFEntityInfo, UVFEntry, UVFFieldInfo, UVFLoadProgress, UVFLOD } from './types'

const maxManifestBytes = 2 * 1024 * 1024
const maxBufferBytes = 25 * 1024 * 1024
const maxBufferFiles = 10

const STRUCTURAL_SECTIONS = new Set(['indices', 'position', 'normal', 'edgePosition'])

type LoadOptions = {
  signal?: AbortSignal
  lodLevel?: number
  onProgress?: (progress: UVFLoadProgress) => void
}

export class UVFLoader {
  async load(manifestURL: string, options: LoadOptions = {}): Promise<UVFAsset> {
    const resolvedManifestURL = new URL(manifestURL, window.location.href)
    const manifestResponse = await fetch(resolvedManifestURL, { signal: options.signal })
    if (!manifestResponse.ok) throw new Error(`UVF manifest request failed (${manifestResponse.status})`)
    enforceContentLength(manifestResponse, maxManifestBytes, 'UVF manifest')
    const manifestText = await manifestResponse.text()
    if (new TextEncoder().encode(manifestText).byteLength > maxManifestBytes) {
      throw new Error('UVF manifest exceeds the size limit')
    }
    const entries = parseUVFManifest(JSON.parse(manifestText))
    const solids = entries.filter((entry) => entry.type === 'SolidGeometry')
    const paths = [...new Set(solids.map((solid) => safeUVFBufferPath(resolveUVFBuffer(solid, options.lodLevel).path)))]
    if (!paths.length) throw new Error('UVF manifest has no geometry buffers')
    if (paths.length > maxBufferFiles) throw new Error('UVF manifest references too many buffers')

    const buffers = new Map<string, ArrayBuffer>()
    let loadedFiles = 0
    for (const path of paths) {
      const bufferURL = new URL(path, resolvedManifestURL)
      const response = await fetch(bufferURL, { signal: options.signal })
      if (!response.ok) throw new Error(`UVF buffer request failed (${response.status}): ${path}`)
      enforceContentLength(response, maxBufferBytes, `UVF buffer ${path}`)
      const data = await response.arrayBuffer()
      if (data.byteLength > maxBufferBytes) throw new Error(`UVF buffer ${path} exceeds the size limit`)
      buffers.set(path, data)
      loadedFiles++
      options.onProgress?.({
        loadedFiles,
        totalFiles: paths.length,
        progress: loadedFiles / paths.length,
        path,
      })
    }
    return buildUVFAsset(entries, buffers, options.lodLevel)
  }
}

export function extractFieldCatalog(entries: UVFEntry[], lodLevel?: number): UVFFieldInfo[] {
  const manifestBounds = collectManifestBounds(entries)
  const fieldMap = new Map<string, { min: number; max: number; kind: 'scalar' | 'vector'; dimension: number }>()
  for (const entry of entries) {
    if (entry.type !== 'SolidGeometry') continue
    const buffers = entry.resources?.buffers
    if (!buffers) continue
    let bufferInfo: UVFBuffer
    if (buffers.type === 'lod') {
      const lod = buffers as UVFLOD
      const level = lodLevel ?? lod.default ?? 0
      bufferInfo = lod.levels?.[level]
      if (!bufferInfo) continue
    } else {
      bufferInfo = buffers as UVFBuffer
    }
    const bounds = {
      ...(buffers.type === 'lod' ? (buffers as UVFLOD).bounds ?? {} : {}),
      ...(bufferInfo.bounds ?? {}),
    }
    for (const section of bufferInfo.sections) {
      if (STRUCTURAL_SECTIONS.has(section.name)) continue
      if (section.dType !== 'float32') continue
      const existing = fieldMap.get(section.name)
      const sectionBounds = bounds[section.name] ?? manifestBounds.get(section.name)
      const sMin = sectionBounds?.[0] ?? 0
      const sMax = sectionBounds?.[1] ?? 0
      if (existing) {
        existing.min = Math.min(existing.min, sMin)
        existing.max = Math.max(existing.max, sMax)
      } else {
        fieldMap.set(section.name, {
          min: sMin,
          max: sMax,
          kind: section.dimension > 1 ? 'vector' : 'scalar',
          dimension: section.dimension,
        })
      }
    }
  }
  return Array.from(fieldMap.entries())
    .map(([name, info]) => ({ name, ...info }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function buildUVFAsset(
  entries: UVFEntry[],
  buffers: Map<string, ArrayBuffer>,
  lodLevel?: number,
): UVFAsset {
  const root = new THREE.Group()
  root.name = 'UVF Scene'
  const byID = indexEntries(entries)
  const { objectByID, parentByID } = buildContainerHierarchy(entries, root)
  let faces = 0
  let edges = 0
  let vertices = 0
  let triangles = 0

  const catalog = new Map(extractFieldCatalog(entries, lodLevel).map((field) => [field.name, field]))
  const computedFieldRanges = new Map<string, { min: number; max: number }>()

  let lodLevels = 1
  let currentLOD = lodLevel ?? 0
  let currentLODSet = lodLevel !== undefined
  const entityLODs: Record<string, { levels: number; current: number }> = {}
  for (const entry of entries) {
    if (entry.type !== 'SolidGeometry') continue
    const buffers = entry.resources?.buffers
    if (buffers?.type === 'lod') {
      const levels = (buffers as UVFLOD).levels?.length ?? 1
      const current = resolveUVFLODLevel(entry, lodLevel)
      lodLevels = Math.max(lodLevels, levels)
      entityLODs[entry.id] = { levels, current }
      if (!currentLODSet) {
        currentLOD = current
        currentLODSet = true
      }
    } else {
      entityLODs[entry.id] = { levels: 1, current: 0 }
    }
  }

  for (const solid of entries.filter((entry) => entry.type === 'SolidGeometry')) {
    const solidObject = objectByID.get(solid.id)
    if (!(solidObject instanceof THREE.Group)) {
      throw new Error(`SolidGeometry ${solid.id} has no scene container`)
    }
    const bufferInfo = resolveUVFBuffer(solid, lodLevel)
    const raw = buffers.get(bufferInfo.path)
    if (!raw) throw new Error(`UVF buffer ${bufferInfo.path} was not loaded`)
    const positionSection = findSection(bufferInfo.sections, 'position')
    const normalSection = findSection(bufferInfo.sections, 'normal')
    const indexSection = findSection(bufferInfo.sections, 'indices')
    const edgeSection = findSection(bufferInfo.sections, 'edgePosition')
    const elementGroupSection = findSection(bufferInfo.sections, 'elementGroupId')
    if (!positionSection) throw new Error(`SolidGeometry ${solid.id} has no position section`)
    const positions = floatSection(raw, positionSection)
    const normals = normalSection ? floatSection(raw, normalSection) : null
    const indices = indexSection ? uintSection(raw, indexSection) : null
    const edgePositions = edgeSection ? floatSection(raw, edgeSection) : null
    const elementGroupIds = elementGroupSection ? uintSection(raw, elementGroupSection) : null
    vertices += positions.length / 3
    const vertexCount = positions.length / 3
    const fieldAttributes = new Map<string, THREE.BufferAttribute>()
    for (const section of bufferInfo.sections) {
      if (STRUCTURAL_SECTIONS.has(section.name) || section.dType !== 'float32') continue
      const dimension = Math.max(1, section.dimension)
      const values = floatSection(raw, section)
      if (values.length / dimension !== vertexCount) continue
      fieldAttributes.set(section.name, new THREE.BufferAttribute(values, dimension))
      const range = finiteFieldRange(values, dimension)
      const previous = computedFieldRanges.get(section.name)
      computedFieldRanges.set(section.name, previous
        ? { min: Math.min(previous.min, range.min), max: Math.max(previous.max, range.max) }
        : range)
      if (!catalog.has(section.name)) {
        catalog.set(section.name, {
          name: section.name,
          kind: dimension > 1 ? 'vector' : 'scalar',
          dimension,
          min: range.min,
          max: range.max,
        })
      }
    }

    for (const faceID of solid.attributions?.faces ?? []) {
      const face = byID.get(faceID)
      if (!face || face.type !== 'Face') {
        throw new Error(`SolidGeometry ${solid.id} references missing Face ${faceID}`)
      }
      const ranges = resolveUVFBufferLocations(
        solid,
        face.properties?.bufferLocations?.indices ?? [],
        lodLevel,
      )
      const faceIndices = indices ? resolveFaceIndices(indices, ranges, solid.id, face.id) : undefined
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      if (normals && normals.length === positions.length) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      } else {
        geometry.computeVertexNormals()
      }
      if (faceIndices) geometry.setIndex(new THREE.BufferAttribute(faceIndices, 1))
      for (const [name, attribute] of fieldAttributes) {
        geometry.setAttribute(name, attribute)
      }
      if (elementGroupIds) {
        geometry.setAttribute(
          'elementGroupId',
          new THREE.BufferAttribute(elementGroupIds, 1),
        )
      }
      const faceTriangles = faceIndices
        ? Math.floor(faceIndices.length / 3)
        : ranges.reduce((count, range) => count + Math.floor((range.endIndex - range.startIndex) / 9), 0)
      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(faceColor(face.properties?.color, faces)),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: face.properties?.alpha ?? 0.92,
        shininess: 35,
        vertexColors: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = face.name || face.id
      mesh.userData.entityId = face.id
      mesh.userData.groupId = face.id
      mesh.userData.uvfType = 'Face'
      applyEntityTransform(mesh, face)
      registerEntityObject(objectByID, parentByID, face, mesh, solid.id)
      solidObject.add(mesh)
      faces++
      triangles += faceTriangles
    }

    if (edgePositions) {
      for (const edgeID of solid.attributions?.edges ?? []) {
        const edge = byID.get(edgeID)
        if (!edge || edge.type !== 'Edge') {
          throw new Error(`SolidGeometry ${solid.id} references missing Edge ${edgeID}`)
        }
        const edgeObject = createEntityGroup(edge)
        const ranges = resolveUVFBufferLocations(
          solid,
          edge.properties?.bufferLocations?.indices ?? [],
          lodLevel,
        )
        for (const range of ranges) {
          validateValueRange(range, edgePositions.length, solid.id, edge.id)
          if (range.endIndex === range.startIndex) continue
          const lineGeometry = new THREE.BufferGeometry()
          lineGeometry.setAttribute(
            'position',
            new THREE.BufferAttribute(edgePositions.slice(range.startIndex, range.endIndex), 3),
          )
          const line = new THREE.Line(
            lineGeometry,
            new THREE.LineBasicMaterial({ color: 0x30352d, transparent: true, opacity: 0.72 }),
          )
          line.name = edge.name || edge.id
          line.userData.uvfType = 'Edge'
          edgeObject.add(line)
        }
        registerEntityObject(objectByID, parentByID, edge, edgeObject, solid.id)
        solidObject.add(edgeObject)
        edges++
      }
    }
  }
  if (!faces) throw new Error('UVF manifest produced no renderable faces')
  const fields = Array.from(catalog.values())
    .map((field) => {
      const computed = computedFieldRanges.get(field.name)
      return computed ? { ...field, ...computed } : field
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const entities = buildEntityCatalog(entries, objectByID, parentByID)
  return {
    object: root,
    faces,
    edges,
    vertices,
    triangles,
    fields,
    lodLevels,
    currentLOD,
    entityLODs,
    entities,
    getEntityObject: (entityId) => objectByID.get(entityId),
    dispose: () => {
      root.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          materials.forEach((material) => material.dispose())
        }
      })
    },
  }
}

export function applyFieldColoring(
  asset: UVFAsset,
  fieldName: string | null,
  colormap: ColormapName = 'viridis',
): void {
  const field = fieldName ? asset.fields.find((f) => f.name === fieldName) : null
  asset.object.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.userData.uvfType !== 'Face') return
    const geometry = object.geometry
    const material = object.material as THREE.MeshPhongMaterial
    const positionAttr = geometry.getAttribute('position')
    if (!positionAttr) return
    if (field) {
      const fieldSection = findSectionByName(geometry, field.name)
      if (fieldSection) {
        const vertexCount = positionAttr.count
        const dimension = Math.max(1, field.dimension ?? fieldSection.length / vertexCount)
        const colors = new Float32Array(vertexCount * 3)
        const range = field.max - field.min || 1
        for (let i = 0; i < vertexCount; i++) {
          const value = field.kind === 'vector'
            ? vectorMagnitude(fieldSection, i * dimension, dimension)
            : fieldSection[i * dimension] ?? 0
          const t = (value - field.min) / range
          const color = sampleColormap(t, colormap)
          colors[i * 3] = color.r
          colors[i * 3 + 1] = color.g
          colors[i * 3 + 2] = color.b
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        material.vertexColors = true
        material.needsUpdate = true
      }
    } else {
      if (geometry.getAttribute('color')) {
        geometry.deleteAttribute('color')
      }
      material.vertexColors = false
      material.needsUpdate = true
    }
  })
}

export function setWireframeOverlay(asset: UVFAsset, visible: boolean): void {
  asset.object.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.userData.uvfType !== 'Face') return
    const material = object.material as THREE.MeshPhongMaterial
    material.wireframe = visible
    material.needsUpdate = true
  })
}

export function setEntityVisibility(asset: UVFAsset, entityId: string, visible: boolean): void {
  asset.object.traverse((object) => {
    if ((object.userData.entityId ?? object.userData.groupId) !== entityId) return
    object.visible = visible
  })
}

// Compatibility aliases for existing consumers. New code should use the
// format-oriented names above.
export { UVFLoader as Flow360UVFLoader }
export const setGroupVisibility = setEntityVisibility

function findSectionByName(geometry: THREE.BufferGeometry, fieldName: string): Float32Array | null {
  const attr = geometry.getAttribute(fieldName)
  if (attr && attr instanceof THREE.BufferAttribute) {
    return attr.array as Float32Array
  }
  return null
}

function findSection(sections: UVFBufferSection[], name: string) {
  return sections.find((section) => section.name === name)
}

function floatSection(buffer: ArrayBuffer, section: UVFBufferSection) {
  assertSectionBounds(buffer, section, 4)
  return new Float32Array(buffer, section.offset, section.length / 4)
}

function uintSection(buffer: ArrayBuffer, section: UVFBufferSection) {
  assertSectionBounds(buffer, section, 4)
  return new Uint32Array(buffer, section.offset, section.length / 4)
}

function assertSectionBounds(buffer: ArrayBuffer, section: UVFBufferSection, alignment: number) {
  if (
    section.offset % alignment !== 0 ||
    section.length % alignment !== 0 ||
    section.offset + section.length > buffer.byteLength
  ) {
    throw new Error(`UVF section ${section.name} is outside its buffer`)
  }
}

function finiteFieldRange(values: Float32Array, dimension: number) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  const count = values.length / dimension
  for (let index = 0; index < count; index++) {
    const value = dimension > 1
      ? vectorMagnitude(values, index * dimension, dimension)
      : values[index * dimension]
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 0 }
}

function vectorMagnitude(values: Float32Array, offset: number, dimension: number) {
  let sum = 0
  for (let component = 0; component < dimension; component++) {
    const value = values[offset + component] ?? 0
    sum += value * value
  }
  return Math.sqrt(sum)
}

function collectManifestBounds(entries: UVFEntry[]) {
  const result = new Map<string, [number, number]>()
  for (const entry of entries) {
    for (const location of entry.properties?.bufferLocations?.indices ?? []) {
      for (const bound of location.bounds ?? []) {
        const min = typeof bound.minMag === 'number'
          ? bound.minMag
          : typeof bound.minVal === 'number' ? bound.minVal : undefined
        const max = typeof bound.maxMag === 'number'
          ? bound.maxMag
          : typeof bound.maxVal === 'number' ? bound.maxVal : undefined
        if (min === undefined || max === undefined) continue
        const previous = result.get(bound.name)
        result.set(bound.name, previous
          ? [Math.min(previous[0], min), Math.max(previous[1], max)]
          : [min, max])
      }
    }
  }
  return result
}

function concatenateIndices(parts: Uint32Array[]) {
  const length = parts.reduce((total, part) => total + part.length, 0)
  if (!length) return undefined
  const result = new Uint32Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function resolveFaceIndices(
  indices: Uint32Array,
  ranges: UVFBufferLocation[],
  solidId: string,
  entityId: string,
) {
  const parts = (ranges ?? []).map((range) => {
    if (
      !Number.isSafeInteger(range.startIndex)
      || !Number.isSafeInteger(range.endIndex)
      || range.startIndex < 0
      || range.endIndex < range.startIndex
      || range.endIndex > indices.length
    ) {
      throw new Error(`Entity ${entityId} has an invalid index range in ${solidId}`)
    }
    return indices.slice(range.startIndex, range.endIndex)
  })
  return concatenateIndices(parts)
}

function indexEntries(entries: UVFEntry[]) {
  const result = new Map<string, UVFEntry>()
  for (const entry of entries) {
    if (result.has(entry.id)) throw new Error(`UVF manifest contains duplicate entity ${entry.id}`)
    result.set(entry.id, entry)
  }
  return result
}

function buildContainerHierarchy(entries: UVFEntry[], root: THREE.Group) {
  const containers = entries.filter((entry) =>
    entry.type === 'GeometryGroup' || entry.type === 'SolidGeometry',
  )
  const objectByID = new Map<string, THREE.Object3D>()
  const parentByID = new Map<string, string>()

  for (const entry of containers) {
    objectByID.set(entry.id, createEntityGroup(entry))
  }
  for (const group of entries.filter((entry) => entry.type === 'GeometryGroup')) {
    for (const memberId of group.attributions?.members ?? []) {
      if (!objectByID.has(memberId)) {
        throw new Error(`GeometryGroup ${group.id} references missing member ${memberId}`)
      }
      assignParent(parentByID, memberId, group.id)
    }
  }
  assertAcyclicHierarchy(parentByID)
  for (const entry of containers) {
    const object = objectByID.get(entry.id)!
    const parentId = parentByID.get(entry.id)
    if (parentId) {
      objectByID.get(parentId)!.add(object)
    } else {
      root.add(object)
    }
  }
  return { objectByID, parentByID }
}

function createEntityGroup(entry: UVFEntry) {
  const group = new THREE.Group()
  group.name = entry.name || entry.id
  group.userData.entityId = entry.id
  group.userData.uvfType = entry.type
  applyEntityTransform(group, entry)
  return group
}

function applyEntityTransform(object: THREE.Object3D, entry: UVFEntry) {
  const transform = entry.properties?.transform
  if (transform === undefined) return
  if (
    transform.length !== 16
    || transform.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new Error(`Entity ${entry.id} has an invalid transform`)
  }
  object.matrix.fromArray(transform)
  object.matrix.decompose(object.position, object.quaternion, object.scale)
}

function registerEntityObject(
  objectByID: Map<string, THREE.Object3D>,
  parentByID: Map<string, string>,
  entry: UVFEntry,
  object: THREE.Object3D,
  parentId: string,
) {
  if (objectByID.has(entry.id)) throw new Error(`UVF entity ${entry.id} has multiple scene objects`)
  assignParent(parentByID, entry.id, parentId)
  objectByID.set(entry.id, object)
}

function assignParent(parentByID: Map<string, string>, childId: string, parentId: string) {
  const existing = parentByID.get(childId)
  if (existing && existing !== parentId) {
    throw new Error(`UVF entity ${childId} has multiple parents: ${existing} and ${parentId}`)
  }
  parentByID.set(childId, parentId)
}

function assertAcyclicHierarchy(parentByID: Map<string, string>) {
  for (const entityId of parentByID.keys()) {
    const visited = new Set<string>()
    let current: string | undefined = entityId
    while (current) {
      if (visited.has(current)) throw new Error(`UVF entity hierarchy contains a cycle at ${current}`)
      visited.add(current)
      current = parentByID.get(current)
    }
  }
}

function buildEntityCatalog(
  entries: UVFEntry[],
  objectByID: Map<string, THREE.Object3D>,
  parentByID: Map<string, string>,
): UVFEntityInfo[] {
  const childrenByID = new Map<string, string[]>()
  for (const [childId, parentId] of parentByID) {
    const children = childrenByID.get(parentId) ?? []
    children.push(childId)
    childrenByID.set(parentId, children)
  }
  return entries
    .filter((entry) => objectByID.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.name || entry.id,
      type: entry.type,
      parentId: parentByID.get(entry.id) ?? null,
      children: childrenByID.get(entry.id) ?? [],
    }))
}

function validateValueRange(
  range: UVFBufferLocation,
  valueCount: number,
  solidId: string,
  entityId: string,
) {
  if (
    !Number.isSafeInteger(range.startIndex)
    || !Number.isSafeInteger(range.endIndex)
    || range.startIndex < 0
    || range.endIndex < range.startIndex
    || range.endIndex > valueCount
    || (range.endIndex - range.startIndex) % 3 !== 0
  ) {
    throw new Error(`Entity ${entityId} has an invalid value range in ${solidId}`)
  }
}

function faceColor(value: number | undefined, index: number) {
  if (typeof value === 'number' && value !== 0xffffff) return value
  const palette = [0x789521, 0x2b7de9, 0xf97316, 0xec4899, 0x8b5cf6, 0x06b6d4]
  return palette[index % palette.length]
}

function enforceContentLength(response: Response, limit: number, label: string) {
  const length = Number(response.headers.get('Content-Length') || 0)
  if (Number.isFinite(length) && length > limit) throw new Error(`${label} exceeds the size limit`)
}
