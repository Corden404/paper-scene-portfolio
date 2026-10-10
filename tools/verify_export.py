"""
Small stdlib verification of generated GLB/JSON without a browser or Blender.
Checks the actual binary GLB header, embedded scene graph, and full camera track.
"""
from __future__ import annotations
from pathlib import Path
import json
import struct

root = Path(__file__).resolve().parents[1] / "public" / "assets"
p = root / "paper-scene.glb"
camera_file = root / "camera-path.json"
data = p.read_bytes()
assert len(data) >= 20, "GLB truncated"
magic, version, size = struct.unpack_from("<4sII", data)
assert magic == b"glTF" and version == 2 and size == len(data), (magic, version, size, len(data))
chunk_size, chunk_type = struct.unpack_from("<II", data, 12)
assert chunk_type == 0x4E4F534A, "First GLB chunk must be JSON"
gltf = json.loads(data[20:20 + chunk_size])
names = {obj.get("name", "") for obj in gltf.get("nodes", [])}
for needle in (*[f"Paper {i} | hero surface" for i in "ABCDEF"], "Monitor warm display"):
    assert needle in names, f"GLB missing key geometry: {needle}"
for forbidden in ("Depth luminous haze", "Faint workstation atmospheric halo"):
    assert forbidden not in names, f"WebGL cannot render Cycles-only volume mesh: {forbidden}"
phase_nodes = []
for node in gltf["nodes"]:
    if "mesh" not in node:
        continue
    mesh = gltf["meshes"][node["mesh"]]
    if any("_SHEET_PHASE" in prim.get("attributes", {}) for prim in mesh["primitives"]):
        phase_nodes.append(node.get("name", ""))
assert len(phase_nodes) >= 20, f"Expected floating sheet island attributes on canopy and cascade; found {len(phase_nodes)}"
assert sum(name.startswith("Irregular descending cascade") for name in phase_nodes) >= 5
camera = json.loads(camera_file.read_text(encoding="utf-8"))
frames = camera["frames"]
assert camera["source"] == "paper_portfolio_six_papers_v3.blend"
assert len(frames) == 672
assert frames[0]["frame"] == 1 and frames[-1]["frame"] == 672
assert list(camera["holds"]) == ["intro", "paper-a", "paper-b", "paper-c", "paper-d", "paper-e", "paper-f", "screen"]
assert all(1 <= a <= b <= 672 for a, b in camera["holds"].values())
assert all(len(f["position"]) == 3 and len(f["quaternion"]) == 4 for f in frames)
print("GLB VALID", len(data), "bytes", len(gltf.get("nodes", [])), "nodes", len(gltf.get("meshes", [])), "meshes")
print("CAMERA VALID", len(frames), "frames")
print("FEATURE OBJECTS VERIFIED", len(phase_nodes), "GPU sheet groups")
