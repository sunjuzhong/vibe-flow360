import * as THREE from 'three'
import { parseUVFManifest, resolveUVFBuffer, resolveUVFBufferLocations, resolveUVFLODLevel, safeUVFBufferPath } from './parser'
import { DEFAULT_COLORMAP, sampleColormap, type ColormapName } from './colormap'
import { normalizeFieldValue } from './fieldScale'
import type { UVFAsset, UVFBuffer, UVFBufferLocation, UVFBufferSection, UVFEntityInfo, UVFEntry, UVFFieldColorOptions, UVFFieldExtrema, UVFFieldFilter, UVFFieldFilterRule, UVFFieldHistogram, UVFFieldInfo, UVFFieldProbe, UVFLoadProgress, UVFLOD } from './types'

// Case manifests carry result-field and boundary metadata in addition to the
// render objects, so they can legitimately exceed the old 2 MiB cap.
const maxManifestBytes = 8 * 1024 * 1024
const maxBufferBytes = configuredByteLimit(import.meta.env.VITE_UVF_MAX_BUFFER_BYTES)
const maxBufferFiles = 256
const maxConcurrentBufferLoads = 4
const maxTotalBufferBytes = configuredByteLimit(import.meta.env.VITE_UVF_MAX_TOTAL_BUFFER_BYTES)

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
    const paths = [...new Set(solids.flatMap((solid) => {
      const buffer = resolveUVFBuffer(solid, options.lodLevel)
      return [buffer.path, ...buffer.sections.map((section) => section.path).filter((path): path is string => Boolean(path))]
        .map(safeUVFBufferPath)
    }))]
    if (!paths.length) throw new Error('UVF manifest has no geometry buffers')
    validateUVFBufferFileCount(paths)

    const buffers = new Map<string, ArrayBuffer>()
    let loadedFiles = 0
    let loadedBytes = 0
    let nextPath = 0
    const loadNext = async () => {
      while (nextPath < paths.length) {
        const path = paths[nextPath++]
        const bufferURL = new URL(path, resolvedManifestURL)
        const response = await fetch(bufferURL, { signal: options.signal })
        if (!response.ok) throw new Error(`UVF buffer request failed (${response.status}): ${path}`)
        enforceContentLength(response, maxBufferBytes, `UVF buffer ${path}`)
        const data = await response.arrayBuffer()
        if (data.byteLength > maxBufferBytes) throw new Error(`UVF buffer ${path} exceeds the size limit`)
        loadedBytes = accumulateUVFBufferBytes(loadedBytes, data.byteLength)
        buffers.set(path, data)
        loadedFiles++
        options.onProgress?.({ loadedFiles, totalFiles: paths.length, progress: loadedFiles / paths.length, path })
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxConcurrentBufferLoads, paths.length) }, loadNext))
    return buildUVFAsset(entries, buffers, options.lodLevel)
  }
}

export function validateUVFBufferFileCount(paths: readonly string[]): void {
  if (paths.length > maxBufferFiles) throw new Error('UVF manifest references too many buffers')
}

export function accumulateUVFBufferBytes(loadedBytes: number, nextBufferBytes: number): number {
  const total = loadedBytes + nextBufferBytes
  if (!Number.isSafeInteger(total) || total > maxTotalBufferBytes) {
    throw new Error('UVF buffers exceed the total size limit')
  }
  return total
}

function configuredByteLimit(value: string | undefined): number {
  if (!value?.trim()) return Number.POSITIVE_INFINITY
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : Number.POSITIVE_INFINITY
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
    const positionSection = findSection(bufferInfo.sections, 'position')
    const normalSection = findSection(bufferInfo.sections, 'normal')
    const indexSection = findSection(bufferInfo.sections, 'indices')
    const edgeSection = findSection(bufferInfo.sections, 'edgePosition')
    const elementGroupSection = findSection(bufferInfo.sections, 'elementGroupId')
    if (!positionSection) throw new Error(`SolidGeometry ${solid.id} has no position section`)
    const positions = floatSection(sectionBuffer(buffers, bufferInfo, positionSection), positionSection)
    const normals = normalSection ? floatSection(sectionBuffer(buffers, bufferInfo, normalSection), normalSection) : null
    const indices = indexSection ? uintSection(sectionBuffer(buffers, bufferInfo, indexSection), indexSection) : null
    const edgePositions = edgeSection ? floatSection(sectionBuffer(buffers, bufferInfo, edgeSection), edgeSection) : null
    const elementGroupIds = elementGroupSection ? uintSection(sectionBuffer(buffers, bufferInfo, elementGroupSection), elementGroupSection) : null
    vertices += positions.length / 3
    const vertexCount = positions.length / 3
    const renderNormals = deriveRenderNormals(positions, indices, normals)
    const fieldAttributes = new Map<string, THREE.BufferAttribute>()
    for (const section of bufferInfo.sections) {
      if (STRUCTURAL_SECTIONS.has(section.name) || section.dType !== 'float32') continue
      const dimension = Math.max(1, section.dimension)
      const values = floatSection(sectionBuffer(buffers, bufferInfo, section), section)
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
      geometry.setAttribute('normal', renderNormals)
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
      const opacity = face.properties?.alpha ?? 1
      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(faceColor(face.properties?.color, faces)),
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        opacity,
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

    if ((solid.attributions?.faces?.length ?? 0) === 0) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('normal', renderNormals)
      if (indices) geometry.setIndex(new THREE.BufferAttribute(indices, 1))
      for (const [name, attribute] of fieldAttributes) geometry.setAttribute(name, attribute)
      if (elementGroupIds) geometry.setAttribute('elementGroupId', new THREE.BufferAttribute(elementGroupIds, 1))
      const opacity = solid.properties?.alpha ?? 1
      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(faceColor(solid.properties?.color, faces)),
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        opacity,
        shininess: 35,
        vertexColors: false,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = solid.name || solid.id
      mesh.userData.entityId = solid.id
      mesh.userData.groupId = solid.id
      mesh.userData.uvfType = 'SolidGeometry'
      solidObject.add(mesh)
      faces++
      triangles += indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9)
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
  const entities = buildEntityCatalog(entries, objectByID, parentByID, fields)
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
          const baseMaterial = object.userData.uvfBaseMaterial
          if (baseMaterial instanceof THREE.Material && !materials.includes(baseMaterial)) {
            baseMaterial.dispose()
          }
        }
      })
    },
  }
}

function deriveRenderNormals(
  positions: Float32Array,
  indices: Uint32Array | null,
  sourceNormals: Float32Array | null,
): THREE.BufferAttribute {
  // Some exporters emit triangle-local or inconsistent normals for indexed
  // meshes. Lighting those values directly makes a smooth face look like
  // dark/light camouflage. Indexed topology is the stable rendering source.
  if (!indices && sourceNormals?.length === positions.length) {
    return new THREE.BufferAttribute(sourceNormals, 3)
  }

  const topology = new THREE.BufferGeometry()
  topology.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (indices) topology.setIndex(new THREE.BufferAttribute(indices, 1))
  topology.computeVertexNormals()
  const derived = topology.getAttribute('normal') as THREE.BufferAttribute
  topology.deleteAttribute('normal')
  topology.dispose()
  return derived
}

function isUVFSurfaceMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
    && (object.userData.uvfType === 'Face' || object.userData.uvfType === 'SolidGeometry')
}

export function applyFieldColoring(
  asset: UVFAsset,
  fieldName: string | null,
  colormap: ColormapName = DEFAULT_COLORMAP,
  options: UVFFieldColorOptions = {},
): void {
  const field = fieldName ? asset.fields.find((f) => f.name === fieldName) : null
  asset.object.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    if (!isUVFSurfaceMesh(object)) return
    const geometry = object.geometry
    const positionAttr = geometry.getAttribute('position')
    if (!positionAttr) return
    const entityId = String(object.userData.groupId ?? object.userData.entityId ?? '')
    const inScope = !options.entityIds || options.entityIds.includes(entityId)
    if (field && inScope) {
      const fieldSection = findSectionByName(geometry, field.name)
      if (fieldSection) {
        const vertexCount = positionAttr.count
        const dimension = Math.max(1, field.dimension ?? fieldSection.length / vertexCount)
        const colors = new Float32Array(vertexCount * 3)
        const selectedRange = normalizeRange(options.range)
        for (let i = 0; i < vertexCount; i++) {
          const value = field.kind === 'vector'
            ? vectorMagnitude(fieldSection, i * dimension, dimension)
            : fieldSection[i * dimension] ?? 0
          if (selectedRange && (value < selectedRange[0] || value > selectedRange[1])) {
            const outside = options.outsideColor ?? [0.68, 0.7, 0.66]
            colors[i * 3] = outside[0]
            colors[i * 3 + 1] = outside[1]
            colors[i * 3 + 2] = outside[2]
          } else {
            const t = normalizeFieldValue(value, field.min, field.max, options.scale)
            const color = sampleColormap(t, colormap)
            colors[i * 3] = color.r
            colors[i * 3 + 1] = color.g
            colors[i * 3 + 2] = color.b
          }
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
        const material = ensureFieldColorMaterial(object)
        material.needsUpdate = true
      } else {
        if (geometry.getAttribute('color')) geometry.deleteAttribute('color')
        restoreBaseSurfaceMaterial(object)
      }
    } else {
      if (geometry.getAttribute('color')) {
        geometry.deleteAttribute('color')
      }
      restoreBaseSurfaceMaterial(object)
    }
  })
}

function ensureFieldColorMaterial(object: THREE.Mesh): THREE.MeshBasicMaterial {
  if (object.material instanceof THREE.MeshBasicMaterial && object.userData.uvfBaseMaterial) {
    return object.material
  }
  const base = object.material as THREE.MeshPhongMaterial
  object.userData.uvfBaseMaterial = base
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: base.side,
    transparent: base.transparent,
    opacity: base.opacity,
    depthTest: base.depthTest,
    depthWrite: base.depthWrite,
    polygonOffset: base.polygonOffset,
    polygonOffsetFactor: base.polygonOffsetFactor,
    polygonOffsetUnits: base.polygonOffsetUnits,
  })
  material.toneMapped = false
  object.material = material
  return material
}

function restoreBaseSurfaceMaterial(object: THREE.Mesh): void {
  const base = object.userData.uvfBaseMaterial
  if (base instanceof THREE.Material) {
    const fieldMaterials = Array.isArray(object.material) ? object.material : [object.material]
    object.material = base
    fieldMaterials.forEach((material) => {
      if (material !== base) material.dispose()
    })
    delete object.userData.uvfBaseMaterial
  }
  const material = object.material as THREE.MeshPhongMaterial
  material.vertexColors = false
  material.needsUpdate = true
}

export function collectFieldValues(asset: UVFAsset, fieldName: string): Float32Array {
  const field = asset.fields.find((candidate) => candidate.name === fieldName)
  if (!field) return new Float32Array()
  const usedIndices = new Map<THREE.BufferAttribute, Set<number> | null>()

  asset.object.traverse((object) => {
    if (!isUVFSurfaceMesh(object)) return
    const attribute = object.geometry.getAttribute(fieldName)
    if (!(attribute instanceof THREE.BufferAttribute)) return
    const index = object.geometry.getIndex()
    if (!index) {
      usedIndices.set(attribute, null)
      return
    }
    if (usedIndices.get(attribute) === null) return
    const indices = usedIndices.get(attribute) ?? new Set<number>()
    for (let offset = 0; offset < index.count; offset++) {
      indices.add(index.getX(offset))
    }
    usedIndices.set(attribute, indices)
  })

  const values: number[] = []
  for (const [attribute, indices] of usedIndices) {
    const dimension = Math.max(1, field.dimension ?? attribute.itemSize)
    const append = (index: number) => {
      const source = attribute.array as ArrayLike<number>
      const value = field.kind === 'vector'
        ? vectorMagnitudeLike(source, index * dimension, dimension)
        : source[index * dimension] ?? Number.NaN
      if (Number.isFinite(value)) values.push(value)
    }
    if (indices === null) {
      for (let index = 0; index < attribute.count; index++) append(index)
    } else {
      for (const index of indices) append(index)
    }
  }
  return Float32Array.from(values)
}

export function createFieldHistogram(
  asset: UVFAsset,
  fieldName: string,
  binCount = 24,
): UVFFieldHistogram | null {
  const field = asset.fields.find((candidate) => candidate.name === fieldName)
  if (!field) return null
  const values = collectFieldValues(asset, fieldName)
  const count = Math.max(1, Math.floor(binCount))
  const width = field.max - field.min
  const bins = Array.from({ length: count }, (_, index) => ({
    min: width === 0 ? field.min : field.min + width * index / count,
    max: width === 0 ? field.max : field.min + width * (index + 1) / count,
    count: 0,
  }))
  for (const value of values) {
    const index = width === 0
      ? 0
      : Math.min(count - 1, Math.max(0, Math.floor((value - field.min) / width * count)))
    bins[index].count++
  }
  return { field, sampleCount: values.length, bins }
}

export function probeFieldAtIntersection(
  asset: UVFAsset,
  mesh: THREE.Mesh,
  fieldName: string,
  faceIndex: number | null | undefined,
  worldPoint: THREE.Vector3,
): UVFFieldProbe | null {
  const field = asset.fields.find((candidate) => candidate.name === fieldName)
  const attribute = mesh.geometry.getAttribute(fieldName)
  const positions = mesh.geometry.getAttribute('position')
  if (!field || !(attribute instanceof THREE.BufferAttribute) || !positions || faceIndex == null) {
    return null
  }
  const index = mesh.geometry.getIndex()
  const offset = faceIndex * 3
  const vertexIndices = index
    ? [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)]
    : [offset, offset + 1, offset + 2]
  if (vertexIndices.some((vertexIndex) => vertexIndex < 0 || vertexIndex >= positions.count)) return null

  const vertices = vertexIndices.map((vertexIndex) => new THREE.Vector3().fromBufferAttribute(
    positions as THREE.BufferAttribute,
    vertexIndex,
  ))
  const localPoint = mesh.worldToLocal(worldPoint.clone())
  const barycentric = THREE.Triangle.getBarycoord(
    localPoint,
    vertices[0],
    vertices[1],
    vertices[2],
    new THREE.Vector3(),
  )
  if (!barycentric) return null
  const weights = [barycentric.x, barycentric.y, barycentric.z]
  const dimension = Math.max(1, field.dimension ?? attribute.itemSize)
  const components = Array.from({ length: dimension }, (_, component) => (
    vertexIndices.reduce(
      (sum, vertexIndex, corner) => sum + attribute.getComponent(vertexIndex, component) * weights[corner],
      0,
    )
  ))
  const value = field.kind === 'vector'
    ? Math.sqrt(components.reduce((sum, component) => sum + component * component, 0))
    : components[0]
  if (!Number.isFinite(value)) return null
  const assetPoint = asset.object.worldToLocal(worldPoint.clone())
  return {
    fieldName,
    value,
    entityId: String(mesh.userData.entityId ?? mesh.userData.groupId ?? mesh.uuid),
    position: [assetPoint.x, assetPoint.y, assetPoint.z],
  }
}

export function findFieldExtrema(asset: UVFAsset, fieldName: string): UVFFieldExtrema | null {
  const field = asset.fields.find((candidate) => candidate.name === fieldName)
  if (!field) return null
  const samples = new Map<THREE.BufferAttribute, Map<number, THREE.Mesh>>()
  asset.object.updateMatrixWorld(true)
  asset.object.traverse((object) => {
    if (!isUVFSurfaceMesh(object)) return
    const attribute = object.geometry.getAttribute(fieldName)
    const positions = object.geometry.getAttribute('position')
    if (!(attribute instanceof THREE.BufferAttribute) || !positions) return
    const vertices = samples.get(attribute) ?? new Map<number, THREE.Mesh>()
    const index = object.geometry.getIndex()
    if (index) {
      for (let offset = 0; offset < index.count; offset++) {
        const vertexIndex = index.getX(offset)
        if (!vertices.has(vertexIndex)) vertices.set(vertexIndex, object)
      }
    } else {
      for (let vertexIndex = 0; vertexIndex < attribute.count; vertexIndex++) {
        if (!vertices.has(vertexIndex)) vertices.set(vertexIndex, object)
      }
    }
    samples.set(attribute, vertices)
  })

  let min: UVFFieldProbe | null = null
  let max: UVFFieldProbe | null = null
  for (const [attribute, vertices] of samples) {
    const dimension = Math.max(1, field.dimension ?? attribute.itemSize)
    for (const [vertexIndex, mesh] of vertices) {
      const components = Array.from(
        { length: dimension },
        (_, component) => attribute.getComponent(vertexIndex, component),
      )
      const value = field.kind === 'vector'
        ? Math.sqrt(components.reduce((sum, component) => sum + component * component, 0))
        : components[0]
      if (!Number.isFinite(value)) continue
      const positionAttribute = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
      const worldPoint = mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(positionAttribute, vertexIndex))
      const assetPoint = asset.object.worldToLocal(worldPoint)
      const probe: UVFFieldProbe = {
        fieldName,
        value,
        entityId: String(mesh.userData.entityId ?? mesh.userData.groupId ?? mesh.uuid),
        position: [assetPoint.x, assetPoint.y, assetPoint.z],
      }
      if (!min || value < min.value) min = probe
      if (!max || value > max.value) max = probe
    }
  }
  return { field, min, max }
}

export function setWireframeOverlay(asset: UVFAsset, visible: boolean): void {
  const faces: THREE.Mesh[] = []
  asset.object.traverse((object) => {
    if (isUVFSurfaceMesh(object)) faces.push(object)
  })

  for (const face of faces) {
    const existing = face.children.find((child) => child.userData.uvfWireframeOverlay === true)
    const materials = Array.isArray(face.material) ? face.material : [face.material]
    if (visible) {
      if (existing) continue
      const indexCount = face.geometry.getIndex()?.count
        ?? face.geometry.getAttribute('position')?.count
        ?? 0
      const overlayOpacity = wireframeOpacityForTriangleCount(Math.floor(indexCount / 3))
      const overlay = new THREE.LineSegments(
        new THREE.WireframeGeometry(face.geometry),
        new THREE.LineBasicMaterial({
          color: 0x30352d,
          transparent: true,
          opacity: overlayOpacity,
          depthWrite: false,
        }),
      )
      overlay.name = `${face.name || face.uuid} wire overlay`
      overlay.userData.uvfWireframeOverlay = true
      overlay.userData.uvfWireframeOpacity = overlayOpacity
      overlay.userData.uvfWireframeTriangleCount = Math.floor(indexCount / 3)
      overlay.userData.uvfType = 'WireframeOverlay'
      overlay.renderOrder = face.renderOrder + 1
      face.add(overlay)
      for (const material of materials) {
        material.userData.uvfWirePolygonOffset = {
          enabled: material.polygonOffset,
          factor: material.polygonOffsetFactor,
          units: material.polygonOffsetUnits,
        }
        material.polygonOffset = true
        material.polygonOffsetFactor = 1
        material.polygonOffsetUnits = 1
        material.needsUpdate = true
      }
      continue
    }

    if (existing instanceof THREE.LineSegments) {
      face.remove(existing)
      existing.geometry.dispose()
      const overlayMaterials = Array.isArray(existing.material) ? existing.material : [existing.material]
      overlayMaterials.forEach((material) => material.dispose())
    }
    for (const material of materials) {
      const previous = material.userData.uvfWirePolygonOffset as {
        enabled: boolean
        factor: number
        units: number
      } | undefined
      if (!previous) continue
      material.polygonOffset = previous.enabled
      material.polygonOffsetFactor = previous.factor
      material.polygonOffsetUnits = previous.units
      delete material.userData.uvfWirePolygonOffset
      material.needsUpdate = true
    }
  }
}

export function setFieldFilterOverlay(asset: UVFAsset, filter: UVFFieldFilter | null): number {
  const fields = new Map(asset.fields.map((field) => [field.name, field]))
  const rules = filter?.enabled
    ? filter.rules.filter((rule) => Number.isFinite(rule.min) && Number.isFinite(rule.max))
    : []
  let matchingTriangles = 0

  asset.object.traverse((object) => {
    if (!isUVFSurfaceMesh(object)) return
    removeFieldFilterOverlay(object)
    if (!filter?.enabled || rules.length === 0) return

    const geometry = object.geometry
    const positions = geometry.getAttribute('position')
    if (!(positions instanceof THREE.BufferAttribute)) return
    const index = geometry.getIndex()
    const triangleCount = Math.floor((index?.count ?? positions.count) / 3)
    const segmentIndices: number[] = []
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const offset = triangle * 3
      const vertices = index
        ? [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)]
        : [offset, offset + 1, offset + 2]
      const matches = rules.map((rule) => triangleMatchesFieldRule(geometry, fields.get(rule.fieldName), rule, vertices))
      const matchesFilter = filter.operator === 'or' ? matches.some(Boolean) : matches.every(Boolean)
      if (!matchesFilter) continue
      matchingTriangles++
      for (const [from, to] of [[0, 1], [1, 2], [2, 0]]) {
        segmentIndices.push(vertices[from], vertices[to])
      }
    }
    if (segmentIndices.length === 0) return

    const overlayGeometry = new THREE.BufferGeometry()
    overlayGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions.array, positions.itemSize, positions.normalized),
    )
    overlayGeometry.setIndex(segmentIndices)
    const overlay = new THREE.LineSegments(
      overlayGeometry,
      new THREE.LineBasicMaterial({
        color: 0xff5a1f,
        transparent: true,
        opacity: 0.98,
        depthWrite: false,
      }),
    )
    overlay.name = `${object.name || object.uuid} field filter overlay`
    overlay.userData.uvfFieldFilterOverlay = true
    overlay.userData.uvfType = 'FieldFilterOverlay'
    overlay.renderOrder = object.renderOrder + 3
    object.add(overlay)
  })
  return matchingTriangles
}

function triangleMatchesFieldRule(
  geometry: THREE.BufferGeometry,
  field: UVFFieldInfo | undefined,
  rule: UVFFieldFilterRule,
  vertices: number[],
): boolean {
  if (!field) return false
  const attribute = geometry.getAttribute(rule.fieldName)
  if (!(attribute instanceof THREE.BufferAttribute)) return false
  const dimension = Math.max(1, field.dimension ?? attribute.itemSize)
  const values = vertices.map((vertex) => {
    if (field.kind === 'vector') {
      let squared = 0
      for (let component = 0; component < dimension; component++) {
        const value = attribute.getComponent(vertex, component)
        squared += value * value
      }
      return Math.sqrt(squared)
    }
    return attribute.getComponent(vertex, 0)
  })
  if (values.some((value) => !Number.isFinite(value))) return false
  const value = values.reduce((sum, sample) => sum + sample, 0) / values.length
  return value >= Math.min(rule.min, rule.max) && value <= Math.max(rule.min, rule.max)
}

function removeFieldFilterOverlay(face: THREE.Mesh): void {
  const existing = face.children.filter((child) => child.userData.uvfFieldFilterOverlay === true)
  for (const child of existing) {
    face.remove(child)
    if (!(child instanceof THREE.LineSegments)) continue
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach((material) => material.dispose())
  }
}

export function wireframeOpacityForTriangleCount(triangleCount: number): number {
  if (!Number.isFinite(triangleCount) || triangleCount <= 0) return 0.32
  const densityAdjusted = 0.12 + 0.5 / (1 + Math.sqrt(triangleCount / 1_500))
  return Math.max(0.16, Math.min(0.42, densityAdjusted))
}

export function wireframeOverlayOpacity(object: THREE.Object3D, selected = false): number | null {
  if (object.userData.uvfWireframeOverlay !== true) return null
  const stored = object.userData.uvfWireframeOpacity
  const base = typeof stored === 'number' && Number.isFinite(stored) ? stored : 0.32
  return selected ? Math.max(base, 0.48) : base
}

export function wireframeOpacityForScreenDensity(baseOpacity: number, pixelAreaPerTriangle: number): number {
  if (!Number.isFinite(baseOpacity) || baseOpacity <= 0) return 0
  // A triangle with only a few pixels of projected area cannot produce three
  // distinct anti-aliased edges. Showing it anyway turns dense surface meshes
  // into a low-frequency moire/camouflage pattern. Keep the overlay off until
  // an average triangle is actually readable, then fade it in gradually.
  if (!Number.isFinite(pixelAreaPerTriangle) || pixelAreaPerTriangle <= 24) return 0
  if (pixelAreaPerTriangle >= 96) return baseOpacity
  return baseOpacity * (pixelAreaPerTriangle - 24) / 72
}

export function updateWireframeOverlayForCamera(
  asset: UVFAsset,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
): void {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return
  const focalPixels = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
  asset.object.updateMatrixWorld(true)
  asset.object.traverse((object) => {
    if (!(object instanceof THREE.LineSegments) || object.userData.uvfWireframeOverlay !== true) return
    const triangleCount = Number(object.userData.uvfWireframeTriangleCount)
    if (!Number.isFinite(triangleCount) || triangleCount <= 0) return
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere()
    const sphere = object.geometry.boundingSphere
    if (!sphere) return
    const center = sphere.center.clone().applyMatrix4(object.matrixWorld)
    const scale = object.matrixWorld.getMaxScaleOnAxis()
    const distance = Math.max(camera.position.distanceTo(center), camera.near)
    const projectedRadius = sphere.radius * scale / distance * focalPixels
    const pixelAreaPerTriangle = Math.PI * projectedRadius * projectedRadius / triangleCount
    const baseOpacity = wireframeOverlayOpacity(object, object.userData.uvfWireframeSelected === true) ?? 0
    const opacity = wireframeOpacityForScreenDensity(baseOpacity, pixelAreaPerTriangle)
    object.visible = opacity > 0.01
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => {
      if (!(material instanceof THREE.LineBasicMaterial)) return
      material.opacity = opacity
      material.needsUpdate = true
    })
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

function sectionBuffer(buffers: Map<string, ArrayBuffer>, buffer: UVFBuffer, section: UVFBufferSection) {
  const path = section.path ?? buffer.path
  const raw = buffers.get(path)
  if (!raw) throw new Error(`UVF buffer ${path} was not loaded`)
  return raw
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
  return vectorMagnitudeLike(values, offset, dimension)
}

function vectorMagnitudeLike(values: ArrayLike<number>, offset: number, dimension: number) {
  let sum = 0
  for (let component = 0; component < dimension; component++) {
    const value = values[offset + component] ?? 0
    sum += value * value
  }
  return Math.sqrt(sum)
}

function normalizeRange(range: [number, number] | null | undefined): [number, number] | null {
  if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1])) return null
  return range[0] <= range[1] ? range : [range[1], range[0]]
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
  fields: UVFFieldInfo[],
): UVFEntityInfo[] {
  const childrenByID = new Map<string, string[]>()
  for (const [childId, parentId] of parentByID) {
    const children = childrenByID.get(parentId) ?? []
    children.push(childId)
    childrenByID.set(parentId, children)
  }
  return entries
    .filter((entry) => objectByID.has(entry.id))
    .map((entry) => {
      const object = objectByID.get(entry.id)!
      const entityFields = fields.filter((field) => {
        let available = false
        object.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry.getAttribute(field.name)) available = true
        })
        return available
      }).map((field) => field.name)
      return {
        id: entry.id,
        name: entry.name || entry.id,
        type: entry.type,
        parentId: parentByID.get(entry.id) ?? null,
        children: childrenByID.get(entry.id) ?? [],
        fields: entityFields,
      }
    })
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
