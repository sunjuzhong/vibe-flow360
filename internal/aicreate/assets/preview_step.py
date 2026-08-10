import json, math, struct, sys
import cadquery as cq

output = sys.argv[1]
inputs = sys.argv[2:]
blob = bytearray()
views, accessors, meshes, nodes, materials = [], [], [], [], []
mins, maxs = [math.inf] * 3, [-math.inf] * 3
total_vertices = total_triangles = 0

def aligned(data):
    offset = len(blob)
    blob.extend(data)
    while len(blob) % 4: blob.append(0)
    return offset, len(data)

for index, path in enumerate(inputs):
    shape = cq.importers.importStep(path).val()
    vertices, indices = [], []
    for solid in shape.Solids() or [shape]:
        points, triangles = solid.tessellate(0.001)
        base = len(vertices) // 3
        for point in points:
            xyz = [float(point.x), float(point.y), float(point.z)]
            vertices.extend(xyz)
            for axis in range(3):
                mins[axis] = min(mins[axis], xyz[axis]); maxs[axis] = max(maxs[axis], xyz[axis])
        for triangle in triangles: indices.extend([base + int(v) for v in triangle])
    if len(indices) > 450000:
        step = math.ceil(len(indices) / 450000) * 3
        indices = [v for start in range(0, len(indices), step) for v in indices[start:start + 3]]
    position_offset, position_length = aligned(struct.pack('<%sf' % len(vertices), *vertices))
    index_offset, index_length = aligned(struct.pack('<%sI' % len(indices), *indices))
    position_view = len(views); views.append({'buffer': 0, 'byteOffset': position_offset, 'byteLength': position_length, 'target': 34962})
    index_view = len(views); views.append({'buffer': 0, 'byteOffset': index_offset, 'byteLength': index_length, 'target': 34963})
    local_min = [min(vertices[a::3]) for a in range(3)]
    local_max = [max(vertices[a::3]) for a in range(3)]
    position_accessor = len(accessors); accessors.append({'bufferView': position_view, 'componentType': 5126, 'count': len(vertices)//3, 'type': 'VEC3', 'min': local_min, 'max': local_max})
    index_accessor = len(accessors); accessors.append({'bufferView': index_view, 'componentType': 5125, 'count': len(indices), 'type': 'SCALAR'})
    name = 'Selected version' if index == 0 else 'Comparison version'
    color = [0.12, 0.58, 0.95, 1.0] if index == 0 else [0.95, 0.45, 0.12, 0.55]
    materials.append({'name': name, 'pbrMetallicRoughness': {'baseColorFactor': color, 'metallicFactor': 0.05, 'roughnessFactor': 0.72}, 'doubleSided': True, 'alphaMode': 'BLEND' if index else 'OPAQUE'})
    meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': position_accessor}, 'indices': index_accessor, 'material': index}]})
    nodes.append({'name': name, 'mesh': index})
    total_vertices += len(vertices)//3; total_triangles += len(indices)//3

gltf = {'asset': {'version': '2.0', 'generator': 'VibeSim STEP preview'}, 'scene': 0,
        'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'materials': materials, 'buffers': [{'byteLength': len(blob)}], 'bufferViews': views, 'accessors': accessors}
json_chunk = json.dumps(gltf, separators=(',', ':')).encode()
while len(json_chunk) % 4: json_chunk += b' '
while len(blob) % 4: blob.append(0)
length = 12 + 8 + len(json_chunk) + 8 + len(blob)
with open(output, 'wb') as handle:
    handle.write(struct.pack('<III', 0x46546C67, 2, length))
    handle.write(struct.pack('<II', len(json_chunk), 0x4E4F534A)); handle.write(json_chunk)
    handle.write(struct.pack('<II', len(blob), 0x004E4942)); handle.write(blob)
print(json.dumps({'vertices': total_vertices, 'triangles': total_triangles, 'bounds': mins + maxs}))
