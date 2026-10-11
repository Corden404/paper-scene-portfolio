"""Render real V4 camera flights between chapter stops, without saving the source.

The first flight smoothly releases the reference opening's framing correction;
subsequent flights use the original animated camera transform and focal length.
Render at native display resolution and frame rate; no shared low-resolution
crop or generated intermediate frames are used. The source is never saved.
"""
import argparse
import hashlib
import json
import math
import shutil
import sys
import time
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

STOPS = {'intro':25, 'paper-a':109, 'paper-b':205, 'paper-c':288,
         'paper-d':372, 'paper-e':456, 'paper-f':541, 'screen':654}
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--output',type=Path,default=Path('.work/rendered-motion'))
p.add_argument('--samples',type=int,default=32)
p.add_argument('--fps',type=int,default=24)
p.add_argument('--stills',type=Path,help='Reuse matching full-resolution endpoint renders')
p.add_argument('--frame-indices',help='Render selected comma-separated indices for a quality preview')
p.add_argument('--device',choices=('CUDA','OPTIX'),default='CUDA')
p.add_argument('--only',choices=list(STOPS)[1:])
p.add_argument('--orientation',choices=('both','landscape','portrait'),default='both')
p.add_argument('--cpu',action='store_true')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
if a.samples<16 or a.fps<24:raise ValueError('Camera flights require at least 16 samples and 24 native fps')
selected={int(n) for n in a.frame_indices.split(',')} if a.frame_indices else None
source=Path(bpy.data.filepath);source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
recipe=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
a.output.mkdir(parents=True,exist_ok=True)
receipt=a.output/'motion-manifest.json'
manifest={'source_sha256':source_hash,'recipe':recipe,'blender':bpy.app.version_string,'fps':a.fps,'flights':{}}
if receipt.exists():
    manifest=json.loads(receipt.read_text(encoding='utf-8'))
    if manifest['source_sha256']!=source_hash or manifest['fps']!=a.fps or manifest.get('recipe')!=recipe:
        raise RuntimeError('Use a new output folder for a changed source or render recipe')
stills=json.loads((a.stills/'render-manifest.json').read_text(encoding='utf-8')) if a.stills else None
if stills and stills['source_sha256']!=source_hash:raise RuntimeError('Endpoint renders belong to another source')
if not a.cpu:
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type=a.device;prefs.get_devices()
    for d in prefs.devices:d.use=d.type==a.device
    if not any(d.use for d in prefs.devices):raise RuntimeError('No '+a.device+' device')
    print('RENDER_DEVICE',a.device,flush=True)
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
    views=[('landscape',(1920,1080)),('portrait',(816,1456))]
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
        scene.cycles.adaptive_min_samples=min(8,a.samples);scene.cycles.adaptive_threshold=.04
        scene.cycles.volume_step_rate=8
        scene.cycles.use_denoising=True;scene.cycles.denoiser='OPENIMAGEDENOISE';scene.cycles.seed=17
        scene.cycles.denoising_use_gpu=not a.cpu
        scene.render.use_persistent_data=True
        scene.render.use_motion_blur=False
        scene.render.compositor_device='CPU' if a.cpu else 'GPU'
        scene.render.resolution_x,scene.render.resolution_y=dimensions
        scene.render.resolution_percentage=100
        scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
        scene.render.image_settings.color_depth='16'
        scene.render.image_settings.compression=15
        for n in range(count):
            if selected is not None and n not in selected:continue
            path=folder/(f'{n:04d}.png');old=flight['frames'].get(str(n))
            if old and path.exists() and hashlib.sha256(path.read_bytes()).hexdigest()==old['sha256']:continue
            fraction=n/(count-1)
            frame=first+(last-first)*fraction
            endpoint=previous if n==0 else stage if n==count-1 else None
            if endpoint and stills:
                shot=stills['shots'][endpoint+'-'+orientation]
                raw=a.stills/(endpoint+'-'+orientation+'.png')
                if (shot['width'],shot['height'])!=dimensions or shot['samples']<a.samples:
                    raise RuntimeError('Endpoint quality does not match flight')
                if hashlib.sha256(raw.read_bytes()).hexdigest()!=shot['sha256']:
                    raise RuntimeError('Endpoint checksum mismatch')
                shutil.copy2(raw,path)
                flight['frames'][str(n)]={'frame':frame,'sha256':shot['sha256'],'seconds':0,'endpoint':endpoint}
                receipt.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
                print('FLIGHT_ENDPOINT',key,n+1,count,flush=True)
                continue
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
            endpoint_aperture=(32 if orientation=='portrait' else 16)*weight+11*(1-weight)
            # A deeper focus field keeps passing sheets sharp. Restore the
            # reading stop's aperture smoothly at each end of the flight.
            camera_data.dof.aperture_fstop=endpoint_aperture+(64-endpoint_aperture)*math.sin(math.pi*fraction)**2
            scene.render.filepath=str(path.resolve())
            start=time.perf_counter();bpy.ops.render.render(scene=scene.name,write_still=True)
            flight['frames'][str(n)]={'frame':round(frame,5),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                'seconds':round(time.perf_counter()-start,2),'camera':list(camera.location),'lens':camera_data.lens}
            receipt.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
            print('FLIGHT_FRAME',key,n+1,count,flight['frames'][str(n)]['seconds'],flush=True)
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
print('MOTION_RENDER_COMPLETE',len(manifest['flights']),flush=True)
