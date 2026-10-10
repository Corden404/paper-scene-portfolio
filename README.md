# Paper Scene — cinematic interactive portfolio

An immersive two-project portfolio powered by the original Blender scene. The camera travels from the paper canopy through two featured pieces and finishes at an interactive desktop portfolio. Project content lives in `src/config/portfolio.ts`, not inside the Blender file.

## Quick start

```bash
npm install
npm run dev
```

Open the URL printed by Vite. The scene requires `public/assets/paper-scene.glb` and `public/assets/camera-path.json`, generated from the included Blender source:

```bash
blender --background --python tools/export_scene.py
```

The export script defaults to `Paper Portfolio/paper_portfolio_final.blend` and writes to `public/assets`. If Blender is not on your PATH, use its full executable path. After exporting, run `npm run build`.

## Controls

Click the scene or **Next chapter** to advance from opening → Paper A → Paper B → computer. **Skip intro** / **View all work** jumps straight to the screen while accelerating through the original safe camera path. Use **Back** to reverse or **Revisit the scene** after arriving at the screen. `prefers-reduced-motion` and mobile-size renderers use simpler effects by default.

## Customizing content

Change the name, introduction, paper designs, projects, and links in `src/config/portfolio.ts`. The two paper surfaces are rendered with canvas-based ink textures, lit and curved as part of their 3D geometry. Avoid embedding placeholder credentials or private contact details in this public config.

## How it works

- Blender source stays unchanged. `tools/export_scene.py` extracts the camera's world-space position, rotation and focal length for all 360 frames, transforms them to glTF's Y-up coordinates, and exports a web-compatible GLB with the scene's mesh materials and packed image resources.
- Camera movement plays in controlled segments, retaining the Blender camera's original easing. The code also supports accelerated skipping.
- Ambient paper motion is subtle and deterministic, with a cheap shader effect on merged canopy sections and transform animation on individually modeled sheets.
- WebGL and cinematic grading are used for the immersive part; the screen transition ultimately becomes accessible, selectable HTML.

## Quality notes

Cycles shaders and volumetric effects are not portable to WebGL. The web version approximates the reference through cool rim lighting, warm monitor emission, scene fog, tuned tone-mapping, bloom, vignette, and conservative paper materials. Compare screenshots of the same camera frames to your Cycles references and tune the look further. Performance and appearance vary by device.
