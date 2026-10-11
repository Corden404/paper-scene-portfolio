"""Render the eight V4 portfolio stops in landscape and portrait.

Run with Blender 5.2+: blender --background <V4.blend> --python
tools/render_frames.py -- --output .work/rendered-frames
The opened .blend and global Blender preferences are never saved.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

STOPS = {"intro": 25, "paper-a": 109, "paper-b": 205, "paper-c": 288,
         "paper-d": 372, "paper-e": 456, "paper-f": 541, "screen": 654}
p = argparse.ArgumentParser(description=__doc__)
p.add_argument("--output", type=Path, default=Path(".work/rendered-frames"))
p.add_argument("--samples", type=int, default=64)
p.add_argument("--only", choices=list(STOPS))
p.add_argument("--orientation", choices=("both", "landscape", "portrait"), default="both")
p.add_argument("--cpu", action="store_true")
a = p.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
if a.samples < 16:
    raise ValueError("At least 16 samples are required")
source = Path(bpy.data.filepath)
if not source.is_file():
    raise RuntimeError("Open the V4 Blender source before running this script")
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
a.output.mkdir(parents=True, exist_ok=True)
receipt = a.output / "render-manifest.json"
manifest = {"source_sha256": source_hash, "blender": bpy.app.version_string, "shots": {}}
if receipt.exists():
    previous = json.loads(receipt.read_text(encoding="utf-8"))
    if previous["source_sha256"] != source_hash:
        raise RuntimeError("This output folder belongs to another source; use a new folder")
    manifest = previous

if not a.cpu:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "CUDA"
    prefs.get_devices()
    for device in prefs.devices:
        device.use = device.type == "CUDA"
    if not any(d.use for d in prefs.devices):
        raise RuntimeError("No CUDA device found; run with --cpu on another machine")

scene = bpy.data.scenes["Scene"]
portrait_scene = bpy.data.scenes["V4 Portrait Frame 25"]
route_camera = scene.camera
reference_camera = portrait_scene.camera
camera_data = route_camera.data.copy()
camera_data.animation_data_clear()
still_camera = bpy.data.objects.new("V4 | Website still camera", camera_data)
scene.collection.objects.link(still_camera)

for stage, frame in STOPS.items():
    if a.only and stage != a.only:
        continue
    for orientation, dimensions in (("landscape", (1920, 1080)), ("portrait", (816, 1456))):
        if a.orientation != "both" and orientation != a.orientation:
            continue
        key = stage + "-" + orientation
        output = a.output / (key + ".png")
        old = manifest["shots"].get(key)
        if (old and old["samples"] == a.samples
                and (old["width"], old["height"]) == dimensions and output.exists()
                and hashlib.sha256(output.read_bytes()).hexdigest() == old["sha256"]):
            print("FRAME_CACHED", key, flush=True)
            continue

        scene.camera = route_camera
        scene.frame_set(frame)
        portrait_scene.frame_set(frame)
        if stage == "intro" and orientation == "portrait":
            active = portrait_scene
        else:
            active = scene
            original = reference_camera if stage == "intro" else route_camera
            still_camera.matrix_world = original.matrix_world.copy()
            camera_data.lens = original.data.lens
            camera_data.sensor_width = original.data.sensor_width
            camera_data.sensor_fit = "HORIZONTAL"
            if stage == "intro":
                # Keep the reference's vertical composition on a wide screen.
                camera_data.sensor_fit = "VERTICAL"
                camera_data.sensor_height = original.data.sensor_width * 1456 / 816
            active.camera = still_camera
            if stage.startswith("paper-"):
                target = bpy.data.objects["Paper " + stage[-1].upper() + " | hero surface"]
                point = target.matrix_world @ (sum((v.co for v in target.data.vertices), Vector()) / len(target.data.vertices))
            else:
                point = bpy.data.objects["Monitor warm display"].matrix_world.translation
            forward = still_camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
            camera_data.dof.use_dof = True
            camera_data.dof.focus_distance = max(.1, (point - still_camera.matrix_world.translation).dot(forward))
            camera_data.dof.aperture_fstop = 16 if stage == "intro" else 11

        active.render.engine = "CYCLES"
        active.cycles.device = "CPU" if a.cpu else "GPU"
        active.cycles.samples = a.samples
        active.cycles.use_adaptive_sampling = True
        active.cycles.adaptive_min_samples = min(24, a.samples)
        active.cycles.adaptive_threshold = .02
        active.cycles.use_denoising = True
        active.cycles.denoiser = "OPENIMAGEDENOISE"
        active.cycles.seed = 17
        active.render.resolution_x, active.render.resolution_y = dimensions
        active.render.resolution_percentage = 100
        active.render.image_settings.file_format = "PNG"
        active.render.image_settings.color_mode = "RGB"
        active.render.image_settings.color_depth = "16"
        active.render.filepath = str(output.resolve())
        print("FRAME_START", key, frame, flush=True)
        start = time.perf_counter()
        bpy.ops.render.render(scene=active.name, write_still=True)
        manifest["shots"][key] = {"stage": stage, "frame": frame, "orientation": orientation,
            "width": dimensions[0], "height": dimensions[1], "samples": a.samples,
            "seconds": round(time.perf_counter() - start, 2),
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}
        receipt.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print("FRAME_DONE", key, manifest["shots"][key]["seconds"], flush=True)

assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
print("RENDER_COMPLETE", len(manifest["shots"]), flush=True)
