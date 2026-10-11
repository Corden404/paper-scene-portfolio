/** Finite scene attempts; the deadline includes decoding and first presentation. */
export function startBoundedLoad<T>(operation: (signal: AbortSignal) => Promise<T>, deadlineMs: number) {
  const controller = new AbortController();
  let cancelReject: (reason: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { cancelReject = reject; });
  const stop = (message: string) => { controller.abort(); cancelReject(new Error(message)); };
  const timer = setTimeout(() => stop('The 3D scene timed out. Please retry or view the collection.'), deadlineMs);
  const work = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw new Error('Scene loading cancelled.');
    return operation(controller.signal);
  });
  const promise = Promise.race([work, cancelled])
    .catch(error => { controller.abort(); throw error; })
    .finally(() => clearTimeout(timer));
  return { promise, signal: controller.signal, cancel: () => stop('Scene loading cancelled.') };
}

/** Only fulfilled resources survive attempts; a failed or aborted request is retriable. */
export function createResourceCache() {
  const completed = new Map<string, unknown>();
  let epoch = 0;
  return {
    invalidate() { epoch++; completed.clear(); },
    async load<T>(key: string, operation: () => Promise<T>): Promise<T> {
      if (completed.has(key)) return completed.get(key) as T;
      const owner = epoch;
      const value = await operation();
      if (owner === epoch) completed.set(key, value);
      return value;
    },
  };
}

export type NavigationRequest<C extends string> = { chapter: C; instant: boolean; id: number };
export function requestNavigation<C extends string>(previous: NavigationRequest<C>, chapter: C, instant: boolean): NavigationRequest<C> {
  return { chapter, instant, id: previous.id + 1 };
}
export function applyNavigation<C extends string>(request: NavigationRequest<C>, frame: number, stops: Record<C, number>, reducedMotion: boolean) {
  const target = stops[request.chapter];
  if (request.instant || reducedMotion || Math.abs(target - frame) < .01) return { frame: target, flight: null };
  return { frame, flight: { from: frame, to: target, elapsed: 0, duration: Math.min(8, Math.abs(target - frame) / 28) } };
}
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
/** Fit the native projection, with bounded off-axis clearance on short wide canvases.
 * Shared hero limits were measured against all actual curved GLB surface vertices.
 * Blending follows the authored frame route, so chapter requests never switch FOV abruptly.
 */
export function cameraProjection(width: number, height: number, lens: number, sensorWidth: number, frame: number,
  stops: { intro: number; 'paper-a': number; 'paper-f': number; screen: number }) {
  const aspect = width / height, native = aspect >= 1 ? 16 / 9 : 816 / 1456;
  const projectionAspect = Math.min(aspect, native);
  const fov = 2 * Math.atan(sensorWidth / (2 * lens * projectionAspect)) * 180 / Math.PI;
  const strength = aspect >= 1 ? smooth((aspect - native) / .35) * smooth((600 - height) / 150) : 0;
  const entering = smooth((frame - stops.intro) / (stops['paper-a'] - stops.intro));
  const monitor = smooth((frame - stops['paper-f']) / (stops.screen - stops['paper-f']));
  const scale = .66 + (.9135 - .66) * monitor;
  const upward = 8.5 + (21.15 - 8.5) * monitor;
  return { fov, zoom: 1 + (scale - 1) * strength * entering, offsetY: upward * strength * entering };
}
