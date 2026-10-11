> The default website now uses the complete realtime 3D journey. See [the realtime guide](REALTIME.md) for preview controls, editable paper/screen content and asset rebuilding. The sections below describe the original rendered version, available with `?render=video`.

# Paper Scene — V4 rendered portfolio

An immersive six-paper portfolio built from the V4 Blender scene. Cycles renders preserve the thin paper, transmitted light, volumetric haze and warm screen reflections. Real camera flights connect eight reading stops, ending at an interactive HTML portfolio.

## Local preview

```powershell
npm ci
npm run dev
```

Open the local URL printed by Vite, usually `http://127.0.0.1:5173/`. The website loads the included WebP assets; Blender and WebGL are not required to browse it.

The opening, six featured sheets and monitor each have a landscape and portrait render. CINEMA uses the full still image; LITE uses a smaller still download. Camera clips retain native 1920 × 1080 landscape or 816 × 1456 portrait resolution in both modes. Narrow screens and reduced-motion preferences default to LITE. Reduced motion switches directly between still images and does not play a flight.

## Controls

Click the scene or **Next chapter** to advance along the camera route. The chapter markers travel through the intervening route at a faster pace; **Back** follows the route in reverse. **Skip intro** stays available during a flight and jumps straight to the computer. Arrow keys navigate chapters, **End** skips to the computer, and **Escape** returns from the HTML portfolio to the final featured paper. Project cards open selectable HTML details.

`?view=scene` displays a scene without the interface. Add `&chapter=paper-a` (or any chapter ID) to inspect a specific render.

## Content

Edit `src/config/portfolio.ts` for the HTML catalogue, chapter captions and contact links. Set `featuredPaperCount` from 1 to 6 to change the active route while keeping all six projects in the HTML catalogue.

The shipped projects are demo content. The printed artwork and physical screen content are packed into the Blender source and baked into the delivered renders. Changing them requires updating those images in Blender and rendering again; editing the config alone updates the HTML and captions.

## Render the V4 scene

Source: `V4 — Reference Match/paper_portfolio_reference_match_v4.blend`. The figure is hidden in both the viewport and renders. Paper cut edges have separate normals from the curved faces; the six featured papers use approximately 0.11 mm of world-space thickness.

The render tool reads the source without saving it or changing global Blender preferences. It retains the six-paper route and uses a dedicated portrait composition for the reference opening. Raw PNGs and receipts stay in the ignored `.work/` folder. A CUDA GPU is used by default; append `--cpu` for CPU rendering.

```powershell
& 'G:\Blender\blender.exe' --background 'V4 — Reference Match\paper_portfolio_reference_match_v4.blend' --python tools/render_frames.py -- --output .work/strong-v4-frames --samples 64
python tools/package_frames.py --input .work/strong-v4-frames
& 'G:\Blender\blender.exe' --background 'V4 — Reference Match\paper_portfolio_reference_match_v4.blend' --python-exit-code 1 --python tools/render_motion.py -- --output .work/native-v4-flights --samples 32 --fps 24 --stills .work/strong-v4-frames
python tools/package_motion.py --input .work/native-v4-flights --ffmpeg 'path\to\ffmpeg.exe'
npm run verify:frames
```

Packaging requires Pillow and NumPy; motion encoding also requires FFmpeg with H.264 support. On machines without the Python packages, install them with `python -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple Pillow numpy`.

The packagers create 16 complete renders, 16 lightweight variants, 28 camera clips and `public/assets/rendered/frames.json`. Clips cover seven flights in both directions and orientations. The manifest contains the source SHA-256 and content-versioned asset URLs. Existing matching renders can resume after an interruption. Use a fresh output folder when the Blender source changes. Package stills first, then clips; both receipts must match the same source.

The opening uses a cool photographic finish, highlight diffusion and darker hall edges. Stronger physical volume scattering and compositor glow retain clear nearby paper and hazy depth. It reconstructs the reference composition and lighting; individual paper positions and printed diagrams remain an authored 3D reconstruction.

The existing 672-frame Blender camera animation supplies the flight geometry. The first flight smoothly releases the dedicated reference opening's framing correction, then joins the original route. Every video frame is rendered at its delivered resolution and 24 fps, with no optical-flow interpolation or upscaling. A deeper focus field keeps passing paper sharp and returns smoothly to each reading stop's depth of field. Diffusion affects highlights without blurring the entire image. Matching full-resolution endpoint renders are reused when `--stills` is supplied. The browser cancels flights on skip, buffers the next route segment and falls back to the still if a video cannot play.

CUDA is the default backend. On a compatible RTX system, `--device OPTIX` can accelerate rendering. Use a fresh raw-output folder after changing the renderer or its settings; completed matching frames resume after an interruption.

## Verification

```powershell
npm run build
npm run verify:frames  # Source hash, camera stops, 32 images and 28 clip hashes
npm run test:config   # Routes with 1, 4 and 6 featured papers
npm run preview
npm run test:smoke    # Desktop navigation, skip, catalogue and project details
npm run test:mobile   # Portrait assets, reduced motion, overflow and return navigation
npm run test:frames   # Image decoding, forward/reverse flights, quality and resize
```

Browser scripts use Chrome by default and target `http://127.0.0.1:4173/`. Set `CHROME_BIN` and `PORTFOLIO_URL` to override those values.

The earlier Three.js components and GLB exporter remain available in the repository for the legacy real-time scene. They are not loaded by the rendered V4 experience.
