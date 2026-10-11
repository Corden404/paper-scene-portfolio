"""Verify the rendered delivery is intact and bound to the current V4 source."""
import argparse
import hashlib
import json
import struct
from pathlib import Path

from PIL import Image


def mp4_boxes(data):
    """Iterate ISO BMFF boxes, including extended-size boxes."""
    offset=0
    while offset<len(data):
        assert len(data)-offset>=8, 'Truncated MP4 box'
        size,kind=struct.unpack_from('>I4s',data,offset)
        header=8
        if size==1:
            assert len(data)-offset>=16
            size=struct.unpack_from('>Q',data,offset+8)[0];header=16
        elif size==0:size=len(data)-offset
        assert header<=size<=len(data)-offset, 'Invalid MP4 box size'
        yield kind,data[offset+header:offset+size]
        offset+=size


def video_stream(data):
    """Read the encoded video track rather than trusting manifest dimensions."""
    moov=next(payload for kind,payload in mp4_boxes(data) if kind==b'moov')
    for kind,trak in mp4_boxes(moov):
        if kind!=b'trak':continue
        mdia=next(payload for kind,payload in mp4_boxes(trak) if kind==b'mdia')
        media=dict(mp4_boxes(mdia))
        if media[b'hdlr'][8:12]!=b'vide':continue
        header=media[b'mdhd']
        if header[0]==0:
            timescale,duration=struct.unpack_from('>II',header,12)
        else:
            timescale=struct.unpack_from('>I',header,20)[0]
            duration=struct.unpack_from('>Q',header,24)[0]
        minf=dict(mp4_boxes(media[b'minf']))
        samples=dict(mp4_boxes(minf[b'stbl']))
        codec,entry=next(mp4_boxes(samples[b'stsd'][8:]))
        assert codec==b'avc1', 'Camera clips must contain H.264 video'
        width,height=struct.unpack_from('>HH',entry,24)
        count=struct.unpack_from('>I',samples[b'stsz'],8)[0]
        assert timescale>0 and duration>0 and count>0
        return width,height,count,count*timescale/duration
    raise AssertionError('No encoded video track')


root = Path(__file__).resolve().parents[1]
source = root / 'V4 — Reference Match/paper_portfolio_reference_match_v4.blend'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--folder', type=Path, default=root / 'public/assets/rendered')
folder = p.parse_args().folder.resolve()
manifest = json.loads((folder / 'frames.json').read_text(encoding='utf-8'))
assert manifest['version'] == 'V4'
assert hashlib.sha256(source.read_bytes()).hexdigest() == manifest['sourceSha256'], 'Renders belong to an older Blender source'
expected = {'intro': 25, 'paper-a': 109, 'paper-b': 205, 'paper-c': 288,
            'paper-d': 372, 'paper-e': 456, 'paper-f': 541, 'screen': 654}
assert set(manifest['frames']) == set(expected), 'Missing or extra chapters'
digests = set()
count = 0
for stage, frame_number in expected.items():
    frame = manifest['frames'][stage]
    assert frame['frame'] == frame_number, 'Incorrect camera stop: ' + stage
    for orientation, size in (('landscape', (1920, 1080)), ('portrait', (816, 1456))):
        images = frame[orientation]
        assert (images['width'], images['height']) == size
        for mode in ('cinema', 'lite'):
            url, hash_key = images[mode].split('?v=')
            assert url.startswith('/assets/rendered/'), 'Unexpected frame URL'
            path = (folder / url.removeprefix('/assets/rendered/')).resolve()
            assert path.parent == folder.resolve(), 'Frame path escapes the asset folder'
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            assert digest.startswith(hash_key), 'Changed delivery image: ' + path.name
            assert digest not in digests, 'Duplicate image substituted for a chapter'
            digests.add(digest)
            with Image.open(path) as image:
                image.load()
                width = size[0] if mode == 'cinema' else (960 if orientation == 'landscape' else 612)
                assert image.size == (width, round(size[1] * width / size[0]))
                assert image.format == 'WEBP' and image.mode == 'RGB'
            count += 1
assert count == 32
motion=manifest['motion']
assert motion['fps']>=24 and motion['renderedFps']==motion['fps']
assert motion['interpolated'] is False, 'Camera clips must contain actual rendered frames'
route=list(expected)
flight_count=0
for i in range(len(route)-1):
    for start,end in [(route[i],route[i+1]),(route[i+1],route[i])]:
        flight=motion['flights'][start+'--'+end]
        for orientation in ('landscape','portrait'):
            clip=flight[orientation]
            url,hash_key=clip['url'].split('?v=')
            assert url.startswith('/assets/rendered/'), 'Unexpected flight URL'
            path=(folder/url.removeprefix('/assets/rendered/')).resolve()
            assert path.parent==folder.resolve()
            data=path.read_bytes()
            digest=hashlib.sha256(data).hexdigest()
            assert digest.startswith(hash_key) and digest not in digests
            digests.add(digest)
            assert data[4:8]==b'ftyp' and b'moov' in data[:200000], 'MP4 must support progressive playback'
            assert clip['sourceFrames']==[expected[start],expected[end]]
            assert (clip['width'],clip['height'])==((1920,1080) if orientation=='landscape' else (816,1456))
            assert clip['frameCount']==(3 if 'intro' in (start,end) else 2)*motion['fps']+1
            width,height,frames,fps=video_stream(data)
            assert (width,height,frames)==(clip['width'],clip['height'],clip['frameCount'])
            assert abs(fps-motion['fps'])<.001, 'Encoded frame rate differs from rendered frame rate'
            flight_count+=1
assert flight_count==28 and len(motion['flights'])==14
print('V4 source SHA, 8 camera stops, 32 decoded images and 28 versioned camera flights verified.')
