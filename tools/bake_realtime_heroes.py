"""Bake hero-paper illumination for the full V4 journey.

Small Lambert probes follow the actual curved UV surface on both sides.
Three lighting bases reproduce the two animated reading lights. Their exact
authored energy curves are sampled separately for realtime interpolation.
This script never saves changes to the Blender source.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,default=root/'public/assets/realtime')
p.add_argument('--samples',type=int,default=128)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
a.output.mkdir(parents=True,exist_ok=True)
source=Path(bpy.data.filepath);source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
data=json.loads((root/'public/assets/realtime/scene.json').read_text(encoding='utf-8'))
assert source_hash==data['sourceSha256']
scene=bpy.data.scenes['Scene'];scene.frame_set(25);scene.render.engine='CYCLES'
scene.cycles.device='GPU';scene.cycles.samples=a.samples
scene.cycles.use_adaptive_sampling=False;scene.cycles.use_denoising=False
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='CUDA';prefs.get_devices()
for device in prefs.devices:device.use=device.type=='CUDA'
assert any(d.use for d in prefs.devices)
nx,ny=5,7;frames=(25,109,372);names=['Paper '+c+' | hero surface' for c in 'ABCDEF']
material=bpy.data.materials.new('White hero lighting probe');material.use_nodes=True
material.node_tree.nodes.clear();diffuse=material.node_tree.nodes.new('ShaderNodeBsdfDiffuse')
diffuse.inputs['Color'].default_value=(1,1,1,1);output=material.node_tree.nodes.new('ShaderNodeOutputMaterial')
material.node_tree.links.new(diffuse.outputs[0],output.inputs['Surface'])
bpy.ops.object.select_all(action='DESELECT');probes=[]
for name in names:
 original=bpy.data.objects[name];mesh=original.data;mesh.calc_loop_triangles()
 xs=[v.co.x for v in mesh.vertices];ys=[v.co.y for v in mesh.vertices]
 lower=(min(xs),min(ys));size=(max(xs)-lower[0],max(ys)-lower[1])
 uv=[Vector(((v.co.x-lower[0])/size[0],(v.co.y-lower[1])/size[1],0)) for v in mesh.vertices]
 faces=[tuple(t.vertices) for t in mesh.loop_triangles]
 bvh=BVHTree.FromPolygons(uv,faces,all_triangles=True)
 locations=[]
 for j in range(ny):
  for i in range(nx):
   q=Vector((.025+.95*i/(nx-1),.025+.95*j/(ny-1),0))
   _,_,index,_=bvh.find_nearest(q);ids=faces[index];v0,v1,v2=[uv[k] for k in ids]
   matrix=np.array([[v0.x,v1.x,v2.x],[v0.y,v1.y,v2.y],[1,1,1]])
   weights=np.linalg.solve(matrix,np.array([q.x,q.y,1]))
   pos=sum((mesh.vertices[k].co*w for k,w in zip(ids,weights)),Vector())
   normal=sum((mesh.vertices[k].normal*w for k,w in zip(ids,weights)),Vector()).normalized()
   world=original.matrix_world@pos;normal=(original.matrix_world.to_3x3().inverted().transposed()@normal).normalized()
   locations.append((world,normal))
 vertices=[]
 for side in (1,-1):
  for center,normal in locations:
   n=normal*side;center=center+n*.0015
   t=n.cross(Vector((0,0,1)) if abs(n.z)<.9 else Vector((0,1,0))).normalized();b=n.cross(t);eps=.00025
   vertices.extend((center-(t+b)*eps,center+(t-b)*eps,center+b*(eps*2)))
 co=np.asarray(vertices,dtype=np.float32);probe_mesh=bpy.data.meshes.new('Lighting '+name)
 probe_mesh.vertices.add(len(co));probe_mesh.vertices.foreach_set('co',co.ravel())
 probe_mesh.loops.add(len(co));probe_mesh.loops.foreach_set('vertex_index',np.arange(len(co),dtype=np.int32))
 count=len(co)//3;probe_mesh.polygons.add(count)
 probe_mesh.polygons.foreach_set('loop_start',np.arange(count,dtype=np.int32)*3)
 probe_mesh.polygons.foreach_set('loop_total',np.full(count,3,dtype=np.int32));probe_mesh.update(calc_edges=True)
 attr=probe_mesh.color_attributes.new(name='Hero irradiance',type='FLOAT_COLOR',domain='CORNER')
 probe_mesh.color_attributes.active_color=attr;probe_mesh.color_attributes.render_color_index=0
 probe_mesh.materials.append(material);obj=bpy.data.objects.new('WEB | '+name+' lighting',probe_mesh)
 scene.collection.objects.link(obj)
 for field in ('visible_shadow','visible_diffuse','visible_glossy','visible_transmission','visible_volume_scatter'):setattr(obj,field,False)
 for light in (o for o in scene.objects if o.type=='LIGHT'):
  receivers=light.light_linking.receiver_collection
  if receivers and original.name in receivers.all_objects and obj.name not in receivers.objects:receivers.objects.link(obj)
 obj.select_set(True);probes.append((obj,attr))
bpy.context.view_layer.objects.active=probes[0][0]
lighting=np.zeros((len(frames),len(names),2,ny,nx,3),dtype=np.float32)
for fi,frame in enumerate(frames):
 scene.frame_set(frame)
 result=bpy.ops.object.bake(type='DIFFUSE',pass_filter={'DIRECT','INDIRECT'},target='VERTEX_COLORS',use_selected_to_active=False,use_clear=True)
 for hi,(obj,attr) in enumerate(probes):
  colors=np.empty((len(attr.data),4),dtype=np.float32);attr.data.foreach_get('color',colors.ravel())
  colors=colors.reshape((-1,3,4))[:,:,:3].mean(axis=1)
  lighting[fi,hi]=colors.reshape((2,ny,nx,3))
 print('HERO_LIGHTING_FRAME',frame,result,float(lighting[fi].min()),float(np.median(lighting[fi])),float(lighting[fi].max()),flush=True)
assert np.isfinite(lighting).all() and lighting.max()>0
np.clip(lighting,0,65504).astype('<f2').tofile(a.output/'hero-lighting.bin')
weights=[]
for frame in range(data['camera']['frames'][0]['frame'],data['camera']['frames'][-1]['frame']+1):
 scene.frame_set(frame)
 reading=bpy.data.objects['V4 | Portfolio reading softbox'].data.energy/120
 fill=bpy.data.objects['V4 | Paper D reading fill'].data.energy/24
 weights.append([frame,round(reading,6),round(fill,6)])
receipt={'sourceSha256':source_hash,'frames':list(frames),'names':names,'grid':[nx,ny],
         'samples':a.samples,'format':'float16-rgb','weights':weights,
         'basis':'ambient, ambient+reading, ambient+reading+paper-d-fill'}
(a.output/'hero-lighting.json').write_text(json.dumps(receipt,separators=(',',':'))+'\n',encoding='utf-8')
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('HERO_LIGHTING_COMPLETE',flush=True)
