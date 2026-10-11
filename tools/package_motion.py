"""Finish and encode real camera flights, including reverse navigation.

Requires Pillow, NumPy and an H.264-capable FFmpeg. The 10 fps Cycles sequence
is interpolated to 24 fps only between rendered poses; camera geometry is baked.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

from PIL import Image
from package_frames import finish


def package(folder, output, ffmpeg, partial=False):
    receipt=json.loads((folder/'motion-manifest.json').read_text(encoding='utf-8'))
    manifest_path=output/'frames.json'
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest['sourceSha256']!=receipt['source_sha256']:
        raise RuntimeError('Still images and flights must share one Blender source')
    flights={}
    cache_path=folder/'encoded-manifest.json'
    cache=json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}
    recipe=hashlib.sha256(Path(__file__).read_bytes()+Path(__file__).with_name('package_frames.py').read_bytes()).hexdigest()
    for key, flight in receipt['flights'].items():
        if len(flight['frames'])!=flight['count']:
            if partial:continue
            raise RuntimeError('Incomplete flight: '+key)
        views=('landscape','portrait') if flight['orientation']=='shared' else (flight['orientation'],)
        signature=hashlib.sha256((recipe+json.dumps(flight,sort_keys=True)).encode()).hexdigest()
        for orientation in views:
            width,height=(960,540) if orientation=='landscape' else (408,728)
            processed=folder/(key+'-'+orientation+'-finished');processed.mkdir(exist_ok=True)
            for n in range(flight['count']):
                raw=folder/key/(f'{n:04d}.png')
                if hashlib.sha256(raw.read_bytes()).hexdigest()!=flight['frames'][str(n)]['sha256']:
                    raise RuntimeError('Render checksum mismatch: '+str(raw))
                with Image.open(raw) as image:
                    if image.size!=(flight['width'],flight['height']):raise RuntimeError('Wrong size')
                    if flight['orientation']=='shared':
                        if orientation=='landscape':
                            crop_height=round(image.width*9/16)
                            top=(image.height-crop_height)//2
                            image=image.crop((0,top,image.width,top+crop_height))
                        image=image.resize((width,height),Image.Resampling.LANCZOS)
                    result=finish(image,flight['to'])
                    if flight['from']=='intro':
                        result=Image.blend(finish(image,'intro'),result,n/(flight['count']-1))
                    result.save(processed/(f'{n:04d}.png'))
            for reverse in (False,True):
                start,end=(flight['to'],flight['from']) if reverse else (flight['from'],flight['to'])
                name=start+'--'+end+'-'+orientation+'.mp4';path=output/name
                old=cache.get(name)
                if not (old and old['signature']==signature and path.exists()
                        and hashlib.sha256(path.read_bytes()).hexdigest()==old['sha256']):
                    duration=(flight['count']-1)/receipt['fps']+1/24
                    filters=('tpad=stop_mode=clone:stop_duration=0.3,'
                        'minterpolate=fps=24:mi_mode=mci:mc_mode=aobmc:vsbmc=1,'
                        f'trim=duration={duration},setpts=PTS-STARTPTS')
                    if reverse:filters+=',reverse'
                    subprocess.run([ffmpeg,'-hide_banner','-loglevel','error','-y','-framerate',str(receipt['fps']),
                        '-i',str(processed/'%04d.png'),'-vf',filters,'-c:v','libx264','-preset','slow',
                        '-crf','19','-pix_fmt','yuv420p','-movflags','+faststart','-an',str(path)],check=True)
                digest=hashlib.sha256(path.read_bytes()).hexdigest()
                cache[name]={'signature':signature,'sha256':digest}
                cache_path.write_text(json.dumps(cache,indent=2),encoding='utf-8')
                flights.setdefault(start+'--'+end,{})[orientation]={
                    'url':'/assets/rendered/'+name+'?v='+digest[:10],'width':width,'height':height,
                    'sourceFrames':[flight['last'],flight['first']] if reverse else [flight['first'],flight['last']]}
        print('ENCODED',key,flush=True)
    if not partial and (len(flights)!=14 or any(len(v)!=2 for v in flights.values())):
        raise RuntimeError('Expected seven flights in both directions and orientations')
    manifest['motion']={'fps':24,'renderedFps':receipt['fps'],'flights':flights}
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print('Packaged',sum(len(v) for v in flights.values()),'camera flights.',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,default=Path('.work/rendered-motion'))
    p.add_argument('--output',type=Path,default=Path('public/assets/rendered'))
    p.add_argument('--ffmpeg',default=shutil.which('ffmpeg'))
    p.add_argument('--partial',action='store_true',help='Package completed flights for a local incremental preview')
    args=p.parse_args()
    if not args.ffmpeg:p.error('Supply --ffmpeg or install FFmpeg on PATH')
    package(args.input,args.output,args.ffmpeg,args.partial)
