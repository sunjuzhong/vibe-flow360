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
  faceIds?: string[]
  edgeIds?: string[]
  available?: boolean
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

const attributeNamesByKind = {
  face: 'face_attribute_names',
  edge: 'edge_attribute_names',
  body: 'body_attribute_names',
} as const

export type ParameterSelectionKind = keyof typeof collectionByKind

export type DraftSelectionGroup = {
  name: string
  faces: readonly ParameterSelectionMember[]
  edges: readonly ParameterSelectionMember[]
}

type DraftParameterValidation = {
  valid: boolean
  issues: Array<{ level: string; path?: string; message: string }>
}

export async function persistDraftSelectionGroup(
  simulationParams: Record<string, unknown>,
  group: DraftSelectionGroup,
  validate: (next: Record<string, unknown>) => Promise<DraftParameterValidation>,
  update: (next: Record<string, unknown>) => Promise<{ simulation_params: Record<string, unknown> }>,
): Promise<Record<string, unknown>> {
  const next = applyDraftSelectionGroup(simulationParams, group)
  const validation = await validate(next)
  const blockingIssue = validation.issues.find((issue) => issue.level === 'error')
  if (!validation.valid || blockingIssue) {
    throw new Error(blockingIssue
      ? `${blockingIssue.path ? `${blockingIssue.path}: ` : ''}${blockingIssue.message}`
      : 'The updated Draft SimulationParams are invalid.')
  }
  const response = await update(next)
  return response.simulation_params
}

export function applyDraftSelectionGroup(
  simulationParams: Record<string, unknown>,
  group: DraftSelectionGroup,
): Record<string, unknown> {
  const name = group.name.trim()
  if (!name) throw new Error('Selection group name is required.')
  if (group.faces.length + group.edges.length === 0) {
    throw new Error('Select at least one face or edge before saving a selection group.')
  }

  const cache = record(simulationParams.private_attribute_asset_cache)
  const info = record(cache.project_entity_info)
  const duplicate = [...parameterEntities(info.grouped_faces), ...parameterEntities(info.grouped_edges)]
    .some((entity) => entity.tag === 'groupName' && normalize(entity.name) === normalize(name))
  if (duplicate) throw new Error(`A selection group named “${name}” already exists.`)

  const nextInfo: Record<string, unknown> = { ...info }
  const selections: Array<{
    kind: 'face' | 'edge'
    members: readonly ParameterSelectionMember[]
    entityType: 'Surface' | 'Edge'
  }> = [
    { kind: 'face', members: group.faces, entityType: 'Surface' },
    { kind: 'edge', members: group.edges, entityType: 'Edge' },
  ]
  for (const selection of selections) {
    if (selection.members.length === 0) continue
    const collectionKey = collectionByKind[selection.kind]
    const schemes = entitySchemes(info[collectionKey])
    const entities = schemes.flat().map(parameterEntity).filter(isDefined)
    const activeTag = text(info[activeTagByKind[selection.kind]])
    const components = [...new Set(selection.members.flatMap((member) => (
      [...resolveMemberComponents(member, entities, activeTag)]
    )))]
    if (components.length === 0) continue
    const entity = {
      name,
      private_attribute_entity_type_name: selection.entityType,
      private_attribute_id: name,
      private_attribute_sub_components: components,
      private_attribute_tag_key: 'groupName',
    }
    const groupNameIndex = schemes.findIndex((scheme) => scheme.some((candidate) => (
      text(record(candidate).private_attribute_tag_key) === 'groupName'
    )))
    nextInfo[collectionKey] = groupNameIndex >= 0
      ? schemes.map((scheme, index) => index === groupNameIndex ? [...scheme, entity] : scheme)
      : [...schemes, [entity]]
    const attributeNamesKey = attributeNamesByKind[selection.kind]
    nextInfo[attributeNamesKey] = [...new Set([
      ...array(info[attributeNamesKey]).map(text).filter(Boolean),
      'groupName',
    ])]
  }

  return {
    ...simulationParams,
    private_attribute_asset_cache: {
      ...cache,
      project_entity_info: nextInfo,
    },
  }
}

export function buildGeometryParameterSelectionPresets(
  simulationParams: unknown,
  faces: readonly ParameterSelectionMember[],
  edges: readonly ParameterSelectionMember[],
): ParameterSelectionPreset[] {
  const params = unwrapSimulationParams(simulationParams)
  const info = record(record(params.private_attribute_asset_cache).project_entity_info)
  const faceEntities = parameterEntities(info.grouped_faces)
  const edgeEntities = parameterEntities(info.grouped_edges)
  const bodyIndex = record(info.bodies_face_edge_ids)
  const declaredBodyEntities = parameterEntities(info.grouped_bodies)
  const bodyEntities = declaredBodyEntities.length > 0
    ? declaredBodyEntities
    : Object.keys(bodyIndex).map((bodyId) => ({
        id: bodyId,
        name: bodyId,
        tag: 'bodyId',
        components: [bodyId],
      }))
  const facePresets = buildParameterSelectionPresets(simulationParams, 'face', faces)
    .map((preset) => ({ ...preset, faceIds: preset.memberIds, edgeIds: [] }))
  const edgePresets = buildParameterSelectionPresets(simulationParams, 'edge', edges)
    .map((preset) => ({ ...preset, faceIds: [], edgeIds: preset.memberIds }))
  const faceComponents = memberComponentIndex(faces, faceEntities, text(info.face_group_tag))
  const edgeComponents = memberComponentIndex(edges, edgeEntities, text(info.edge_group_tag))

  const bodyPresets = bodyEntities.map((entity) => {
    const expectedFaces = entity.components.flatMap((bodyId) =>
      array(record(bodyIndex[bodyId]).face_ids).map(text).filter(Boolean),
    )
    const expectedEdges = entity.components.flatMap((bodyId) =>
      array(record(bodyIndex[bodyId]).edge_ids).map(text).filter(Boolean),
    )
    const matchedFaces = matchMembers(expectedFaces, faces, faceComponents, normalizedSet(expectedFaces))
    const matchedEdges = matchMembers(expectedEdges, edges, edgeComponents, normalizedSet(expectedEdges))
    const available = expectedFaces.length + expectedEdges.length > 0
      && matchedFaces.complete
      && matchedEdges.complete
    const faceIds = available ? matchedFaces.memberIds : []
    const edgeIds = available ? matchedEdges.memberIds : []
    return {
      id: `geometry:${entity.tag}:${entity.id}`,
      label: entity.name || entity.id,
      tag: entity.tag === 'bodyId' ? 'groupByBodyId' : entity.tag,
      memberIds: [...faceIds, ...edgeIds],
      faceIds,
      edgeIds,
      available,
    }
  })

  const bodyPresetKeys = new Set(bodyPresets.map((preset) =>
    `${preset.tag}\u0001${normalize(preset.label)}`,
  ))
  const isReplacedByBodyPreset = (preset: ParameterSelectionPreset) => bodyPresetKeys.has(
    `${preset.tag === 'bodyId' ? 'groupByBodyId' : preset.tag}\u0001${normalize(preset.label)}`,
  )
  return dedupePresets([
    ...facePresets.filter((preset) => !isReplacedByBodyPreset(preset)),
    ...edgePresets.filter((preset) => !isReplacedByBodyPreset(preset)),
    ...bodyPresets.filter((preset) => preset.available),
  ])
}

export function buildParameterSelectionPresets(
  simulationParams: unknown,
  kind: ParameterSelectionKind,
  members: readonly ParameterSelectionMember[],
): ParameterSelectionPreset[] {
  if (members.length < 2) return []
  const params = unwrapSimulationParams(simulationParams)
  const cache = record(params.private_attribute_asset_cache)
  const info = record(cache.project_entity_info)
  const entitySchemes = entitySchemeList(info[collectionByKind[kind]])
  const bodySchemes = kind === 'body' ? [] : array(info.grouped_bodies)
    .map((candidate) => array(candidate)
      .map((value) => bodySelectionEntity(value, info, kind))
      .filter(isDefined))
    .filter((scheme) => scheme.length > 0)
  const schemes = [...entitySchemes, ...bodySchemes]
  if (schemes.length === 0) return []

  const entities = schemes.flat()
  const activeTag = text(info[activeTagByKind[kind]])
  const memberComponents = memberComponentIndex(members, entities, activeTag)

  const candidates = entities.flatMap((entity) => {
    const entityKeys = normalizedSet([entity.id, entity.name])
    const matched = matchMembers(entity.components, members, memberComponents, entityKeys)
    const memberIds = matched.memberIds
    if (memberIds.length === 0 || !matched.complete) return []
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

function parameterEntities(value: unknown): ParameterEntity[] {
  return entitySchemeList(value).flat()
}

function entitySchemeList(value: unknown): ParameterEntity[][] {
  return entitySchemes(value)
    .map((scheme) => scheme.map(parameterEntity).filter(isDefined))
    .filter((scheme) => scheme.length > 0)
}

function entitySchemes(value: unknown): unknown[][] {
  const collection = array(value)
  if (collection.length === 0) return []
  if (collection.every((candidate) => !Array.isArray(candidate))) return [collection]
  return collection.map((candidate) => Array.isArray(candidate) ? candidate : [candidate])
}

function memberComponentIndex(
  members: readonly ParameterSelectionMember[],
  entities: ParameterEntity[],
  activeTag: string,
): Map<string, Set<string>> {
  return new Map(members.map((member) => [
    member.id,
    resolveMemberComponents(member, entities, activeTag),
  ]))
}

function matchMembers(
  expectedComponents: readonly string[],
  members: readonly ParameterSelectionMember[],
  memberComponents: Map<string, Set<string>>,
  directEntityKeys = new Set<string>(),
): { memberIds: string[]; complete: boolean } {
  const expected = normalizedSet(expectedComponents)
  if (expected.size === 0) return { memberIds: [], complete: true }
  const coverage = new Set<string>()
  const memberIds = members.flatMap((member) => {
    const directMatch = memberKeys(member).some((key) => directEntityKeys.has(key))
    const components = memberComponents.get(member.id) ?? new Set<string>()
    const contained = components.size > 0 && [...components].every((component) => expected.has(component))
    if (!directMatch && !contained) return []
    for (const component of components) {
      if (expected.has(component)) coverage.add(component)
    }
    return [member.id]
  })
  return {
    memberIds: [...new Set(memberIds)],
    complete: [...expected].every((component) => coverage.has(component)),
  }
}

function dedupePresets(presets: ParameterSelectionPreset[]): ParameterSelectionPreset[] {
  const unique = new Map<string, ParameterSelectionPreset>()
  for (const preset of presets) {
    const key = `${preset.tag}\u0001${normalize(preset.label)}\u0001${[...preset.memberIds].sort().join('\u0000')}`
    if (!unique.has(key)) unique.set(key, preset)
  }
  return [...unique.values()]
    .sort((left, right) => left.tag.localeCompare(right.tag) || left.label.localeCompare(right.label))
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
