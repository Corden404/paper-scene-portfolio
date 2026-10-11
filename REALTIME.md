# Paper Scene — realtime 3D

The default website renders the full V4 scene in WebGL2: the opening, six curved printed sheets, and the computer. Camera motion follows the authored Blender route. The paper geometry, light scattering, ground reflection and perspective are rendered in the browser; the journey uses no video frames.

Surface and volume lighting are sampled from the source Cycles scene. The two reading lights retain their authored energy curves. This keeps the approved appearance within a realtime budget. Volumetric shadows and reflections are approximations, and depth of field differs from the original Cycles render.

## Preview and controls

Run `npm ci`, then `npm run dev`. Open the URL printed by Vite.

- **Begin journey / Next chapter / Back** travel through all eight stops.
- Chapter markers select a stop; **Skip intro** or **End** jumps to the computer.
- Arrow keys, Space and Enter advance; **Home** returns to the opening.
- **CINEMA** uses a blurred ground reflection, 40 volume steps and up to 1.25 device pixel ratio, targeting 60 fps.
- **LITE** uses 20 volume steps, a simpler floor and up to 1 device pixel ratio, targeting 30 fps. Narrow screens start in LITE.
- Reduced motion switches directly between stops. Rendering pauses in hidden tabs and while viewing the HTML collection.
- **View collection** retains the accessible project catalogue; **The scene** returns to the final featured sheet.

Use `?chapter=paper-c` to open any chapter directly. Add `&view=scene` to hide the interface. The original rendered version remains at `?render=video`; it also provides a fallback for devices without WebGL2.

## Paper and screen content

The six papers retain their original V4 printed artwork. To replace a paper's ink without changing geometry, set `editablePrint: true` on that project in `src/config/portfolio.ts`, then edit its title, subtitle, category, year and keywords. The browser draws the existing print layout onto a texture, with the same baked illumination.

The physical monitor uses `portfolio.monitorImage`. It currently displays a local capture of [Corden404's GitHub profile](https://github.com/Corden404). The capture is a texture, so it works without contacting GitHub while the scene loads. Clicking the monitor or **Open GitHub** opens the live profile. Changes on GitHub are visible through that link; refreshing the physical display requires replacing the local capture.

Changing printed text or a screen image does not require remodeling or rerendering a camera journey. Changing sheet shape, position or the room's main light rig requires reexporting the relevant geometry and lighting.

## Rebuild the delivery assets

The exporter and baking tools read `V4 — Reference Match/paper_portfolio_reference_match_v4.blend` without saving it. Blender with Cycles CUDA is required to rebuild lighting; visitors need only a WebGL2 browser.

```powershell
& 'G:\Blender\blender.exe' --background 'V4 — Reference Match\paper_portfolio_reference_match_v4.blend' --python-exit-code 1 --python tools/export_realtime_preview.py -- --geometry-only
& 'G:\Blender\blender.exe' --background 'V4 — Reference Match\paper_portfolio_reference_match_v4.blend' --python-exit-code 1 --python tools/bake_realtime_lighting.py -- --samples 64
& 'G:\Blender\blender.exe' --background 'V4 — Reference Match\paper_portfolio_reference_match_v4.blend' --python-exit-code 1 --python tools/bake_realtime_heroes.py -- --samples 128
& 'G:\Blender\blender.exe' --background 'V4 — Reference Match\paper_portfolio_reference_match_v4.blend' --python-exit-code 1 --python tools/bake_realtime_volume.py -- --samples 48
npm run verify:realtime
npm run test:config
npm run build
```

Scene assets live in `public/assets/realtime`. Screen captures used by the display are delivery assets; local comparison images, benchmarks and scratch scripts remain in ignored `.work/` folders.
