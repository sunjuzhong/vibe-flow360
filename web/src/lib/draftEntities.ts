import * as THREE from 'three'

export type ParameterEntityType =
  | 'Box'
  | 'Cylinder'
  | 'Point'
  | 'Sphere'
  | 'AxisymmetricBody'
  | 'CustomVolume'
  | 'SeedpointVolume'
  | 'PointArray'
  | 'PointArray2D'
  | 'Slice'
  | 'GhostSphere'
  | 'GhostCircularPlane'
  | 'WindTunnelGhostSurface'

export type ParameterEntity = {
  id: string
  key: string
  name: string
  type: ParameterEntityType
  source: 'draft' | 'ghost'
  renderable: boolean
  raw: Record<string, unknown>
  lengthUnit?: string
}

const supportedDraftTypes = new Set<ParameterEntityType>([
  'Box', 'Cylinder', 'Point', 'Sphere', 'AxisymmetricBody', 'CustomVolume',
  'SeedpointVolume', 'PointArray', 'PointArray2D', 'Slice',
])

const supportedGhostTypes = new Set<ParameterEntityType>([
  'GhostSphere', 'GhostCircularPlane', 'WindTunnelGhostSurface',
])

const unitMetres: Record<string, number> = {
  m: 1,
  cm: 0.01,
  mm: 0.001,
  km: 1000,
  in: 0.0254,
  inch: 0.0254,
  ft: 0.3048,
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function quantityUnit(value: unknown): string | undefined {
  const unit = record(value).units
  return typeof unit === 'string' && unit.trim() ? unit.trim() : undefined
}

function parseEntityCollection(
  params: unknown,
  collectionName: 'draft_entities' | 'ghost_entities',
  supportedTypes: Set<ParameterEntityType>,
  source: ParameterEntity['source'],
): ParameterEntity[] {
  const cache = record(record(params).private_attribute_asset_cache)
  const info = record(cache.project_entity_info)
  const candidates = Array.isArray(info[collectionName])
    ? info[collectionName] as unknown[]
    : Array.isArray(cache[collectionName]) ? cache[collectionName] as unknown[] : []
  const projectUnit = quantityUnit(cache.project_length_unit)
  const seen = new Set<string>()
  return candidates.flatMap((candidate, index) => {
    const raw = record(candidate)
    const typeValue = raw.private_attribute_entity_type_name ?? raw.type_name ?? raw.type
    if (typeof typeValue !== 'string' || !supportedTypes.has(typeValue as ParameterEntityType)) return []
    const idValue = raw.private_attribute_id ?? raw.id
    const id = typeof idValue === 'string' && idValue.trim()
      ? idValue.trim()
      : `${source}-entity-${typeValue}-${index}`
    if (seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      key: `${source}:${id}`,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `${typeValue} ${index + 1}`,
      type: typeValue as ParameterEntityType,
      source,
      renderable: typeValue !== 'WindTunnelGhostSurface',
      raw,
      lengthUnit: projectUnit,
    }]
  })
}

export function parseDraftEntities(params: unknown): ParameterEntity[] {
  return parseEntityCollection(params, 'draft_entities', supportedDraftTypes, 'draft')
}

export function parseGhostEntities(params: unknown): ParameterEntity[] {
  return parseEntityCollection(params, 'ghost_entities', supportedGhostTypes, 'ghost')
}

function quantity(value: unknown, targetUnit?: string): number | number[] | null {
  const wrapper = record(value)
  const raw = 'value' in wrapper ? wrapper.value : value
  const sourceUnit = quantityUnit(value)
  const factor = sourceUnit && targetUnit && unitMetres[sourceUnit] && unitMetres[targetUnit]
    ? unitMetres[sourceUnit] / unitMetres[targetUnit]
    : 1
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw * factor
  if (Array.isArray(raw) && raw.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return raw.map((entry) => entry * factor)
  }
  return null
}

function scalar(value: unknown, unit?: string, fallback = 0): number {
  const result = quantity(value, unit)
  return typeof result === 'number' ? result : fallback
}

function vector(value: unknown, unit?: string, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const result = quantity(value, unit)
  return Array.isArray(result) && result.length >= 3
    ? [result[0], result[1], result[2]]
    : fallback
}

function direction(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  const raw = Array.isArray(value) ? value : []
  const next = raw.length >= 3 && raw.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    ? new THREE.Vector3(raw[0] as number, raw[1] as number, raw[2] as number)
    : new THREE.Vector3(...fallback)
  return next.lengthSq() > 1e-12 ? next.normalize() : new THREE.Vector3(...fallback)
}

function orientY(object: THREE.Object3D, axis: unknown) {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction(axis, [0, 0, 1]))
}

function orientBox(object: THREE.Object3D, axes: unknown) {
  if (!Array.isArray(axes) || axes.length < 2) return
  const x = direction(axes[0], [1, 0, 0])
  const yCandidate = direction(axes[1], [0, 1, 0])
  const z = new THREE.Vector3().crossVectors(x, yCandidate).normalize()
  if (z.lengthSq() < 1e-12) return
  const y = new THREE.Vector3().crossVectors(z, x).normalize()
  object.setRotationFromMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

function lineMaterial(color: number) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: true })
}

function meshMaterial(color: number, opacity = 0.2) {
  return new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
}

function edgedMesh(geometry: THREE.BufferGeometry, color: number) {
  const group = new THREE.Group()
  group.add(new THREE.Mesh(geometry, meshMaterial(color)))
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), lineMaterial(color)))
  return group
}

function pointsObject(points: Array<[number, number, number]>, color: number, pointSize: number) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(...point)))
  const material = new THREE.PointsMaterial({ color, size: pointSize, sizeAttenuation: true })
  return new THREE.Points(geometry, material)
}

function entityObject(entity: ParameterEntity, contextSize: number): THREE.Object3D {
  const { raw, lengthUnit: unit } = entity
  const color = entity.source === 'ghost' ? 0x8b5cf6 : 0x0ea5a8
  const center = vector(raw.center, unit)
  let object: THREE.Object3D
  switch (entity.type) {
    case 'Box': {
      const size = vector(raw.size, unit, [contextSize * 0.2, contextSize * 0.2, contextSize * 0.2])
      object = edgedMesh(new THREE.BoxGeometry(Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2])), color)
      orientBox(object, raw.axes ?? record(raw.private_attribute_input_cache).axes)
      object.position.set(...center)
      break
    }
    case 'Cylinder': {
      const height = Math.abs(scalar(raw.height, unit, contextSize * 0.4))
      const outer = Math.abs(scalar(raw.outer_radius, unit, contextSize * 0.15))
      const inner = Math.max(0, Math.abs(scalar(raw.inner_radius, unit)))
      const geometry = inner > 0 && inner < outer
        ? new THREE.RingGeometry(inner, outer, 48)
        : new THREE.CylinderGeometry(outer, outer, height, 48, 1, false)
      object = edgedMesh(geometry, color)
      orientY(object, raw.axis)
      object.position.set(...center)
      break
    }
    case 'Sphere': {
      object = edgedMesh(new THREE.SphereGeometry(Math.abs(scalar(raw.radius, unit, contextSize * 0.15)), 32, 20), color)
      object.position.set(...center)
      break
    }
    case 'GhostSphere': {
      object = edgedMesh(new THREE.SphereGeometry(Math.abs(scalar(raw.max_radius, unit, contextSize * 0.5)), 40, 24), color)
      object.position.set(...center)
      break
    }
    case 'GhostCircularPlane': {
      object = edgedMesh(new THREE.CircleGeometry(Math.abs(scalar(raw.max_radius, unit, contextSize * 0.5)), 64), color)
      object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction(raw.normal_axis, [0, 0, 1]))
      object.position.set(...center)
      break
    }
    case 'WindTunnelGhostSurface': {
      object = new THREE.Group()
      break
    }
    case 'Point': {
      object = pointsObject([vector(raw.location, unit)], color, contextSize * 0.025)
      break
    }
    case 'PointArray': {
      const start = vector(raw.start, unit)
      const end = vector(raw.end, unit)
      const count = Math.max(1, Math.min(10000, Math.floor(scalar(raw.number_of_points, undefined, 1))))
      const points = Array.from({ length: count }, (_, index) => {
        const ratio = count === 1 ? 0 : index / (count - 1)
        return start.map((value, axis) => value + (end[axis] - value) * ratio) as [number, number, number]
      })
      object = pointsObject(points, color, contextSize * 0.018)
      break
    }
    case 'PointArray2D': {
      const origin = vector(raw.origin, unit)
      const u = vector(raw.u_axis_vector, unit, [contextSize * 0.2, 0, 0])
      const v = vector(raw.v_axis_vector, unit, [0, contextSize * 0.2, 0])
      const uCount = Math.max(1, Math.min(250, Math.floor(scalar(raw.u_number_of_points, undefined, 1))))
      const vCount = Math.max(1, Math.min(250, Math.floor(scalar(raw.v_number_of_points, undefined, 1))))
      const points: Array<[number, number, number]> = []
      for (let j = 0; j < vCount; j += 1) for (let i = 0; i < uCount; i += 1) {
        points.push(origin.map((value, axis) => value + u[axis] * i + v[axis] * j) as [number, number, number])
      }
      object = pointsObject(points, color, contextSize * 0.012)
      break
    }
    case 'Slice': {
      const size = contextSize * 0.65
      object = edgedMesh(new THREE.PlaneGeometry(size, size), color)
      orientY(object, raw.normal)
      object.rotateX(Math.PI / 2)
      object.position.set(...vector(raw.origin, unit))
      break
    }
    case 'AxisymmetricBody': {
      const profile = Array.isArray(raw.profile_curve) ? raw.profile_curve : []
      const points = profile.flatMap((entry) => {
        const pair = quantity(entry, unit)
        return Array.isArray(pair) && pair.length >= 2 ? [new THREE.Vector2(Math.abs(pair[0]), pair[1])] : []
      })
      object = points.length >= 2
        ? edgedMesh(new THREE.LatheGeometry(points, 48), color)
        : edgedMesh(new THREE.CylinderGeometry(contextSize * 0.1, contextSize * 0.1, contextSize * 0.3, 32), color)
      orientY(object, raw.axis)
      object.position.set(...center)
      break
    }
    case 'SeedpointVolume': {
      const values = Array.isArray(raw.point_in_mesh) ? raw.point_in_mesh : []
      const points = values.flatMap((value) => {
        const point = quantity(value, unit)
        return Array.isArray(point) && point.length >= 3 ? [[point[0], point[1], point[2]] as [number, number, number]] : []
      })
      object = pointsObject(points.length ? points : [center], color, contextSize * 0.025)
      break
    }
    case 'CustomVolume':
    default: {
      object = new THREE.AxesHelper(contextSize * 0.15)
      orientBox(object, raw.axes)
      object.position.set(...center)
      break
    }
  }
  object.name = entity.name
  object.userData.entityId = entity.key
  object.userData.groupId = entity.key
  object.userData.parameterEntity = true
  object.visible = false
  object.traverse((child) => {
    child.userData.entityId = entity.key
    child.userData.groupId = entity.key
    child.userData.parameterEntity = true
  })
  return object
}

export function createParameterEntityGroup(entities: ParameterEntity[], bounds: THREE.Box3): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Parameter entities'
  group.userData.parameterEntities = true
  const size = bounds.getSize(new THREE.Vector3()).length()
  const contextSize = Number.isFinite(size) && size > 0 ? size : 1
  for (const entity of entities) group.add(entityObject(entity, contextSize))
  return group
}

export function setParameterEntityVisibility(root: THREE.Object3D | null, visibility: Record<string, boolean>) {
  root?.traverse((object) => {
    if (object.userData.parameterEntity === true) object.visible = visibility[String(object.userData.entityId)] ?? false
  })
}
