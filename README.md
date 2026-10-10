# Paper Scene — cinematic interactive portfolio

An immersive six-paper portfolio powered by the new Blender v3 scene. The camera travels through six featured paper sheets and ends at an interactive desktop portfolio. Project content lives in `src/config/portfolio.ts`, not in the Blender file.

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

The export script reads `new model/Paper Portfolio — Final Project — 2026-10-10/paper_portfolio_six_papers_v3.blend` and writes to `public/assets`. The old Blender source is preserved in `Paper Portfolio/`. If Blender is not on your PATH, use its full executable path. The script **never saves the source .blend**. Importantly, it leaves out the two Cycles-only fog volumes which otherwise become opaque blocking meshes in WebGL.

```bash
npm run verify:scene    # Validate the exported GLB and complete camera track
npm run build           # Production build
npm run preview         # Preview production build, http://127.0.0.1:4173/
npm run test:smoke      # Desktop browser interaction test (Chrome required)
npm run test:mobile     # Mobile / reduced-motion / skip test (Chrome required)
npm run test:lighting   # Verify the compiled paper-translucency and GPU sway shaders
```

镜头的八个真实停留段（开场、六张作品纸、电脑）保存于 `public/assets/camera-path.json`。改为只显示前四张纸时仍保留电脑网页中的所有六项成果。浏览器性能依赖硬件和网络，当前未保证任何设备均为 60 FPS。

## Controls

Click the scene or **Next chapter** to advance from opening → Paper A → B → C → D → E → F → computer. **Skip intro** / **View all work** jumps straight to the screen while accelerating through the original safe camera path. Use **Back** to reverse or **Revisit the scene** after arriving at the screen. `prefers-reduced-motion` and mobile-size renderers use simpler effects by default.

## Customizing content

Change the name, introduction, paper designs, projects, and links in `src/config/portfolio.ts`. **The shipped achievements and texts are editorial DEMO placeholders, not real claims.** The six independent paper surfaces are rendered with editable Canvas textures, lit and curved as part of their 3D geometry. Set `portfolio.featuredPaperCount` from 1–6 (e.g. 4) to skip any later chapters and go directly to the computer. There is still only ONE camera route. Avoid embedding private contact details in this public config. For more projects later, keep the featured paper chapters short and add more data to the final HTML portfolio.

## How it works

- Blender source stays unchanged. `tools/export_scene.py` extracts the camera's world-space position, rotation and focal length for all 672 frames, transforms them to glTF's Y-up coordinates, and exports a web-compatible GLB with the scene's mesh materials and packed image resources.
- Camera movement plays in controlled segments, retaining the Blender camera's original easing. The code also supports accelerated skipping.
- Ambient paper motion is subtle and deterministic: GPU shaders animate disconnected sheet islands of the canopy, cascade and paper tiers independently; separately modelled airborne sheets and hero papers float gently. Ground debris intentionally stays on the floor.
- WebGL and cinematic grading are used for the immersive part; the screen transition ultimately becomes accessible, selectable HTML.

## Quality notes

Cycles shaders and true volumetric scattering do not carry over to WebGL. The exporter omits the two Cycles-only volume containers because glTF would turn them into opaque blocking meshes. The current cinematic rig recreates the visual hierarchy with two depth-tested HDR cool light sources, a darker ambient/fill balance, warm monitor emission, fog, Bloom and vignette. Paper background meshes use a small custom PBR fragment modification for view-dependent **thin-sheet backlighting**; printed ink attenuates transmission instead of glowing like a screen. On the current Three.js, this shader patches `opaque_fragment`, not the removed `output_fragment` hook. The glTF custom `_SHEET_PHASE` attribute is exposed to Three.js as lowercase `_sheet_phase`; the code and the browser test verify this mapping so the canopy's GPU motion actually runs. In CINEMA mode, `src/components/CinematicAtmosphere.tsx` adds four depth-tested, slowly varying volume-light curtains with foreground-to-background occlusion. These are cheaper and visually cleaner than a fullscreen ray-blur, which was intentionally removed after it caused duplicate paper silhouettes. LITE mode keeps only the far atmospheric layer and omits full-screen postprocessing.

**Important:** these are artistic real-time approximations, not a pixel-identical reconstruction of the original Cycles volume path-tracing. For closer parity, the next stage would involve Cycles-matched reference frames, static lightmap baking, and/or actual low-resolution volumetric sampling on sufficiently powerful hardware. The current browser tests exercise functionality under software WebGL; they do not establish real-device FPS.
