"""Bake the authored V4 atmosphere into a world-space irradiance volume.

Six Lambertian hemispheres at each grid point encode low-order directional
lighting. The original Blender density nodes are evaluated with an emission
bake, preserving the noise and depth/height gradients without screen images.
The source .blend is opened read-only and is never saved.
"""
import argparse, hashlib, json, math, sys, time
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Vector

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',type=Path,default=root/'public/assets/realtime')
parser.add_argument('--samples',type=int,default=48)
parser.add_argument('--grid',type=int,nargs=3,default=(28,32,40))
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
args.output.mkdir(parents=True,exist_ok=True)
source=Path(bpy.data.filepath);source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
data=json.loads((root/'public/assets/realtime/scene.json').read_text(encoding='utf-8'))
assert data['sourceSha256']==source_hash
scene=bpy.data.scenes['Scene'];scene.frame_set(25);scene.render.engine='CYCLES'
scene.cycles.samples=args.samples;scene.cycles.use_denoising=False
scene.cycles.use_adaptive_sampling=False;scene.cycles.device='GPU'
prefs=bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type='CUDA';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='CUDA'
assert any(d.use for d in prefs.devices)
grid=np.array(args.grid,dtype=np.int32)
minimum=np.array((-10.,-.25,-17.),dtype=np.float32)
maximum=np.array((10.,18.,11.),dtype=np.float32)
points=np.array([(x,y,z) for z in np.linspace(minimum[2],maximum[2],grid[2])
                for y in np.linspace(minimum[1],maximum[1],grid[1])
                for x in np.linspace(minimum[0],maximum[0],grid[0])],dtype=np.float32)
inverse=Matrix.Rotation(math.pi/2,4,'X')
centers=[inverse@Vector(p) for p in points]
directions=[inverse.to_3x3()@Vector(n) for n in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1))]

def probe_mesh(name,normals):
 vertices=[]
 for p in centers:
  for n in normals:
   tangent=n.cross(Vector((0,0,1)) if abs(n.z)<.9 else Vector((0,1,0))).normalized()
   bitangent=n.cross(tangent);eps=.00025
   vertices.extend((p-(tangent+bitangent)*eps,p+(tangent-bitangent)*eps,p+bitangent*(2*eps)))
 co=np.asarray(vertices,dtype=np.float32);count=len(co)//3
 mesh=bpy.data.meshes.new(name)
 mesh.vertices.add(len(co));mesh.vertices.foreach_set('co',co.ravel())
 mesh.loops.add(len(co));mesh.loops.foreach_set('vertex_index',np.arange(len(co),dtype=np.int32))
 mesh.polygons.add(count);mesh.polygons.foreach_set('loop_start',np.arange(count,dtype=np.int32)*3)
 mesh.polygons.foreach_set('loop_total',np.full(count,3,dtype=np.int32));mesh.update(calc_edges=True)
 attr=mesh.color_attributes.new(name='World samples',type='FLOAT_COLOR',domain='CORNER')
 mesh.color_attributes.active_color=attr;mesh.color_attributes.render_color_index=0
 obj=bpy.data.objects.new(name,mesh);scene.collection.objects.link(obj)
 for field in ('visible_shadow','visible_diffuse','visible_glossy','visible_transmission','visible_volume_scatter'):
  setattr(obj,field,False)
 return obj,attr

def bake(obj,attr,kind,passes=None):
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
 start=time.perf_counter()
 kw={'type':kind,'target':'VERTEX_COLORS','use_selected_to_active':False,'use_clear':True}
 if passes:kw['pass_filter']=passes
 result=bpy.ops.object.bake(**kw)
 colors=np.empty((len(attr.data),4),dtype=np.float32);attr.data.foreach_get('color',colors.ravel())
 colors=colors.reshape((-1,3,4)).mean(axis=1)
 print('VOLUME_BAKE',kind,result,round(time.perf_counter()-start,2),float(np.median(colors[:,:3])),float(colors[:,:3].max()),flush=True)
 assert np.isfinite(colors).all()
 return colors

obj,attr=probe_mesh('WEB | Directional atmosphere probes',directions)
material=bpy.data.materials.new('White atmosphere probes');material.use_nodes=True
material.node_tree.nodes.clear();d=material.node_tree.nodes.new('ShaderNodeBsdfDiffuse')
d.inputs['Color'].default_value=(1,1,1,1);o=material.node_tree.nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(d.outputs[0],o.inputs['Surface']);obj.data.materials.append(material)
volume=bpy.data.objects['V4 | Deep hall participating atmosphere']
for light in (o for o in scene.objects if o.type=='LIGHT'):
 receivers=light.light_linking.receiver_collection
 if receivers is not None and volume.name in receivers.all_objects:
  if obj.name not in receivers.objects:receivers.objects.link(obj)
print('VOLUME_GRID',list(args.grid),len(points),'points',flush=True)
incoming=bake(obj,attr,'DIFFUSE',{'DIRECT','INDIRECT'})[:,:3].reshape((-1,6,3))
assert incoming.max()>0
# A cosine hemisphere has first angular moment 2/3. Reconstruct the first
# spherical moment, then apply V4's g=.38 phase during runtime integration.
coefficients=np.zeros((len(points),4,4),dtype=np.float32)
coefficients[:,0,:3]=incoming.mean(axis=1)
for axis in range(3):coefficients[:,axis+1,:3]=.75*(incoming[:,axis*2,:]-incoming[:,axis*2+1,:])
obj.hide_render=True

# Position nodes run in original world coordinates, including Blender noise.
density_obj,density_attr=probe_mesh('WEB | Atmosphere density probes',[Vector((0,0,1))])
source_mat=volume.data.materials[0];density=source_mat.copy()
output=next(n for n in density.node_tree.nodes if n.type=='OUTPUT_MATERIAL')
volumetric=next(n for n in density.node_tree.nodes if n.type=='PRINCIPLED_VOLUME')
density_socket=volumetric.inputs['Density'].links[0].from_socket
for link in list(output.inputs['Volume'].links):density.node_tree.links.remove(link)
emission=density.node_tree.nodes.new('ShaderNodeEmission');emission.inputs['Strength'].default_value=1
density.node_tree.links.new(density_socket,emission.inputs['Color'])
density.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])
density_obj.data.materials.append(density);scene.cycles.samples=1
coefficients[:,0,3]=bake(density_obj,density_attr,'EMIT')[:,0]
coefficients[:,1,3]=.38
np.clip(coefficients,-65504,65504).astype('<f2').tofile(args.output/'atmosphere.bin')
receipt={'version':1,'sourceSha256':source_hash,'grid':list(args.grid),'min':minimum.tolist(),'max':maximum.tolist(),
         'format':'float16-rgba-sh1','coefficientCount':4,'samples':args.samples,'albedo':[.73,.8,.8],
         'phase':.38,'lighting':'Cycles direct and indirect irradiance with original light links',
         'density':'Original Blender procedural density emission bake'}
(args.output/'atmosphere.json').write_text(json.dumps(receipt,separators=(',',':'))+'\n',encoding='utf-8')
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('VOLUME_COMPLETE',len(points),'points',flush=True)
