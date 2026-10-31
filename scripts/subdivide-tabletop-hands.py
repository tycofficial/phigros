#!/usr/bin/env python3
"""Loop-subdivide MIT WebXR generic hands, including their skin weights.

Usage: python scripts/subdivide-tabletop-hands.py SOURCE.glb OUTPUT.glb
The skeleton, inverse bind matrices and scene remain from the original asset.
"""
import json
import gzip
import struct
import sys
from pathlib import Path
import numpy as np

raw = Path(sys.argv[1]).read_bytes()
json_size = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + json_size])
binary = raw[28 + json_size:]
sizes = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
types = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}

def read(index):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    dtype = np.dtype(types[a['componentType']])
    count, width = a['count'], sizes[a['type']]
    offset = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = v.get('byteStride', dtype.itemsize * width)
    return np.ndarray((count, width), dtype=dtype, buffer=binary,
                      offset=offset, strides=(stride, dtype.itemsize)).copy()

primitive = doc['meshes'][0]['primitives'][0]
a = primitive['attributes']
positions, uv = read(a['POSITION']), read(a['TEXCOORD_0'])
joints, weights = read(a['JOINTS_0']), read(a['WEIGHTS_0'])
faces = read(primitive['indices']).reshape(-1, 3)
joint_count = len(doc['skins'][0]['joints'])
skin = np.zeros((len(positions), joint_count))
for i in range(4):
    skin[np.arange(len(positions)), joints[:, i]] += weights[:, i]

# Weld geometric seams before subdivision; the procedural skin has no atlas.
unique, mapping, pos, tex, sk = {}, [], [], [], []
for i, point in enumerate(positions):
    key = tuple(np.round(point, 6))
    if key not in unique:
        unique[key] = len(pos)
        pos.append(point)
        tex.append(uv[i])
        sk.append(skin[i])
    mapping.append(unique[key])
positions, uv, skin = np.array(pos), np.array(tex), np.array(sk)
faces = np.array(mapping)[faces]

for _ in range(2):
    edges, neighbors = {}, [set() for _ in positions]
    for x, y, z in faces:
        for p, q, opposite in [(x, y, z), (y, z, x), (z, x, y)]:
            key = tuple(sorted((int(p), int(q))))
            edges.setdefault(key, []).append(int(opposite))
            neighbors[p].add(int(q)); neighbors[q].add(int(p))
    boundary = [[] for _ in positions]
    for (p, q), opposite in edges.items():
        if len(opposite) == 1:
            boundary[p].append(q); boundary[q].append(p)
    channels = np.concatenate([positions, uv, skin], axis=1)
    old = channels.copy()
    for i, adjacent in enumerate(neighbors):
        if len(boundary[i]) == 2:
            old[i] = channels[i] * .75 + channels[boundary[i]].sum(axis=0) * .125
        elif len(adjacent) >= 3:
            n = len(adjacent)
            beta = 3 / (8 * n) if n > 3 else 3 / 16
            old[i] = channels[i] * (1 - n * beta) + channels[list(adjacent)].sum(axis=0) * beta
    points, edge_ids = list(old), {}
    for edge, opposite in edges.items():
        p, q = edge
        edge_ids[edge] = len(points)
        points.append((channels[p] + channels[q]) * .375 + channels[opposite[:2]].sum(axis=0) * .125
                      if len(opposite) >= 2 else (channels[p] + channels[q]) * .5)
    new_faces = []
    for x, y, z in faces:
        xy = edge_ids[tuple(sorted((int(x), int(y))))]
        yz = edge_ids[tuple(sorted((int(y), int(z))))]
        zx = edge_ids[tuple(sorted((int(z), int(x))))]
        new_faces.extend([(x, xy, zx), (y, yz, xy), (z, zx, yz), (xy, yz, zx)])
    channels = np.array(points)
    positions, uv, skin = channels[:, :3], channels[:, 3:5], channels[:, 5:]
    faces = np.array(new_faces, dtype='<u4')

normals = np.zeros_like(positions)
face_normals = np.cross(positions[faces[:, 1]] - positions[faces[:, 0]], positions[faces[:, 2]] - positions[faces[:, 0]])
for k in range(3):
    np.add.at(normals, faces[:, k], face_normals)
normals /= np.maximum(1e-15, np.linalg.norm(normals, axis=1))[:, None]
joints = np.argsort(skin, axis=1)[:, -4:]
weights = np.take_along_axis(skin, joints, axis=1)
weights /= np.maximum(1e-15, weights.sum(axis=1))[:, None]
inverse_bind = read(doc['skins'][0]['inverseBindMatrices'])
doc['accessors'], doc['bufferViews'] = [], []
chunks, offset = [], 0

def write(array, dtype, kind, component, target=None):
    global offset
    array = np.asarray(array, dtype=dtype)
    payload = array.tobytes()
    while offset % 4:
        chunks.append(b'\0'); offset += 1
    view = {'buffer': 0, 'byteOffset': offset, 'byteLength': len(payload)}
    if target:
        view['target'] = target
    doc['bufferViews'].append(view)
    access = {'bufferView': len(doc['bufferViews']) - 1, 'componentType': component, 'count': len(array), 'type': kind}
    if kind == 'VEC3':
        access['min'], access['max'] = array.min(0).tolist(), array.max(0).tolist()
    doc['accessors'].append(access)
    chunks.append(payload); offset += len(payload)
    return len(doc['accessors']) - 1

primitive['attributes'] = {
    'POSITION': write(positions, '<f4', 'VEC3', 5126, 34962),
    'TEXCOORD_0': write(uv, '<f4', 'VEC2', 5126, 34962),
    'JOINTS_0': write(joints, 'u1', 'VEC4', 5121, 34962),
    'WEIGHTS_0': write(weights, '<f4', 'VEC4', 5126, 34962),
}
primitive['indices'] = write(faces.reshape(-1, 1), '<u2', 'SCALAR', 5123, 34963)
doc['skins'][0]['inverseBindMatrices'] = write(inverse_bind, '<f4', 'MAT4', 5126)
payload = b''.join(chunks)
payload += b'\0' * (-len(payload) % 4)
doc['buffers'] = [{'byteLength': len(payload)}]
doc['asset']['extras'] = {'modification': 'Two Loop subdivisions with interpolated skin weights; source: @webxr-input-profiles/assets, MIT.'}
metadata = json.dumps(doc, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
out = struct.pack('<III', 0x46546c67, 2, 28 + len(metadata) + len(payload)) + struct.pack('<II', len(metadata), 0x4e4f534a) + metadata + struct.pack('<II', len(payload), 0x004e4942) + payload
if sys.argv[2].endswith('.gz'):out=gzip.compress(out,compresslevel=9,mtime=0)
Path(sys.argv[2]).write_bytes(out)
print(json.dumps({'vertices': len(positions), 'triangles': len(faces), 'bytes': len(out)}))
