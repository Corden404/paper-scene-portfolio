"""Export the full V4 camera journey as a real-time, instanced 3D scene.

Run Blender with the V4 source open, then --python this file. The source is
never saved. Only delivery assets go to public/assets/realtime; no renders or
camera-facing scene images are used. Static paper illumination is sampled
from the V4 light rig with soft, transmissive shadow rays on the CPU.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--output', type=Path, default=ROOT / 'public/assets/realtime')
p.add_argument('--geometry-only', action='store_true', help='Rebuild geometry; Cycles lighting is baked separately')
a = p.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
a.output.mkdir(parents=True, exist_ok=True)
source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
scene = bpy.data.scenes['Scene']
scene.frame_set(25)
axis = Matrix.Rotation(-math.pi / 2, 4, 'X')
dg = bpy.context.evaluated_depsgraph_get()

# Snapshot values while iterating: depsgraph instance wrappers expire when
# Blender advances the iterator.
papers = []
for instance in dg.object_instances:
    name = instance.object.original.name
    if instance.is_instance and name.startswith(('A4 form |', 'Ground A4 form |')):
        papers.append((name, instance.matrix_world.copy()))
assert len(papers) == 10436, f'Unexpected V4 paper count: {len(papers)}'

def template(obj, nx, ny):
    mesh = obj.data
    uv_by_vertex = {}
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            uv_by_vertex[mesh.loops[li].vertex_index] = mesh.uv_layers.active.data[li].uv.copy()
    xs = sorted({round(uv.x, 6) for uv in uv_by_vertex.values()})
    ys = sorted({round(uv.y, 6) for uv in uv_by_vertex.values()})
    grid = {(round(uv.x, 6), round(uv.y, 6)): mesh.vertices[i] for i, uv in uv_by_vertex.items()}
    positions, normals, uvs = [], [], []
    for j in range(ny):
        v = j / (ny - 1)
        gy = v * (len(ys) - 1); iy = min(int(gy), len(ys) - 2); fy = gy - iy
        for i in range(nx):
            u = i / (nx - 1)
            gx = u * (len(xs) - 1); ix = min(int(gx), len(xs) - 2); fx = gx - ix
            corners = [grid[(xs[ix], ys[iy])], grid[(xs[ix+1], ys[iy])],
                       grid[(xs[ix], ys[iy+1])], grid[(xs[ix+1], ys[iy+1])]]
            weights = [(1-fx)*(1-fy), fx*(1-fy), (1-fx)*fy, fx*fy]
            pos = sum((q.co*w for q,w in zip(corners,weights)), Vector())
            normal = sum((q.normal*w for q,w in zip(corners,weights)), Vector()).normalized()
            positions.extend(pos); normals.extend(normal); uvs.extend((u,v))
    indices = []
    for j in range(ny-1):
        for i in range(nx-1):
            q = j*nx+i
            indices.extend((q,q+1,q+nx+1,q,q+nx+1,q+nx))
    return {'positions':positions,'normals':normals,'uvs':uvs,'indices':indices}

prototypes = {}
for name in sorted({name for name,_ in papers}):
    o = bpy.data.objects[name]
    number = int(name.split('|')[1].strip().split()[0])
    prototypes[name] = {'texture':f'cotton-print-{number}.png', 'ground':name.startswith('Ground'),
                        'levels': [template(o,7,11),template(o,9,13),template(o,13,17)]}
for image in bpy.data.images:
    if image.name.startswith('cotton-print-') and image.packed_file:
        (a.output/image.name).write_bytes(image.packed_file.data)

# A low-detail paper BVH preserves the arrangement and softened occlusion
# without making users download or transform the 25M source triangles.
vertices, faces = [], []
for name, matrix in ([] if a.geometry_only else papers):
    t = prototypes[name]['levels'][0]
    n = len(vertices)
    for i in range(0,len(t['positions']),3):
        vertices.append(matrix @ Vector(t['positions'][i:i+3]))
    for i in range(0,len(t['indices']),3):
        faces.append(tuple(n+k for k in t['indices'][i:i+3]))
bvh = BVHTree.FromPolygons(vertices, faces, all_triangles=True) if vertices else None
print('REALTIME_BVH',len(vertices),len(faces),flush=True)

lights = []
for name in ('V4 | Cold rear opening','V4 | Inner cold opening','V4 | Upper cold skylight',
             'V4 | Soft page-edge ambient','V4 | Soft reflected ground light'):
    o = bpy.data.objects[name]
    matrix = o.matrix_world.copy()
    lights.append({'position':matrix.translation.copy(),'normal':matrix.to_3x3()@Vector((0,0,-1)),
                   'right':matrix.to_3x3()@Vector((1,0,0)),'up':matrix.to_3x3()@Vector((0,1,0)),
                   'power':o.data.energy,'size':o.data.size,'color':Vector(o.data.color),
                   'ground':name.endswith('ground light')})

def visibility(point, direction, distance):
    origin = point + direction * .002
    remaining = distance - .004
    transmittance = 1.0
    for _ in range(7):
        hit,_,_,length = bvh.ray_cast(origin,direction,remaining)
        if hit is None: break
        # The source cotton material transmits light and also uses a dedicated
        # shadow-ray transparency. Its real-time lighting must not treat every
        # sheet as a solid black occluder.
        transmittance *= .66
        origin = hit + direction*.003
        remaining -= length + .003
        if remaining <= 0: break
    return transmittance

groups = defaultdict(list)
for index,(name,matrix) in enumerate(papers):
    ground = prototypes[name]['ground']
    center = matrix.translation
    normal = (matrix.to_3x3().inverted().transposed() @ Vector((0,0,1))).normalized()
    front = Vector((.012,.019,.021)) if ground else Vector((.035,.048,.052))
    back = front.copy()
    for light in ([] if a.geometry_only else lights):
        if ground and not light['ground']: continue
        if not ground and light['ground']: continue
        for x,y in ((-.28,-.28),(.28,-.28),(-.28,.28),(.28,.28)):
            target = light['position']+(light['right']*x+light['up']*y)*light['size']
            ray = target-center; distance = ray.length; direction = ray.normalized()
            cosine = normal.dot(direction)
            emission = max(.0,-light['normal'].dot(direction))
            shadow = visibility(center,direction,distance)
            power = light['power'] * emission * shadow / (4*math.pi*max(.25,distance**2)) / 4
            # Baked front and reverse lighting remain attached to each actual
            # sheet as the camera moves. Printed ink is applied separately.
            front += light['color'] * power * (max(0,cosine)*.68 + max(0,-cosine)*.48)
            back += light['color'] * power * (max(0,-cosine)*.68 + max(0,cosine)*.48)
    converted = axis @ matrix
    flat = [converted[row][col] for col in range(4) for row in range(4)]
    groups[name].append(flat + list(front) + list(back) + [(index*.61803398875)%1])
    if index % 2000 == 0: print('REALTIME_LIGHTING',index,len(papers),flush=True)

binary = bytearray(); records = []
for name,rows in groups.items():
    offset = len(binary)
    for row in rows: binary.extend(struct.pack('<23f',*row))
    records.append({'name':name,'offset':offset,'count':len(rows),'prototype':prototypes[name]})
(a.output/'papers.bin').write_bytes(binary)

# Export visible furniture, walls and actual printed hero surfaces only.
# All mutation below is in Blender memory, never in the authored source.
bpy.ops.object.select_all(action='DESELECT')
static = []
for o in list(scene.objects):
    if o.type != 'MESH' or o.hide_render or not o.visible_get(): continue
    if o.name.startswith(('A4 form |','Ground A4 form |')): continue
    if any(m.type=='NODES' for m in o.modifiers) and any(
            q in o.name for q in ('canopy','paper points','ground points','cascade','Full sheets','Flow')):
        continue
    if any(m and m.use_nodes and any(n.type=='PRINCIPLED_VOLUME' for n in m.node_tree.nodes) for m in o.data.materials):
        continue
    if o.name.lower().startswith(('avery','hairline','fine short','eyebrow','eyelash','teeth','male_','anatomical')): continue
    # Instancer objects with empty/point geometry are delivered by papers.bin.
    if not len(o.data.polygons): continue
    static.append(o)
    if o.name.startswith('Paper ') and o.name.endswith('| hero surface'):
        letter=o.name.split()[1].lower()
        clone=bpy.data.materials.new('WEB | Printed portfolio '+letter);clone.use_nodes=True
        shader=clone.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Roughness'].default_value=.94
        node=clone.node_tree.nodes.new('ShaderNodeTexImage');node.image=bpy.data.images['paper-'+letter+'-print.png']
        clone.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
        clone.use_backface_culling=False
        o.data.materials.clear();o.data.materials.append(clone)
        if not o.data.uv_layers:
            uv=o.data.uv_layers.new(name='PORTFOLIO_CONTENT_UV')
            xs=[v.co.x for v in o.data.vertices];ys=[v.co.y for v in o.data.vertices]
            minx,miny=min(xs),min(ys);width,height=max(xs)-minx,max(ys)-miny
            for poly in o.data.polygons:
                for li in poly.loop_indices:
                    v=o.data.vertices[o.data.loops[li].vertex_index]
                    uv.data[li].uv=((v.co.x-minx)/width,(v.co.y-miny)/height)
    for slot in o.material_slots:
        material = slot.material
        if not material or not material.use_nodes: continue
        if 'Printed portfolio' in material.name and not material.name.startswith('WEB |'):
            clone = bpy.data.materials.new('WEB | '+material.name); clone.use_nodes=True
            shader=clone.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Roughness'].default_value=.92
            img=next((n.image for n in material.node_tree.nodes if n.type=='TEX_IMAGE' and n.image),None)
            if img:
                node=clone.node_tree.nodes.new('ShaderNodeTexImage');node.image=img
                clone.node_tree.links.new(node.outputs['Color'],shader.inputs['Base Color'])
            clone.surface_render_method='DITHERED';clone.use_backface_culling=False
            slot.material=clone
    o.select_set(True)
    # Fine curved hero geometry keeps its source normals and thin cut edges.
    for modifier in o.modifiers:
        if modifier.type=='SUBSURF': modifier.levels=min(modifier.levels,1);modifier.render_levels=min(modifier.render_levels,1)

if not static: raise RuntimeError('No visible static V4 geometry')
# Collapse repeated keycaps and hall ribs after evaluating their modifiers.
# Keep the named hero sheets, screen and floor individually addressable.
merge_groups=defaultdict(list)
for o in static:
    if o.name.startswith('Paper ') or 'display' in o.name.lower() or 'floor' in o.name.lower(): continue
    evaluated=bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    o.modifiers.clear();o.data=evaluated
    key=tuple(m.name if m else '' for m in o.data.materials)
    merge_groups[key].append(o)
for key,objects in merge_groups.items():
    if len(objects)<2: continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join();objects[0].name='WEB | Static '+str(key[0])
bpy.ops.object.select_all(action='DESELECT')
static=[o for o in scene.objects if o.type=='MESH' and o in static]
for o in static: o.select_set(True)
bpy.context.view_layer.objects.active=static[0]
bpy.ops.export_scene.gltf(filepath=str(a.output/'room.glb'),export_format='GLB',
    use_selection=True,export_apply=True,export_animations=False,export_cameras=False,
    export_lights=False,export_extras=True,export_yup=True,export_materials='EXPORT')

route=scene.camera
reference=bpy.data.scenes['V4 Portrait Frame 25'].camera
scene.frame_set(25)
start_rotation=route.matrix_world.to_quaternion()
offset=reference.matrix_world.translation-route.matrix_world.translation
correction=reference.matrix_world.to_quaternion()@start_rotation.inverted()
start_lens=route.data.lens
path=[]
stops={'intro':25,'paper-a':109,'paper-b':205,'paper-c':288,
       'paper-d':372,'paper-e':456,'paper-f':541,'screen':654}
for frame in range(25,stops['screen']+1):
    scene.frame_set(frame)
    release=min(1,max(0,(frame-25)/48));release=release*release*(3-2*release)
    matrix=route.matrix_world.copy();matrix.translation+=offset*(1-release)
    rotation=correction.slerp(Quaternion(),release)@matrix.to_quaternion()
    world=axis@Matrix.LocRotScale(matrix.translation,rotation,Vector((1,1,1)))
    q=world.to_quaternion()
    landscape_lens=reference.data.lens*36/(reference.data.sensor_width*1456/816)*540/960
    path.append({'frame':frame,'position':list(world.translation),'quaternion':[q.x,q.y,q.z,q.w],
                 'landscapeLens':route.data.lens+(landscape_lens-start_lens)*(1-release),
                 'portraitLens':route.data.lens+(reference.data.lens-start_lens)*(1-release)})
manifest={'version':1,'sourceSha256':source_hash,'source':source.name,'instanceCount':len(papers),
          'instanceStride':23,'groups':records,'camera':{'sensorWidth':36,'frames':path},
          'stops':stops,
          'lighting':'Authored V4 geometry; separate Cycles surface, hero and atmosphere lighting assets'}
manifest['assetVersion']=hashlib.sha256((a.output/'room.glb').read_bytes()+binary).hexdigest()[:12]
(a.output/'scene.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n',encoding='utf-8')
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('REALTIME_EXPORT_COMPLETE',len(papers),'papers',len(static),'static objects',len(binary),'instance bytes',flush=True)
