"""Package Blender PNGs as the website's full and lightweight WebP frames.

Requires Pillow and NumPy. Raw renders and diagnostic receipts stay outside
public/. Only delivery images and the browser's frame manifest are packaged.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

STAGES = ("intro", "paper-a", "paper-b", "paper-c", "paper-d", "paper-e", "paper-f", "screen")


def finish(image, stage):
    """Cool transmitted light and highlight-only lens diffusion."""
    image = image.convert("RGB")
    rgb = np.asarray(image, dtype=np.float32)
    height, width = rgb.shape[:2]
    x = np.linspace(-1, 1, width)[None, :]
    y = np.linspace(0, 1, height)[:, None]
    if stage == "intro":
        # The central opening remains luminous; the hall edges retain depth.
        edge = 1 - .30 * x ** 2 * np.clip((.85 - y) / .4, 0, 1)
        rgb = 255 * np.power(rgb / 255, 1.12)
        rgb *= edge[..., None]
        # Preserve the warm monitor and its reflection below the cool canopy.
        canopy = np.clip((.76 - y) / .10, 0, 1)
        rgb *= 1 + canopy[..., None] * np.array([-.09, .01, .085], dtype=np.float32)
    else:
        rgb *= np.array([.97, 1.0, 1.025], dtype=np.float32)
    base = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    # Scatter only luminous gaps and the screen; printed ink keeps its contrast.
    values = np.asarray(base, dtype=np.float32) / 255
    luminance = values @ np.array([.2126, .7152, .0722])
    highlights = np.clip((luminance - .58) / .38, 0, 1)
    mask = Image.fromarray((highlights * 255).astype(np.uint8))
    glow = np.asarray(mask.filter(ImageFilter.GaussianBlur(width / 65)), dtype=np.float32) / 255
    strength = .36 if stage == 'intro' else .20
    values = 1 - (1 - values) * (1 - strength * glow[..., None])
    diffused = Image.fromarray(np.clip(values * 255, 0, 255).astype(np.uint8))
    return diffused


def package(folder, output):
    receipt = json.loads((folder / "render-manifest.json").read_text(encoding="utf-8"))
    output.mkdir(parents=True, exist_ok=True)
    manifest = {"version": "V4", "sourceSha256": receipt["source_sha256"], "frames": {}}
    for stage in STAGES:
        frame = {}
        for orientation in ("landscape", "portrait"):
            key = stage + "-" + orientation
            shot = receipt["shots"][key]
            raw = folder / (key + ".png")
            if hashlib.sha256(raw.read_bytes()).hexdigest() != shot["sha256"]:
                raise RuntimeError("Render checksum mismatch: " + key)
            with Image.open(raw) as image:
                if image.size != (shot["width"], shot["height"]):
                    raise RuntimeError("Render dimensions mismatch: " + key)
                image = finish(image, stage)
            paths = {}
            for quality, width in (("cinema", image.width), ("lite", 960 if orientation == "landscape" else 612)):
                resized = image if width == image.width else image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS)
                name = key + ("-lite" if quality == "lite" else "") + ".webp"
                path = output / name
                resized.save(path, "WEBP", quality=94 if quality == "cinema" else 85, method=6)
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                paths[quality] = "/assets/rendered/" + name + "?v=" + digest[:10]
            paths.update(width=shot["width"], height=shot["height"])
            frame[orientation] = paths
            frame["frame"] = shot["frame"]
        manifest["frames"][stage] = frame
    (output / "frames.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Packaged 16 rendered views and 16 lightweight views.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path(".work/rendered-frames"))
    parser.add_argument("--output", type=Path, default=Path("public/assets/rendered"))
    args = parser.parse_args()
    package(args.input, args.output)
