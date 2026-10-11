import { useContext, useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposerContext } from '@react-three/postprocessing';
import { EffectPass, Pass } from 'postprocessing';
import type { WebGLRenderer, WebGLRenderTarget } from 'three';

export type RenderSchedule = {
  moving: boolean;
  warmFrames: number;
  renderCached: (() => boolean) | null;
  cachedFrames: number;
  presentedFrames: number;
  lastPresentation: number;
  fpsStart: number;
  fpsFrames: number;
  fps: number;
};

export function createRenderSchedule(): RenderSchedule {
  const now = performance.now();
  return { moving: false, warmFrames: 3, renderCached: null,
    cachedFrames: 0, presentedFrames: 0, lastPresentation: now,
    fpsStart: now, fpsFrames: 0, fps: 0 };
}

function presentationDelta(schedule: RenderSchedule) {
  const now = performance.now();
  const delta = (now - schedule.lastPresentation) / 1000;
  schedule.lastPresentation = now;
  schedule.presentedFrames++;
  schedule.fpsFrames++;
  if (now - schedule.fpsStart >= 600) {
    schedule.fps = Math.round(schedule.fpsFrames * 1000 / (now - schedule.fpsStart));
    schedule.fpsFrames = 0;
    schedule.fpsStart = now;
  }
  return delta;
}

// Keep the composer's existing HDR buffer after SMAA. No extra texture,
// resampling or change to the effects is needed to reuse a stationary view.
class SceneCachePass extends Pass {
  input: WebGLRenderTarget | null = null;
  constructor() { super('StationarySceneCache'); this.needsSwap = false; }
  render(_renderer: WebGLRenderer, input: WebGLRenderTarget | null) { this.input = input; }
  setSize() { this.input = null; }
}

export function StaticSceneCache({ schedule }: { schedule: RenderSchedule }) {
  const { composer } = useContext(EffectComposerContext);
  const { gl, invalidate } = useThree();
  const cache = useMemo(() => new SceneCachePass(), []);

  useEffect(() => {
    schedule.warmFrames = 3;
    invalidate();
    schedule.renderCached = () => {
      const output = composer.passes[composer.passes.length - 1];
      // The cache must immediately precede the final screen effect.
      if (!cache.input || !(output instanceof EffectPass) || !output.renderToScreen ||
          composer.passes.indexOf(cache) !== composer.passes.length - 2) return false;
      const autoClear = gl.autoClear;
      gl.autoClear = true;
      gl.info.reset();
      try { output.render(gl, cache.input, composer.outputBuffer, presentationDelta(schedule), false); }
      finally { gl.autoClear = autoClear; }
      schedule.cachedFrames++;
      if (window.__PAPER_3D) Object.assign(window.__PAPER_3D, {
        cachedFrames: schedule.cachedFrames, presentedFrames: schedule.presentedFrames,
        fps: schedule.fps,
        triangles: gl.info.render.triangles, drawCalls: gl.info.render.calls,
      });
      return true;
    };
    return () => { schedule.renderCached = null; cache.input = null; };
  }, [cache, composer, gl, invalidate, schedule]);

  useFrame(() => {
    const autoClear = gl.autoClear;
    gl.autoClear = true;
    try { composer.render(presentationDelta(schedule)); }
    finally { gl.autoClear = autoClear; }
    schedule.warmFrames = Math.max(0, schedule.warmFrames - 1);
    if (window.__PAPER_3D) Object.assign(window.__PAPER_3D, {
      cachedFrames: schedule.cachedFrames, presentedFrames: schedule.presentedFrames,
      fps: schedule.fps,
      triangles: gl.info.render.triangles, drawCalls: gl.info.render.calls,
    });
  }, 1);

  return <primitive object={cache} dispose={null} />;
}

export function FrameSchedule({ active, quality, schedule }: {
  active: boolean; quality: 'cinema' | 'balanced'; schedule: RenderSchedule;
}) {
  const { invalidate, gl, size } = useThree();
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let last = performance.now();
    const interval = 1000 / (quality === 'cinema' ? 60 : 30);
    const wake = () => { schedule.warmFrames = 3; };
    const tick = (now: number) => {
      if (document.visibilityState === 'visible' && now - last >= interval) {
        last = now - (now - last) % interval;
        if (schedule.moving || schedule.warmFrames > 0 || !schedule.renderCached?.()) invalidate();
      }
      frame = requestAnimationFrame(tick);
    };
    wake();
    invalidate();
    gl.domElement.addEventListener('pointermove', wake);
    gl.domElement.addEventListener('pointerleave', wake);
    document.addEventListener('visibilitychange', wake);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      gl.domElement.removeEventListener('pointermove', wake);
      gl.domElement.removeEventListener('pointerleave', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [active, gl, invalidate, quality, schedule, size]);
  return null;
}
