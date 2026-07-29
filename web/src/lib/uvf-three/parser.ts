import type { UVFBuffer, UVFEntry, UVFLOD } from './types'

const maxManifestEntries = 100_000

export function parseUVFManifest(value: unknown): UVFEntry[] {
  if (!Array.isArray(value)) throw new Error('UVF manifest must be an array')
  if (value.length === 0) throw new Error('UVF manifest is empty')
  if (value.length > maxManifestEntries) throw new Error('UVF manifest is too large')
  const entries = value as UVFEntry[]
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.type !== 'string') {
      throw new Error('UVF manifest contains an invalid entry')
    }
    if (entry.type === 'SolidGeometry') resolveUVFBuffer(entry)
  }
  return entries
}

export function resolveUVFBuffer(entry: UVFEntry, lodLevel?: number): UVFBuffer {
  const buffers = entry.resources?.buffers
  if (!buffers) throw new Error(`SolidGeometry ${entry.id} has no buffers`)
  if (buffers.type !== 'lod') {
    validateUVFBuffer(buffers)
    return buffers
  }
  const lod = buffers as UVFLOD
  const level = lodLevel ?? lod.default ?? 0
  const resolved = lod.levels?.[level]
  if (!resolved) throw new Error(`SolidGeometry ${entry.id} has no LOD ${level}`)
  validateUVFBuffer(resolved)
  return resolved
}

export function safeUVFBufferPath(path: string) {
  if (
    !path ||
    path.includes('\\') ||
    path.startsWith('/') ||
    path.split('/').some((part) => part === '..' || part === '') ||
    !path.toLowerCase().endsWith('.bin')
  ) {
    throw new Error('UVF buffer path is unsafe')
  }
  return path
}

function validateUVFBuffer(buffer: UVFBuffer) {
  safeUVFBufferPath(buffer.path)
  if (!Array.isArray(buffer.sections)) throw new Error(`UVF buffer ${buffer.path} has no sections`)
  for (const section of buffer.sections) {
    if (
      !section ||
      typeof section.name !== 'string' ||
      !Number.isSafeInteger(section.offset) ||
      !Number.isSafeInteger(section.length) ||
      section.offset < 0 ||
      section.length < 0
    ) {
      throw new Error(`UVF buffer ${buffer.path} contains an invalid section`)
    }
  }
}
