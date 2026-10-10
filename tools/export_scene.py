"""
Export the six-paper Blender v3 scene to a glTF GLB for Three.js.

Run from the repository root:
    blender --background --python tools/export_scene.py

The original .blend is opened but NEVER saved/overwritten. 300+ repeated
static objects are merged in-memory, named feature surfaces remain separate,
and all 672 camera poses + the animated lens are written as JSON.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "new model" / "Paper Portfolio — Final Project — 2026-10-10" / "paper_portfolio_six_papers_v3.blend"
OUTPUT = ROOT / "public" / "assets"
OUTPUT.mkdir(parents=True, exist_ok=True)
GLB = OUTPUT / "paper-scene.glb"
PATH_JSON = OUTPUT / "camera-path.json"

print("[paper-export] Blender", bpy.app.version_string)
if not SOURCE.is_file():
    raise FileNotFoundError(SOURCE)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
scene = bpy.context.scene
camera = bpy.data.objects.get("Portfolio preview camera")
if not camera or camera.type != "CAMERA":
    raise RuntimeError("The source Blender project lacks the animated Portfolio preview camera.")
if scene.frame_end != 672:
    raise RuntimeError(f"Expected six-paper v3 camera range ending at 672, got {scene.frame_end}")
for sheet in "ABCDEF":
    if not bpy.data.objects.get(f"Paper {sheet} | hero surface"):
        raise RuntimeError(f"Expected Paper {sheet} hero surface in the new scene")

# Y-up conversion exactly matches Blender glTF's Blender-Z-up -> glTF-Y-up.
axis_conversion = Matrix.Rotation(-math.pi / 2.0, 4, "X")
samples = []
for f in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(f)
    world = axis_conversion @ camera.matrix_world
    q = world.to_quaternion().normalized()
    position = world.to_translation()
    samples.append(
        {
            "frame": f,
            "position": [round(float(v), 7) for v in position],
            "quaternion": [round(q.x, 8), round(q.y, 8), round(q.z, 8), round(q.w, 8)],
            "lens": round(float(camera.data.lens), 6),
        }
    )
camera_json = {
    "source": SOURCE.name,
    "fps": scene.render.fps / scene.render.fps_base,
    "start": scene.frame_start,
    "end": scene.frame_end,
    "sensorWidth": float(camera.data.sensor_width),
    "frames": samples,
    "holds": {
        "intro": [1, 25],
        "paper-a": [96, 121], "paper-b": [192, 217],
        "paper-c": [276, 301], "paper-d": [360, 385],
        "paper-e": [444, 469], "paper-f": [528, 554],
        "screen": [636, 672],
    },
}
PATH_JSON.write_text(json.dumps(camera_json, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print("[paper-export] Camera: ", len(samples), "samples, first", samples[0], "last", samples[-1])
scene.frame_set(scene.frame_start)

# Cycles volume-only meshes MUST NOT be exported as glTF opaque cubes.
# They filled the room and hid the figure and luminous computer in WebGL.
# These removals happen only in Blender memory, never in the source .blend.
for volume_name in ("Depth luminous haze", "Faint workstation atmospheric halo"):
    volume = bpy.data.objects.get(volume_name)
    if volume is not None:
        if volume.type != "MESH":
            raise RuntimeError(f"Expected volume container mesh: {volume_name}")
        bpy.data.objects.remove(volume, do_unlink=True)
        print("[paper-export] Cycles volume excluded:", volume_name)

# The curved hero surfaces have NO UVs in the original Blender file.
# Create planar UVs from each vertex's local X/Y coordinates. Their curvature
# on Z is preserved so the printed artwork catches scene light correctly.
for key in (f"Paper {letter} | hero surface" for letter in "ABCDEF"):
    paper = bpy.data.objects.get(key)
    if not paper or paper.type != "MESH":
        raise RuntimeError("Expected paper hero mesh missing: " + key)
    mesh = paper.data
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    min_x, min_y = min(xs), min(ys)
    len_x = max(max(xs) - min_x, 1e-6)
    len_y = max(max(ys) - min_y, 1e-6)
    uv = mesh.uv_layers.get("PORTFOLIO_CONTENT_UV") or mesh.uv_layers.new(name="PORTFOLIO_CONTENT_UV")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            vert = mesh.vertices[mesh.loops[li].vertex_index]
            uv.data[li].uv = ((vert.co.x - min_x) / len_x, (vert.co.y - min_y) / len_y)
    mesh.uv_layers.active = uv
    print("[paper-export] Project UV", key, len(mesh.vertices), "verts")

# Export a stable per-island identifier for GPU movement of the *merged*
# canopy: all vertices in one disconnected paper island move with one phase.
# The shader reads the custom glTF attribute _SHEET_PHASE.
phase_mesh_count = 0
for mesh in bpy.data.meshes:
    if not any(text in mesh.name for text in (
        "Layered paper canopy", "Continuous medium bowed paper tier",
        "Reference middle-scale crossover sheets", "Irregular descending cascade",
    )):
        continue
    n = len(mesh.vertices)
    if not n or "_SHEET_PHASE" in mesh.attributes:
        continue

    parent = list(range(n))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def join(a, b):
        a = root(a)
        b = root(b)
        if a != b:
            parent[b] = a

    for edge in mesh.edges:
        a, b = edge.vertices
        join(a, b)
    groups = {}
    attr = mesh.attributes.new(name="_SHEET_PHASE", type="FLOAT", domain="POINT")
    for idx in range(n):
        component = root(idx)
        if component not in groups:
            groups[component] = len(groups) + 1
        # Fractional seed is deterministic and spatially coherent per sheet.
        attr.data[idx].value = (groups[component] * 0.61803398875) % 1.0
    phase_mesh_count += 1
    print("[paper-export] Floating islands", mesh.name, len(groups))
print("[paper-export] Canopy objects with GPU paper phases:", phase_mesh_count)

# Join ONLY static repeated details, safely in-memory. Keep separate airborne
# sheets and interactive hero surfaces individually addressable in Three.js.
groups = defaultdict(list)
for obj in list(scene.objects):
    if obj.type != "MESH" or obj.hide_render:
        continue
    n = obj.name
    if n.startswith(("Vertical wall rib ", "Low hall vertical rib")):
        groups["STATIC | wall ribs"].append(obj)
    elif n.startswith("Ground loose sheet "):
        groups["STATIC | fallen paper"].append(obj)
    elif n.startswith(("Key 00 ", "Key 01 ", "Key 02 ", "Key 03 ", "Key 04 ")):
        groups["STATIC | keyboard keys"].append(obj)
    elif n.startswith(("Chair caster", "Chair spoke")):
        groups["STATIC | chair wheels"].append(obj)

for group_name, objects in groups.items():
    if len(objects) < 2:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    objects[0].name = group_name
    print("[paper-export] Joined", len(objects), "static meshes into", group_name)

# Remove source-only camera data, empties are retained as parent nodes. GLB
# lights are deliberately omitted; the browser uses a calibrated WebGL rig.
bpy.ops.object.select_all(action="DESELECT")
scene.frame_set(scene.frame_start)
kwargs = {
    "filepath": str(GLB),
    "export_format": "GLB",
    "use_selection": False,
    "export_yup": True,
    "export_texcoords": True,
    "export_normals": True,
    "export_materials": "EXPORT",
    "export_image_format": "AUTO",
    "export_animations": False,
    "export_cameras": False,
    "export_lights": False,
    "export_extras": True,
    "export_attributes": True,
    "export_apply": False,
}
supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
kwargs = {k: v for k, v in kwargs.items() if k in supported}
print("[paper-export] Exporter kwargs:", kwargs)
result = bpy.ops.export_scene.gltf(**kwargs)
if "FINISHED" not in result:
    raise RuntimeError("glTF exporter did not finish: " + repr(result))
print("[paper-export] Exported", GLB, GLB.stat().st_size, "bytes")
print("[paper-export] Camera path", PATH_JSON, PATH_JSON.stat().st_size, "bytes")
