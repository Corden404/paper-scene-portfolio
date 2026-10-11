"""Validate the shipped 3D geometry, camera route and illumination assets."""
import hashlib
import json
import math
import struct
from pathlib import Path

root = Path(__file__).resolve().parents[1]
assets = root / 'public/assets/realtime'
data = json.loads((assets / 'scene.json').read_text(encoding='utf-8'))
source = root / 'V4 — Reference Match' / data['source']
assert hashlib.sha256(source.read_bytes()).hexdigest() == data['sourceSha256']
binary = (assets / 'papers.bin').read_bytes()
assert len(binary) == data['instanceCount'] * data['instanceStride'] * 4
assert data['instanceCount'] == 10436 and data['instanceStride'] == 23
assert sum(group['count'] for group in data['groups']) == data['instanceCount']
next_offset = 0
for group in data['groups']:
    assert group['offset'] == next_offset
    next_offset += group['count'] * data['instanceStride'] * 4
    assert (assets / group['prototype']['texture']).is_file()
    for geo in group['prototype']['levels']:
        assert len(geo['positions']) == len(geo['normals'])
        assert len(geo['positions']) // 3 == len(geo['uvs']) // 2
        assert len(geo['indices']) % 3 == 0
        assert min(geo['indices']) >= 0
        assert max(geo['indices']) < len(geo['positions']) // 3
        assert all(math.isfinite(v) for v in geo['positions'] + geo['normals'])
for row in struct.iter_unpack('<23f', binary):
    assert all(math.isfinite(v) for v in row)
    assert row[3] == row[7] == row[11] == 0 and row[15] == 1
frames = data['camera']['frames']
assert [f['frame'] for f in frames] == list(range(25, 655))
assert data['stops'] == {'intro':25, 'paper-a':109, 'paper-b':205, 'paper-c':288,
                         'paper-d':372, 'paper-e':456, 'paper-f':541, 'screen':654}
atmosphere = json.loads((assets / 'atmosphere.json').read_text(encoding='utf-8'))
for camera in frames:
    assert camera['landscapeLens'] > 0 and camera['portraitLens'] > 0
    assert abs(sum(v*v for v in camera['quaternion']) - 1) < .0001
    assert all(atmosphere['min'][i] < p < atmosphere['max'][i]
               for i, p in enumerate(camera['position']))
glb = (assets / 'room.glb').read_bytes()
magic, version, size, json_size, kind = struct.unpack_from('<5I', glb)
assert magic == 0x46546C67 and version == 2 and size == len(glb) and kind == 0x4E4F534A
room = json.loads(glb[20:20 + json_size])
assert len(room['meshes']) <= 20
assert sum('hero surface' in n.get('name', '') for n in room['nodes']) == 6
assert len(room['images']) == 7
assert data['assetVersion'] == hashlib.sha256(glb + binary).hexdigest()[:12]
for name, expected in [('lighting', data['instanceCount']*2*3*5*3*2),
                       ('hero-lighting', 3*6*2*5*7*3*2),
                       ('atmosphere', math.prod(atmosphere['grid'])*4*4*2)]:
    meta = json.loads((assets / (name + '.json')).read_text(encoding='utf-8'))
    assert meta['sourceSha256'] == data['sourceSha256']
    payload = (assets / (name + '.bin')).read_bytes()
    assert len(payload) == expected
    samples = [v[0] for v in struct.iter_unpack('<e', payload)]
    assert all(math.isfinite(v) for v in samples) and max(samples) > 0
hero = json.loads((assets / 'hero-lighting.json').read_text(encoding='utf-8'))
assert hero['frames'] == [25, 109, 372]
weights = hero['weights']
assert [w[0] for w in weights] == [f['frame'] for f in frames]
assert all(0 <= v <= 1 for w in weights for v in w[1:])
assert weights[109 - 25][1:] == [1, 0]
assert weights[372 - 25][1:] == [1, 1]
assert weights[-1][1:] == [0, 0]
grade = (assets / 'source-grade.png').read_bytes()
assert grade[:8] == b'\x89PNG\r\n\x1a\n'
assert struct.unpack_from('>2I', grade, 16) == (48*48, 48)
profile = (assets / 'github-profile.png').read_bytes()
assert profile[:8] == b'\x89PNG\r\n\x1a\n'
print('PASS: unchanged V4 source, 10436 real instances, six printed sheets, 630 camera samples and eight stops')
print('PASS: source AgX grade, finite surface/volume lighting and exact reading-light energy curves')
print('Realtime asset bytes:', sum(p.stat().st_size for p in assets.iterdir() if p.is_file()))
