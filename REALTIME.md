# Paper Scene — realtime 3D

The default website renders the full V4 scene in WebGL2: the opening, six curved printed sheets, and the computer. Camera motion follows the authored Blender route. The paper geometry, light scattering, ground reflection and perspective are rendered in the browser; the journey uses no video frames.

Surface and volume lighting are sampled from the source Cycles scene. The two reading lights retain their authored energy curves. This keeps the approved appearance within a realtime budget. Volumetric shadows and reflections are approximations, and depth of field differs from the original Cycles render.

## Preview and controls

Run `npm ci`, then `npm run dev`. Open the URL printed by Vite.

- **Begin journey / Next chapter / Back** travel through all eight stops.
- Chapter markers jump directly to a stop and can interrupt an ongoing flight. **Skip intro** or **End** jumps to the computer.
- Arrow keys, Space and Enter advance; **Home** returns to the opening.
- **CINEMA** uses a blurred ground reflection, 40 volume steps and up to 1.25 device pixel ratio, targeting 60 fps.
- **LITE** uses 20 volume steps and up to 1 device pixel ratio, targeting 30 fps. Narrow screens start in LITE. Both quality modes share the dark floor and a soft, narrow warm reflection from the monitor; CINEMA also retains the blurred scene reflection.
- Reduced motion switches directly between stops. Rendering pauses in hidden tabs and while viewing the HTML collection.
- Stationary views reuse the existing full-resolution HDR frame after anti-aliasing. Film grain keeps animating; pointer movement, camera travel, quality changes and resizing refresh the complete scene, including reflections and volume lighting. This saves idle GPU work without reducing geometry, texture, lighting or reflection quality.
- **Collection / View collection** opens the accessible project catalogue, including while the scene is still loading or after a load failure. **The scene** returns to the final featured sheet, loading the scene if needed.

Use `?chapter=paper-c` to open any chapter directly. Add `&view=scene` to hide the scene interface. Open `?view=collection` for the HTML catalogue without starting the 3D asset downloads. The original rendered version remains at `?render=video`; it also provides a fallback for devices without WebGL2.

Loading reports how many of the eight core data resources are ready, then identifies the decoding and first-frame stage. Each attempt has a 25-second deadline. A failed attempt offers **Retry 3D**, **View collection**, and **Open original**. Retry refreshes failed or inconsistent resource caches; ordinary visits between the ready scene and the collection reuse the loaded scene.

## Responsive framing

Paper stops show their project title alongside the scene. Narrow portrait screens place it below the paper; short landscape screens use compact controls and extra framing clearance. The native authored aspect ratios keep their original projection, while intermediate viewports adjust the projection to contain the subject. The camera positions, orientation and travel route remain authored in Blender.

The regression suite projects the delivered paper geometry into representative portrait, short landscape, tablet and desktop viewports, and also checks loading cancellation, retry cache invalidation and instant navigation:

```powershell
node tools/realtime_journey_test.mjs
```

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

Source shadowing is included in the baked surface and volume fields. The browser omits an unused realtime shadow map and its depth materials. Paper detail selection uses squared distances to avoid temporary arrays and square roots, with the same detail level for every sheet.
