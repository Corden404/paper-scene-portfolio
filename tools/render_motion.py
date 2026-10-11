"""Render real V4 camera flights between chapter stops, without saving the source.

The first flight smoothly releases the reference opening's framing correction;
subsequent flights use the original animated camera transform and focal length.
Run in Blender with -- --output .work/rendered-motion --samples 24.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

STOPS = {'intro':25, 'paper-a':109, 'paper-b':205, 'paper-c':288,
         'paper-d':372, 'paper-e':456, 'paper-f':541, 'screen':654}
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,default=Path('.work/rendered-motion'))
p.add_argument('--samples',type=int,default=24)
p.add_argument('--fps',type=int,default=10)
p.add_argument('--only',choices=list(STOPS)[1:])
p.add_argument('--orientation',choices=('both','landscape','portrait'),default='both')
p.add_argument('--cpu',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
source=Path(bpy.data.filepath);source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
a.output.mkdir(parents=True,exist_ok=True)
receipt=a.output/'motion-manifest.json'
manifest={'source_sha256':source_hash,'blender':bpy.app.version_string,'fps':a.fps,'flights':{}}
if receipt.exists():
    manifest=json.loads(receipt.read_text(encoding='utf-8'))
    if manifest['source_sha256']!=source_hash or manifest['fps']!=a.fps:
        raise RuntimeError('Use a new output folder for a changed source or frame rate')
if not a.cpu:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='CUDA';prefs.get_devices()
    for d in prefs.devices:d.use=d.type=='CUDA'
    if not any(d.use for d in prefs.devices):raise RuntimeError('No CUDA device')
scene=bpy.data.scenes['Scene'];route=scene.camera
reference=bpy.data.scenes['V4 Portrait Frame 25'].camera
scene.frame_set(25)
start_pos=route.matrix_world.translation.copy()
start_rotation=route.matrix_world.to_quaternion()
offset=reference.matrix_world.translation-start_pos
rotation_correction=reference.matrix_world.to_quaternion()@start_rotation.inverted()
start_lens=route.data.lens
camera_data=route.data.copy();camera_data.animation_data_clear()
camera=bpy.data.objects.new('V4 | Website flight camera',camera_data)
scene.collection.objects.link(camera)

def target(stage):
    if stage.startswith('paper-'):
        obj=bpy.data.objects['Paper '+stage[-1].upper()+' | hero surface']
        return obj.matrix_world@(sum((v.co for v in obj.data.vertices),Vector())/len(obj.data.vertices))
    return bpy.data.objects['Monitor warm display'].matrix_world.translation.copy()

entries=list(STOPS.items())
for index in range(1,len(entries)):
    previous,first=entries[index-1];stage,last=entries[index]
    if a.only and stage!=a.only:continue
    count=round((3 if previous=='intro' else 2)*a.fps)+1
    views=[('landscape',(960,540)),('portrait',(408,728))]
    # After the opening both cameras share the same horizontal sensor fit.
    # One tall render can supply both crops, avoiding duplicate scene evaluation.
    if a.orientation=='both' and previous!='intro':views=[('shared',(640,1142))]
    for orientation,dimensions in views:
        if a.orientation not in ('both',orientation):continue
        key=previous+'--'+stage+'-'+orientation
        folder=a.output/key;folder.mkdir(exist_ok=True)
        flight=manifest['flights'].setdefault(key,{'from':previous,'to':stage,'first':first,'last':last,
            'orientation':orientation,'width':dimensions[0],'height':dimensions[1],
            'samples':a.samples,'count':count,'frames':{}})
        if flight['samples']!=a.samples or flight['count']!=count:raise RuntimeError('Changed settings')
        scene.render.engine='CYCLES';scene.cycles.device='CPU' if a.cpu else 'GPU'
        scene.cycles.samples=a.samples;scene.cycles.use_adaptive_sampling=True
        scene.cycles.adaptive_min_samples=min(12,a.samples);scene.cycles.adaptive_threshold=.045
        scene.cycles.use_denoising=True;scene.cycles.denoiser='OPENIMAGEDENOISE';scene.cycles.seed=17
        scene.render.resolution_x,scene.render.resolution_y=dimensions
        scene.render.resolution_percentage=100
        scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
        scene.render.image_settings.color_depth='8'
        for n in range(count):
            path=folder/(f'{n:04d}.png');old=flight['frames'].get(str(n))
            if old and path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()==old['sha256']:continue
            fraction=n/(count-1)
            frame=first+(last-first)*fraction
            scene.camera=route;scene.frame_set(math.floor(frame),subframe=frame%1)
            matrix=route.matrix_world.copy();lens=route.data.lens
            # Exact opening endpoints, followed by the existing authored route.
            release=min(1,max(0,(frame-25)/48));release=release*release*(3-2*release)
            weight=1-release
            matrix.translation+=offset*weight
            rotation=rotation_correction.slerp(Quaternion(),release)@matrix.to_quaternion()
            camera.location=matrix.translation;camera.rotation_mode='QUATERNION';camera.rotation_quaternion=rotation
            reference_lens=reference.data.lens
            if orientation=='landscape':
                reference_lens*=36/(reference.data.sensor_width*1456/816)*540/960
            camera_data.sensor_width=36;camera_data.sensor_fit='HORIZONTAL'
            camera_data.lens=lens+(reference_lens-start_lens)*weight
            scene.camera=camera
            focus=target(previous).lerp(target(stage),fraction)
            forward=rotation@Vector((0,0,-1))
            camera_data.dof.use_dof=True
            camera_data.dof.focus_distance=max(.1,(focus-camera.location).dot(forward))
            camera_data.dof.aperture_fstop=(32 if orientation=='portrait' else 16)*weight+11*(1-weight)
            scene.render.filepath=str(path.resolve())
            start=time.perf_counter();bpy.ops.render.render(scene=scene.name,write_still=True)
            flight['frames'][str(n)]={'frame':round(frame,5),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                'seconds':round(time.perf_counter()-start,2),'camera':list(camera.location),'lens':camera_data.lens}
            receipt.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
            print('FLIGHT_FRAME',key,n+1,count,flight['frames'][str(n)]['seconds'],flush=True)
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('MOTION_RENDER_COMPLETE',len(manifest['flights']),flush=True)
