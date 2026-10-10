# Paper Scene — cinematic interactive portfolio

An immersive two-project portfolio powered by the original Blender scene. The camera travels from the paper canopy through two featured pieces and finishes at an interactive desktop portfolio. Project content lives in `src/config/portfolio.ts`, not inside the Blender file.

## 本地运行 / Quick start

模型与镜头轨迹已经导出并提交到仓库，首次运行无需再打开 Blender。

```bash
cd "G:\\Dev\\Paper Scene"
npm ci
npm run dev
```

随后用浏览器打开 Vite 提示的本地地址，通常是 `http://127.0.0.1:5173/`。浏览器需要支持 WebGL2。编辑 `src/config/portfolio.ts` 中的名字、项目标题、成果说明、邮箱及 GitHub 地址后即可替换演示内容。

Open the URL printed by Vite. The scene requires `public/assets/paper-scene.glb` and `public/assets/camera-path.json`, generated from the included Blender source:

```bash
blender --background --python tools/export_scene.py
```

The export script defaults to `Paper Portfolio/paper_portfolio_final.blend` and writes to `public/assets`. If Blender is not on your PATH, use its full executable path. The script **never saves the source .blend**. Importantly, it leaves out the two Cycles-only fog volumes which otherwise become opaque blocking meshes in WebGL.

```bash
npm run verify:scene    # Validate the exported GLB and complete camera track
npm run build           # Production build
npm run preview         # Preview production build, http://127.0.0.1:4173/
npm run test:smoke      # Desktop browser interaction test (Chrome required)
npm run test:mobile     # Mobile / reduced-motion / skip test (Chrome required)
```

## Controls

Click the scene or **Next chapter** to advance from opening → Paper A → Paper B → computer. **Skip intro** / **View all work** jumps straight to the screen while accelerating through the original safe camera path. Use **Back** to reverse or **Revisit the scene** after arriving at the screen. `prefers-reduced-motion` and mobile-size renderers use simpler effects by default.

## Customizing content

Change the name, introduction, paper designs, projects, and links in `src/config/portfolio.ts`. **The shipped achievements and texts are editorial DEMO placeholders, not real claims.** The two paper surfaces are rendered with canvas-based ink textures, lit and curved as part of their 3D geometry. Avoid embedding private contact details in this public config. For more projects later, keep the featured paper chapters short and add more data to the final HTML portfolio.

## How it works

- Blender source stays unchanged. `tools/export_scene.py` extracts the camera's world-space position, rotation and focal length for all 360 frames, transforms them to glTF's Y-up coordinates, and exports a web-compatible GLB with the scene's mesh materials and packed image resources.
- Camera movement plays in controlled segments, retaining the Blender camera's original easing. The code also supports accelerated skipping.
- Ambient paper motion is subtle and deterministic: GPU shaders animate disconnected sheet islands of the canopy, cascade and paper tiers independently; separately modelled airborne sheets and hero papers float gently. Ground debris intentionally stays on the floor.
- WebGL and cinematic grading are used for the immersive part; the screen transition ultimately becomes accessible, selectable HTML.

## Quality notes

Cycles shaders and volumetric effects are not portable to WebGL. The export excludes the two Cycles-only volume bounding boxes and replaces their visual purpose with cheap WebGL fog. The web version approximates the reference through cool rim lighting, warm monitor emission, scene fog, tuned tone-mapping, bloom, vignette, and conservative paper materials. Compare screenshots of the same camera frames to your Cycles references and tune the look further. Performance and appearance vary by device.
