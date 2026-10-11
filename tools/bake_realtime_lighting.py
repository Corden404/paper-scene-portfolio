"""Sample V4 Cycles surface irradiance for the instanced realtime papers.

Blender runs this on the original V4 .blend without saving it. Invisible
Lambertian probes sample both hemispheres along each actual curved sheet;
the original instances, thin-paper shadows, GI and light links stay intact.
Only reusable lighting data and the source color transform are delivered.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=root / 'public/assets/realtime')
parser.add_argument('--samples', type=int, default=48)
parser.add_argument('--limit', type=int, default=0, help='Small validation bake, never a full delivery')
parser.add_argument('--cpu', action='store_true')
parser.add_argument('--device', choices=('CUDA','OPTIX'), default='CUDA')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
args.output.mkdir(parents=True, exist_ok=True)
source = Path(bpy.data.filepath)
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
assets = root / 'public/assets/realtime'
data = json.loads((assets / 'scene.json').read_text(encoding='utf-8'))
assert source_hash == data['sourceSha256'], 'The export belongs to another source'
records = np.fromfile(assets / 'papers.bin', dtype='<f4').reshape((-1, 23))
scene = bpy.data.scenes['Scene']
scene.frame_set(25)
scene.render.engine = 'CYCLES'
scene.cycles.samples = args.samples
scene.cycles.use_adaptive_sampling = False
scene.cycles.use_denoising = False
scene.cycles.device = 'CPU' if args.cpu else 'GPU'
if not args.cpu:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = args.device
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == args.device
    assert any(device.use for device in prefs.devices), 'No selected GPU device available'

# Apply exactly the authored AgX view, look and exposure to a logarithmic
# HDR color cube. This includes the source's Medium High Contrast look.
cube_size = 48
log_min, log_max = -12., 6.
values = np.exp2(np.linspace(log_min, log_max, cube_size, dtype=np.float32))
chart = np.ones((cube_size, cube_size*cube_size, 4), dtype=np.float32)
for z in range(cube_size):
    chart[:, z*cube_size:(z+1)*cube_size, 0] = values[None, :]
    chart[:, z*cube_size:(z+1)*cube_size, 1] = values[:, None]
    chart[:, z*cube_size:(z+1)*cube_size, 2] = values[z]
image = bpy.data.images.new('Realtime source grade', width=cube_size*cube_size,
                            height=cube_size, float_buffer=True, alpha=True)
image.colorspace_settings.name = 'Linear Rec.709'
image.pixels.foreach_set(chart.ravel())
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.color_depth = '16'
image.save_render(str(args.output / 'source-grade.png'), scene=scene)
print('SOURCE_GRADE', scene.view_settings.view_transform, scene.view_settings.look,
      scene.view_settings.exposure, flush=True)

nx, ny = 3, 5
per_side = nx*ny
axis_inverse = Matrix.Rotation(math.pi/2, 4, 'X')
entries = {'air': [], 'ground': []}
count = 0
for group in data['groups']:
    offset = group['offset']//(23*4)
    template = group['prototype']['levels'][-1]
    template_uvs=np.asarray(template['uvs']).reshape((-1,2))
    sx=len(np.unique(template_uvs[:,0]));sy=len(np.unique(template_uvs[:,1]))
    shape_positions = np.asarray(template['positions'], dtype=np.float32).reshape((sy,sx,3))
    shape_normals = np.asarray(template['normals'], dtype=np.float32).reshape((sy,sx,3))
    # Border samples are taken inside the sheet to avoid tracing just beyond
    # an edge. Runtime clamps the two narrow border strips to these samples.
    for local in range(group['count']):
        index = offset+local
        if args.limit and count >= args.limit: break
        matrix = axis_inverse @ Matrix(records[index,:16].reshape((4,4),order='F').tolist())
        normal_matrix = matrix.to_3x3().inverted().transposed()
        points = []
        for y in range(ny):
            v = .025 + .95*y/(ny-1)
            gy = v*(sy-1); iy = min(sy-2,int(gy)); fy=gy-iy
            for x in range(nx):
                u = .025 + .95*x/(nx-1)
                gx = u*(sx-1); ix = min(sx-2,int(gx)); fx=gx-ix
                weights=((1-fx)*(1-fy),fx*(1-fy),(1-fx)*fy,fx*fy)
                coordinates=((iy,ix),(iy,ix+1),(iy+1,ix),(iy+1,ix+1))
                p=sum((Vector(shape_positions[a,b])*w for (a,b),w in zip(coordinates,weights)),Vector())
                n=sum((Vector(shape_normals[a,b])*w for (a,b),w in zip(coordinates,weights)),Vector())
                points.append((matrix@p,(normal_matrix@n).normalized()))
        bucket=entries['ground' if group['prototype']['ground'] else 'air']
        for side in (1,-1):
            for p,n in points:
                n=n*side
                center=p+n*.0012
                tangent=n.cross(Vector((0,0,1)) if abs(n.z)<.9 else Vector((0,1,0))).normalized()
                bitangent=n.cross(tangent)
                epsilon=.00025
                triangle=[center+(-tangent-bitangent)*epsilon,
                          center+(tangent-bitangent)*epsilon,center+bitangent*epsilon*2]
                bucket.append((index,side,triangle))
        count+=1
    if args.limit and count >= args.limit: break

bpy.ops.object.select_all(action='DESELECT')
probes=[]
for kind,items in entries.items():
    if not items: continue
    vertices=np.asarray([list(p) for _,_,triangle in items for p in triangle],dtype=np.float32)
    mesh=bpy.data.meshes.new('Cycles '+kind+' irradiance probes')
    mesh.vertices.add(len(vertices));mesh.vertices.foreach_set('co',vertices.ravel())
    mesh.loops.add(len(vertices));mesh.loops.foreach_set('vertex_index',np.arange(len(vertices),dtype=np.int32))
    mesh.polygons.add(len(items))
    mesh.polygons.foreach_set('loop_start',np.arange(len(items),dtype=np.int32)*3)
    mesh.polygons.foreach_set('loop_total',np.full(len(items),3,dtype=np.int32))
    mesh.update(calc_edges=True)
    attr=mesh.color_attributes.new(name='Cycles irradiance',type='FLOAT_COLOR',domain='CORNER')
    mesh.color_attributes.active_color=attr
    mesh.color_attributes.render_color_index=0
    material=bpy.data.materials.new('Probe white Lambert');material.use_nodes=True
    material.node_tree.nodes.clear()
    diffuse=material.node_tree.nodes.new('ShaderNodeBsdfDiffuse');diffuse.inputs['Color'].default_value=(1,1,1,1)
    output=material.node_tree.nodes.new('ShaderNodeOutputMaterial')
    material.node_tree.links.new(diffuse.outputs[0],output.inputs['Surface'])
    mesh.materials.append(material)
    obj=bpy.data.objects.new('WEB | '+kind+' irradiance probes',mesh)
    scene.collection.objects.link(obj)
    for field in ('visible_shadow','visible_diffuse','visible_glossy','visible_transmission','visible_volume_scatter'):
        setattr(obj,field,False)
    for light in (o for o in scene.objects if o.type=='LIGHT'):
        receivers=light.light_linking.receiver_collection
        if receivers is not None:
            original_names={g['name'] for g in data['groups']
                            if g['prototype']['ground']==(kind=='ground')}
            accepts=any(q.name in original_names for q in receivers.all_objects)
            if accepts and obj.name not in receivers.objects:
                receivers.objects.link(obj)
    obj.select_set(True)
    probes.append((obj,attr,items))
    del vertices
assert probes
bpy.context.view_layer.objects.active=probes[0][0]
print('CYCLES_PROBES',count,'papers',sum(len(items) for _,_,items in probes),'hemisphere samples',flush=True)
start=time.perf_counter()
print('BAKE_CONTEXT',bpy.context.scene.name,[(o.name,o.select_get(),o.visible_get()) for o,_,_ in probes],flush=True)
result=bpy.ops.object.bake(type='DIFFUSE',pass_filter={'DIRECT','INDIRECT'},target='VERTEX_COLORS',
                         use_selected_to_active=False,use_clear=True)
print('BAKE_RESULT',result,time.perf_counter()-start,flush=True)
lighting=np.zeros((len(records),2,ny,nx,3),dtype=np.float32)
for obj,attr,items in probes:
    colors=np.empty((len(attr.data),4),dtype=np.float32)
    attr.data.foreach_get('color',colors.ravel())
    colors=colors.reshape((-1,3,4))[:,:,:3].mean(axis=1)
    counters={}
    for row,(index,side,_) in enumerate(items):
        face=0 if side==1 else 1
        key=(index,face);point=counters.get(key,0);counters[key]=point+1
        lighting[index,face,point//nx,point%nx,:]=colors[row]
    print('CYCLES_RANGE',obj.name,float(colors.min()),float(np.median(colors)),float(colors.max()),flush=True)
assert np.isfinite(lighting).all()
assert lighting.max()>0, 'The bake is empty'
lighting=np.clip(lighting,0,65504).astype('<f2')
lighting.tofile(args.output / 'lighting.bin')
receipt={'version':2,'sourceSha256':source_hash,'papers':len(records),'bakedPapers':count,
         'grid':[nx,ny],'sides':2,'format':'float16-rgb','uvInset':.025,
         'samples':args.samples,'lighting':'Cycles diffuse direct and indirect hemisphere irradiance',
         'colorGrade':{'url':'source-grade.png','size':cube_size,'logMin':log_min,'logMax':log_max},
         'seconds':round(time.perf_counter()-start,2)}
(args.output / 'lighting.json').write_text(json.dumps(receipt,separators=(',',':'))+'\n',encoding='utf-8')
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('CYCLES_LIGHTING_COMPLETE',receipt['seconds'],'seconds',flush=True)
