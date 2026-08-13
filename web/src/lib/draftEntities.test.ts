import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createParameterEntityGroup, parseDraftEntities, parseGhostEntities, setParameterEntityVisibility } from './draftEntities'

describe('draft entities', () => {
  it('reads supported entities from the private asset cache with stable fallbacks', () => {
    const entities = parseDraftEntities({
      private_attribute_asset_cache: {
        project_length_unit: { value: 1, units: 'm' },
        project_entity_info: { draft_entities: [
          { type_name: 'Box', private_attribute_id: 'box-1', name: 'Refinement box' },
          { private_attribute_entity_type_name: 'Point', name: 'Probe' },
          { type: 'Unsupported', private_attribute_id: 'ignored' },
          { type_name: 'Box', private_attribute_id: 'box-1', name: 'Duplicate' },
        ] },
      },
    })
    expect(entities).toMatchObject([
      { id: 'box-1', key: 'draft:box-1', name: 'Refinement box', type: 'Box', lengthUnit: 'm' },
      { id: 'draft-entity-Point-1', key: 'draft:draft-entity-Point-1', name: 'Probe', type: 'Point', lengthUnit: 'm' },
    ])
  })

  it('creates hidden scene objects and applies explicit visibility', () => {
    const entities = parseDraftEntities({ private_attribute_asset_cache: { project_entity_info: { draft_entities: [
      { private_attribute_entity_type_name: 'Sphere', private_attribute_id: 'sphere-1', radius: { value: 1, units: 'm' } },
      { private_attribute_entity_type_name: 'Slice', private_attribute_id: 'slice-1', origin: { value: [0, 0, 0], units: 'm' } },
    ] } } })
    const group = createParameterEntityGroup(entities, new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)))
    expect(group.children.map((child) => child.visible)).toEqual([false, false])
    setParameterEntityVisibility(group, { 'draft:sphere-1': true })
    expect(group.children.map((child) => child.visible)).toEqual([true, false])
  })

  it('converts entity lengths into the project unit', () => {
    const [entity] = parseDraftEntities({ private_attribute_asset_cache: {
      project_length_unit: { value: 1, units: 'mm' },
      project_entity_info: { draft_entities: [{
        private_attribute_entity_type_name: 'Point',
        private_attribute_id: 'point-1',
        location: { value: [1, 2, 3], units: 'm' },
      }] },
    } })
    const group = createParameterEntityGroup([entity], new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1)))
    const positions = (group.children[0] as THREE.Points).geometry.getAttribute('position')
    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([1000, 2000, 3000])
  })

  it('creates a drawable object for every supported entity type', () => {
    const types = [
      { private_attribute_entity_type_name: 'Box', size: { value: [1, 2, 3], units: 'm' } },
      { private_attribute_entity_type_name: 'Cylinder', height: { value: 2, units: 'm' }, outer_radius: { value: 1, units: 'm' } },
      { private_attribute_entity_type_name: 'Point', location: { value: [1, 0, 0], units: 'm' } },
      { private_attribute_entity_type_name: 'Sphere', radius: { value: 1, units: 'm' } },
      { private_attribute_entity_type_name: 'AxisymmetricBody', profile_curve: [{ value: [0, 0], units: 'm' }, { value: [1, 1], units: 'm' }] },
      { private_attribute_entity_type_name: 'CustomVolume' },
      { private_attribute_entity_type_name: 'SeedpointVolume', point_in_mesh: [{ value: [0, 0, 0], units: 'm' }] },
      { private_attribute_entity_type_name: 'PointArray', start: { value: [0, 0, 0], units: 'm' }, end: { value: [1, 0, 0], units: 'm' }, number_of_points: 3 },
      { private_attribute_entity_type_name: 'PointArray2D', origin: { value: [0, 0, 0], units: 'm' }, u_axis_vector: { value: [1, 0, 0], units: 'm' }, v_axis_vector: { value: [0, 1, 0], units: 'm' }, u_number_of_points: 2, v_number_of_points: 2 },
      { private_attribute_entity_type_name: 'Slice', origin: { value: [0, 0, 0], units: 'm' }, normal: [0, 0, 1] },
    ].map((entity, index) => ({ ...entity, private_attribute_id: `entity-${index}` }))
    const entities = parseDraftEntities({ private_attribute_asset_cache: { draft_entities: types } })
    const group = createParameterEntityGroup(entities, new THREE.Box3(new THREE.Vector3(-2, -2, -2), new THREE.Vector3(2, 2, 2)))
    expect(entities).toHaveLength(10)
    expect(group.children).toHaveLength(10)
    expect(group.children.every((child) => child.visible === false)).toBe(true)
  })

  it('parses and draws spatial ghost entities without inventing wind-tunnel geometry', () => {
    const entities = parseGhostEntities({ private_attribute_asset_cache: { project_entity_info: { ghost_entities: [
      { private_attribute_entity_type_name: 'GhostSphere', private_attribute_id: 'farfield', name: 'farfield', center: [0, 0, 0], max_radius: 5 },
      { private_attribute_entity_type_name: 'GhostCircularPlane', private_attribute_id: 'symmetric', center: [0, 1, 0], max_radius: 5, normal_axis: [0, 1, 0] },
      { private_attribute_entity_type_name: 'WindTunnelGhostSurface', private_attribute_id: 'windTunnelInlet', used_by: ['all'] },
    ] } } })
    expect(entities).toMatchObject([
      { key: 'ghost:farfield', type: 'GhostSphere', renderable: true },
      { key: 'ghost:symmetric', type: 'GhostCircularPlane', renderable: true },
      { key: 'ghost:windTunnelInlet', type: 'WindTunnelGhostSurface', renderable: false },
    ])
    const group = createParameterEntityGroup(entities, new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)))
    expect(group.children).toHaveLength(3)
    expect(group.children[0].children.length).toBeGreaterThan(0)
    expect(group.children[1].children.length).toBeGreaterThan(0)
    expect(group.children[2].children).toHaveLength(0)
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(group.children[1].quaternion)
    expect(normal.x).toBeCloseTo(0)
    expect(normal.y).toBeCloseTo(1)
    expect(normal.z).toBeCloseTo(0)
    expect(group.children[1].position.toArray()).toEqual([0, 1, 0])
    setParameterEntityVisibility(group, { 'ghost:farfield': true, 'ghost:symmetric': true })
    expect(group.children.map((child) => child.visible)).toEqual([true, true, false])
  })
})
