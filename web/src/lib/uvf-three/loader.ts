import * as THREE from 'three'
import { parseUVFManifest, resolveUVFBuffer, safeUVFBufferPath } from './parser'
import type { UVFAsset, UVFBufferSection, UVFEntry, UVFLoadProgress } from './types'

const maxManifestBytes = 2 * 1024 * 1024
const maxBufferBytes = 25 * 1024 * 1024
const maxBufferFiles = 10

type LoadOptions = {
  signal?: AbortSignal
  lodLevel?: number
  onProgress?: (progress: UVFLoadProgress) => void
}

export class Flow360UVFLoader {
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

export function buildUVFAsset(
  entries: UVFEntry[],
  buffers: Map<string, ArrayBuffer>,
  lodLevel?: number,
): UVFAsset {
  const root = new THREE.Group()
  root.name = 'Flow360 UVF Geometry'
  const byID = new Map(entries.map((entry) => [entry.id, entry]))
  let faces = 0
  let edges = 0
  let vertices = 0
  let triangles = 0

  for (const solid of entries.filter((entry) => entry.type === 'SolidGeometry')) {
    const bufferInfo = resolveUVFBuffer(solid, lodLevel)
    const raw = buffers.get(bufferInfo.path)
    if (!raw) throw new Error(`UVF buffer ${bufferInfo.path} was not loaded`)
    const positionSection = findSection(bufferInfo.sections, 'position')
    const normalSection = findSection(bufferInfo.sections, 'normal')
    const indexSection = findSection(bufferInfo.sections, 'indices')
    const edgeSection = findSection(bufferInfo.sections, 'edgePosition')
    if (!positionSection) throw new Error(`SolidGeometry ${solid.id} has no position section`)
    const positions = floatSection(raw, positionSection)
    const normals = normalSection ? floatSection(raw, normalSection) : null
    const indices = indexSection ? uintSection(raw, indexSection) : null
    const edgePositions = edgeSection ? floatSection(raw, edgeSection) : null
    vertices += positions.length / 3

    for (const faceID of solid.attributions?.faces ?? []) {
      const face = byID.get(faceID)
      if (!face || face.type !== 'Face') continue
      const ranges = face.properties?.bufferLocations?.indices ?? []
      const faceIndices = indices
        ? concatenateIndices(ranges.map((range) => indices.slice(range.startIndex, range.endIndex)))
        : undefined
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      if (normals && normals.length === positions.length) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      } else {
        geometry.computeVertexNormals()
      }
      if (faceIndices) geometry.setIndex(new THREE.BufferAttribute(faceIndices, 1))
      const faceTriangles = faceIndices
        ? Math.floor(faceIndices.length / 3)
        : ranges.reduce((count, range) => count + Math.floor((range.endIndex - range.startIndex) / 9), 0)
      const material = new THREE.MeshPhongMaterial({
        color: new THREE.Color(faceColor(face.properties?.color, faces)),
        side: THREE.DoubleSide,
        transparent: true,
        opacity: face.properties?.alpha ?? 0.92,
        shininess: 35,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = face.name || face.id
      mesh.userData.groupId = face.id
      mesh.userData.uvfType = 'Face'
      root.add(mesh)
      faces++
      triangles += faceTriangles
    }

    if (edgePositions) {
      for (const edgeID of solid.attributions?.edges ?? []) {
        const edge = byID.get(edgeID)
        if (!edge || edge.type !== 'Edge') continue
        for (const range of edge.properties?.bufferLocations?.indices ?? []) {
          if (range.endIndex <= range.startIndex) continue
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
          root.add(line)
        }
        edges++
      }
    }
  }
  if (!faces) throw new Error('UVF manifest produced no renderable faces')
  return {
    object: root,
    faces,
    edges,
    vertices,
    triangles,
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

function faceColor(value: number | undefined, index: number) {
  if (typeof value === 'number' && value !== 0xffffff) return value
  const palette = [0x789521, 0x2b7de9, 0xf97316, 0xec4899, 0x8b5cf6, 0x06b6d4]
  return palette[index % palette.length]
}

function enforceContentLength(response: Response, limit: number, label: string) {
  const length = Number(response.headers.get('Content-Length') || 0)
  if (Number.isFinite(length) && length > limit) throw new Error(`${label} exceeds the size limit`)
}
