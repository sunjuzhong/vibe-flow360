import { unwrapSimulationParams } from './planStages'

export type ParameterSelectionMember = {
  id: string
  name?: string
  path?: string[]
}

export type ParameterSelectionPreset = {
  id: string
  label: string
  tag: string
  memberIds: string[]
}

type ParameterEntity = {
  id: string
  name: string
  tag: string
  components: string[]
}

const collectionByKind = {
  face: 'grouped_faces',
  edge: 'grouped_edges',
  body: 'grouped_bodies',
} as const

const activeTagByKind = {
  face: 'face_group_tag',
  edge: 'edge_group_tag',
  body: 'body_group_tag',
} as const

export type ParameterSelectionKind = keyof typeof collectionByKind

export function buildParameterSelectionPresets(
  simulationParams: unknown,
  kind: ParameterSelectionKind,
  members: readonly ParameterSelectionMember[],
): ParameterSelectionPreset[] {
  if (members.length < 2) return []
  const params = unwrapSimulationParams(simulationParams)
  const cache = record(params.private_attribute_asset_cache)
  const info = record(cache.project_entity_info)
  const entitySchemes = array(info[collectionByKind[kind]])
    .map((candidate) => array(candidate).map(parameterEntity).filter(isDefined))
    .filter((scheme) => scheme.length > 0)
  const bodySchemes = kind === 'body' ? [] : array(info.grouped_bodies)
    .map((candidate) => array(candidate)
      .map((value) => bodySelectionEntity(value, info, kind))
      .filter(isDefined))
    .filter((scheme) => scheme.length > 0)
  const schemes = [...entitySchemes, ...bodySchemes]
  if (schemes.length === 0) return []

  const entities = schemes.flat()
  const activeTag = text(info[activeTagByKind[kind]])
  const memberComponents = new Map(members.map((member) => [
    member.id,
    resolveMemberComponents(member, entities, activeTag),
  ]))

  const candidates = entities.flatMap((entity) => {
    const entityKeys = normalizedSet([entity.id, entity.name])
    const presetComponents = normalizedSet(entity.components)
    const memberIds = members.flatMap((member) => {
      const directMatch = memberKeys(member).some((key) => entityKeys.has(key))
      const components = memberComponents.get(member.id) ?? new Set<string>()
      const contained = components.size > 0 && [...components].every((component) => presetComponents.has(component))
      return directMatch || contained ? [member.id] : []
    })
    if (memberIds.length === 0) return []
    if (memberIds.length === 1) {
      if (entity.tag === 'faceId' || entity.tag === 'edgeId') return []
      const member = members.find((candidate) => candidate.id === memberIds[0])
      if (member && memberKeys(member).some((key) => entityKeys.has(key))) return []
    }
    return [{
      id: `${kind}:${entity.tag}:${entity.id}`,
      label: entity.name || entity.id,
      tag: entity.tag,
      memberIds: [...new Set(memberIds)],
      score: presetScore(entity, activeTag),
    }]
  })

  const bestByMembers = new Map<string, typeof candidates[number]>()
  for (const candidate of candidates) {
    const key = `${candidate.tag}\u0001${[...candidate.memberIds].sort().join('\u0000')}`
    const current = bestByMembers.get(key)
    if (!current || candidate.score > current.score) bestByMembers.set(key, candidate)
  }

  const uniqueSelections = new Map<string, typeof candidates[number]>()
  for (const candidate of bestByMembers.values()) {
    const key = `${normalize(candidate.label)}\u0001${[...candidate.memberIds].sort().join('\u0000')}`
    const current = uniqueSelections.get(key)
    if (!current || candidate.score > current.score) uniqueSelections.set(key, candidate)
  }

  return [...uniqueSelections.values()]
    .sort((left, right) => left.tag.localeCompare(right.tag) || left.label.localeCompare(right.label))
    .map(({ score: _score, ...preset }) => preset)
}

function bodySelectionEntity(
  value: unknown,
  info: Record<string, unknown>,
  kind: Exclude<ParameterSelectionKind, 'body'>,
): ParameterEntity | undefined {
  const entity = parameterEntity(value)
  if (!entity) return undefined
  const bodyIndex = record(info.bodies_face_edge_ids)
  const componentKey = kind === 'face' ? 'face_ids' : 'edge_ids'
  const components = entity.components.flatMap((bodyId) =>
    array(record(bodyIndex[bodyId])[componentKey]).map(text).filter(Boolean),
  )
  return components.length > 0 ? { ...entity, components } : undefined
}

function resolveMemberComponents(
  member: ParameterSelectionMember,
  entities: ParameterEntity[],
  activeTag: string,
): Set<string> {
  const keys = new Set(memberKeys(member))
  const matching = entities.filter((entity) => [entity.id, entity.name].some((value) => keys.has(normalize(value))))
  const best = matching.sort((left, right) => Number(right.tag === activeTag) - Number(left.tag === activeTag))[0]
  return normalizedSet(best?.components.length ? best.components : [member.id, member.name ?? '', ...(member.path ?? [])])
}

function parameterEntity(value: unknown): ParameterEntity | undefined {
  const entity = record(value)
  const id = text(entity.private_attribute_id) || text(entity.id) || text(entity.name)
  const name = text(entity.name) || id
  const tag = text(entity.private_attribute_tag_key) || 'group'
  if (!id || !name) return undefined
  const components = array(entity.private_attribute_sub_components).map(text).filter(Boolean)
  return { id, name, tag, components: components.length ? components : [id, name] }
}

function presetScore(entity: ParameterEntity, activeTag: string): number {
  return Number(entity.tag === activeTag) * 100
    + Number(!/^no[ _-]?name$/i.test(entity.name)) * 20
    + Number(!/builtin|(?:^|_)id$/i.test(entity.tag)) * 10
}

function memberKeys(member: ParameterSelectionMember): string[] {
  return [member.id, member.name ?? '', ...(member.path ?? [])].map(normalize).filter(Boolean)
}

function normalizedSet(values: readonly string[]): Set<string> {
  return new Set(values.map(normalize).filter(Boolean))
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
