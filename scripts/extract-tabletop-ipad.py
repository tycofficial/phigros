#!/usr/bin/env python3
"""Extract only the tablet from the user supplied USDZ. Requires usd-core, numpy.

The screen's own planar mesh defines the leveling transform and rounded mask.
No replacement box, accessory geometry, or authored image is used as a screen.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import zipfile
import numpy as np
from pxr import Gf, Usd, UsdGeom, UsdShade

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('--output', type=Path, default=Path('assets/tabletop/ipad'))
args = parser.parse_args()
stage = Usd.Stage.Open(str(args.source.resolve()))
group = stage.GetPrimAtPath('/COLLuSkZTNlzRUw/FyuXwStiHpjzdMG/zRrSLDpdYmKeRJQ')
assert group, 'The supplied model does not have the expected iPad component'
meshes = [p for p in Usd.PrimRange(group) if p.IsA(UsdGeom.Mesh)]
assert len(meshes) == 59
screen = next(p for p in meshes if p.GetName() == 'lsDiIbtoSGSmWWZ')
cache = UsdGeom.XformCache()

def world_points(prim):
    xf = cache.GetLocalToWorldTransform(prim)
    return np.array([xf.Transform(Gf.Vec3d(v)) for v in UsdGeom.Mesh(prim).GetPointsAttr().Get()])

screen_points = world_points(screen)
_, vectors = np.linalg.eigh(np.cov(screen_points.T))
normal = vectors[:, 0]
if normal[1] < 0:
    normal = -normal
horizontal = np.array([1., 0., 0.])
horizontal -= normal * np.dot(horizontal, normal)
horizontal /= np.linalg.norm(horizontal)
vertical = np.cross(normal, horizontal)
# Tablet lies flat in X/Z, with its top at negative Z and its glass facing +Y.
basis = np.array([horizontal, normal, -vertical])
screen_flat = screen_points @ basis.T
center = (screen_flat.min(0) + screen_flat.max(0)) / 2
all_flat = np.concatenate([world_points(p) @ basis.T for p in meshes])
center[1] = all_flat[:, 1].min() - .025
screen_flat -= center
screen_min, screen_max = screen_flat.min(0), screen_flat.max(0)
out = args.output
out.mkdir(parents=True, exist_ok=True)
chunks, byte_offset, records, textures = [], 0, [], {}
source_zip = zipfile.ZipFile(args.source)

def append(data):
    global byte_offset
    raw = data.tobytes()
    offset = byte_offset
    chunks.append(raw)
    byte_offset += len(raw)
    return offset

def material_data(prim):
    material, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
    if not material:
        return {'color': [.025, .025, .028], 'roughness': .5}
    sources = material.GetSurfaceOutput().GetConnectedSources()[0]
    shader = UsdShade.Shader(sources[0].source.GetPrim())
    result = {}
    for name in ['diffuseColor', 'roughness', 'metallic', 'opacity']:
        inp = shader.GetInput(name)
        if not inp:
            continue
        value = inp.Get()
        key = {'diffuseColor': 'color', 'metallic': 'metalness'}.get(name, name)
        if value is not None:
            result[key] = list(value) if name == 'diffuseColor' else float(value)
        connected = inp.GetConnectedSources()[0]
        if connected and name == 'diffuseColor':
            texture_shader = UsdShade.Shader(connected[0].source.GetPrim())
            file_input = texture_shader.GetInput('file')
            asset = file_input.Get() if file_input else None
            if asset:
                name_in_zip = asset.path
                filename = Path(name_in_zip).name
                if filename not in textures:
                    raw = source_zip.read(name_in_zip)
                    (out / filename).write_bytes(raw)
                    textures[filename] = hashlib.sha256(raw).hexdigest()
                result['map'] = filename
    return result

for prim in meshes:
    mesh = UsdGeom.Mesh(prim)
    counts = list(mesh.GetFaceVertexCountsAttr().Get())
    indices = list(mesh.GetFaceVertexIndicesAttr().Get())
    points = world_points(prim) @ basis.T - center
    pv = UsdGeom.PrimvarsAPI(prim)
    normals_var = pv.GetPrimvar('normals')
    normals = normals_var.ComputeFlattened() if normals_var else mesh.GetNormalsAttr().Get()
    normal_interpolation = normals_var.GetInterpolation() if normals_var else mesh.GetNormalsInterpolation()
    uv_var = pv.GetPrimvar('st')
    uvs = uv_var.ComputeFlattened() if uv_var else None
    uv_interpolation = uv_var.GetInterpolation() if uv_var else 'constant'
    matrix = cache.GetLocalToWorldTransform(prim).ExtractRotationMatrix()
    normal_matrix = np.array(matrix.GetInverse().GetTranspose()).T
    vertices, triangles, dedup = [], [], {}
    face_offset = 0
    for face_id, count in enumerate(counts):
        corners = []
        for j in range(count):
            k, point_id = face_offset + j, indices[face_offset + j]
            pos = points[point_id]
            ni = k if normal_interpolation == 'faceVarying' else point_id if normal_interpolation in ['vertex', 'varying'] else face_id if normal_interpolation == 'uniform' else 0
            n = np.array(normals[ni]) if normals is not None else np.array([0., 1., 0.])
            n = basis @ normal_matrix @ n
            n /= max(1e-12, np.linalg.norm(n))
            ui = k if uv_interpolation == 'faceVarying' else point_id if uv_interpolation in ['vertex', 'varying'] else 0
            uv = list(uvs[ui]) if uvs is not None else [0., 0.]
            if prim == screen:
                uv = [(pos[0] - screen_min[0]) / (screen_max[0] - screen_min[0]),
                      (screen_max[2] - pos[2]) / (screen_max[2] - screen_min[2])]
            vertex = tuple(round(float(v), 7) for v in [*pos, *n, *uv])
            if vertex not in dedup:
                dedup[vertex] = len(vertices)
                vertices.append(vertex)
            corners.append(dedup[vertex])
        for j in range(1, count - 1):
            triangles.extend([corners[0], corners[j], corners[j + 1]])
        face_offset += count
    array = np.array(vertices, dtype='<f4')
    element_array = np.array(triangles, dtype='<u4')
    records.append({'name': prim.GetName(), 'screen': prim == screen,
                    'vertices': len(vertices), 'vertexOffset': append(array),
                    'indices': len(triangles), 'indexOffset': append(element_array),
                    'material': material_data(prim) if prim != screen else {}})

binary = b''.join(chunks)
compressed=gzip.compress(binary,compresslevel=9,mtime=0)
(out / 'ipad.bin.gz').write_bytes(compressed)
manifest = {
    'version': 1,
    'source': args.source.name,
    'sourceSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
    'component': str(group.GetPath()),
    'removedComponents': ['PoBqSMmyhhcJsBX (Magic Keyboard)', 'UlaXKoqepypaGMQ (Apple Pencil)'],
    'units': 'centimeters',
    'screen': {'min': screen_min.tolist(), 'max': screen_max.tolist(),
               'width': float(screen_max[0] - screen_min[0]),
               'height': float(screen_max[2] - screen_min[2]),
               'y': float(screen_flat[:, 1].mean()), 'originalRoundedMesh': True},
    'bounds': {'min': (all_flat.min(0) - center).tolist(), 'max': (all_flat.max(0) - center).tolist()},
    'binary': 'ipad.bin.gz', 'compression':'gzip', 'binaryBytes': len(binary), 'compressedBytes':len(compressed),
    'binarySha256': hashlib.sha256(binary).hexdigest(), 'textures': textures, 'meshes': records,
}
(out / 'ipad.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n')
print(json.dumps({'meshes': len(records), 'bytes': len(binary), 'screen': manifest['screen'], 'bounds': manifest['bounds']}))
