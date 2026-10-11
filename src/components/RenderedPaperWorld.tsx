import { useEffect, useRef, useState } from 'react';
import { stages } from '../config/portfolio';
import type { Stage } from '../config/portfolio';

type ImageSet = { cinema: string; lite: string; width: number; height: number };
type Frame = { frame: number; landscape: ImageSet; portrait: ImageSet };
type Flight = { landscape: { url: string }; portrait: { url: string } };
type Manifest = { version: string; frames: Record<Stage, Frame>; motion?: { flights: Record<string, Flight> } };
type Props = {
  stage: Stage;
  quality: 'cinema' | 'balanced';
  reducedMotion: boolean;
  jump: boolean;
  onReady: () => void;
  onArrive: (stage: Stage) => void;
  onAssetError: (message: string) => void;
};

// Keep the current and next chapter decoded; other chapters stay in the browser
// HTTP cache without retaining all sixteen full-resolution images in memory.
const imageLoads = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string) {
  const existing = imageLoads.get(url);
  if (existing) return existing;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.decode().then(() => resolve(image), reject);
    image.onerror = () => reject(new Error('The scene image could not be loaded.'));
    image.src = url;
  });
  imageLoads.set(url, promise);
  promise.catch(() => imageLoads.delete(url));
  return promise;
}

function usePortrait() {
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);
  useEffect(() => {
    const update = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return portrait;
}

const route: Stage[] = ['intro', 'paper-a', 'paper-b', 'paper-c', 'paper-d', 'paper-e', 'paper-f', 'screen'];

export default function RenderedPaperWorld({ stage, quality, reducedMotion, jump, onReady, onArrive, onAssetError }: Props) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [current, setCurrent] = useState('');
  const [incoming, setIncoming] = useState('');
  const currentRef = useRef('');
  const settledStage = useRef<Stage | null>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const [activeFlight, setActiveFlight] = useState<number | null>(null);
  const readyOnce = useRef(false);
  const portrait = usePortrait();

  useEffect(() => {
    const controller = new AbortController();
    fetch('/assets/rendered/frames.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          throw new Error('The scene images could not be loaded. Please try again.');
        }
        const data = await response.json().catch(() => {
          throw new Error('The scene images could not be loaded. Please try again.');
        }) as Manifest;
        for (const key of stages) {
          if (!data.frames?.[key]?.portrait?.cinema || !data.frames[key].landscape?.cinema
            || !data.frames[key].portrait?.lite || !data.frames[key].landscape?.lite) {
            throw new Error('A scene chapter is missing.');
          }
        }
        setManifest(data);
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) onAssetError(error instanceof TypeError
          ? 'The scene images could not be loaded. Please try again.' : error.message);
      });
    return () => controller.abort();
  }, [onAssetError]);

  useEffect(() => {
    if (!manifest) return;
    let cancelled = false;
    let timer = 0;
    const cleanups: (() => void)[] = [];
    const orientation = portrait ? 'portrait' : 'landscape';
    const mode = quality === 'cinema' ? 'cinema' : 'lite';
    const url = manifest.frames[stage][orientation][mode];
    setIncoming('');
    setActiveFlight(null);

    loadImage(url).then(() => {
      if (cancelled) return;
      const complete = () => {
        if (cancelled) return;
        currentRef.current = url;
        settledStage.current = stage;
        setCurrent(url);
        setIncoming('');
        setActiveFlight(null);
        if (!readyOnce.current) { readyOnce.current = true; onReady(); }
        onArrive(stage);
        const next = stages[stages.indexOf(stage) + 1];
        const keep = new Set([url]);
        if (next) {
          const nextUrl = manifest.frames[next][orientation][mode];
          keep.add(nextUrl);
          void loadImage(nextUrl).catch(() => {});
        }
        for (const cached of imageLoads.keys()) if (!keep.has(cached)) imageLoads.delete(cached);
      };
      const previous = settledStage.current;
      if (!currentRef.current || currentRef.current === url || reducedMotion || jump) complete();
      else if (previous && previous !== stage && manifest.motion) {
        const from = route.indexOf(previous), to = route.indexOf(stage);
        const direction = Math.sign(to - from);
        const queue: string[] = [];
        for (let i = from; i !== to; i += direction) {
          const flight = manifest.motion.flights[route[i] + '--' + route[i + direction]];
          if (!flight?.[orientation]?.url) break;
          queue.push(flight[orientation].url);
        }
        if (queue.length !== Math.abs(to - from)) {
          setIncoming(url); timer = window.setTimeout(complete, 900);
          return;
        }
        const play = async () => {
          for (let index = 0; index < queue.length; index++) {
            if (cancelled) return;
            const slot = index % 2;
            const video = videos.current[slot];
            if (!video) throw new Error('Camera player unavailable');
            const buffered = video.getAttribute('src') === queue[index];
            if (!buffered) video.src = queue[index];
            video.playbackRate = Math.min(2.5, 1 + (queue.length - 1) * .35);
            await new Promise<void>((resolve, reject) => {
              const finish = () => { cleanup(); resolve(); };
              const fail = () => { cleanup(); video.pause(); reject(new Error('The camera flight could not be loaded.')); };
              const playing = () => {
                if (cancelled) return;
                setActiveFlight(slot);
                const nextVideo = videos.current[(slot + 1) % 2];
                if (nextVideo && queue[index + 1] && nextVideo.getAttribute('src') !== queue[index + 1]) {
                  nextVideo.src = queue[index + 1]; nextVideo.load();
                }
              };
              const deadline = window.setTimeout(fail, 15000);
              const cleanup = () => {
                window.clearTimeout(deadline);
                video.removeEventListener('ended', finish);
                video.removeEventListener('error', fail);
                video.removeEventListener('playing', playing);
              };
              cleanups.push(() => { cleanup(); resolve(); });
              video.addEventListener('ended', finish);
              video.addEventListener('error', fail);
              video.addEventListener('playing', playing);
              if (!buffered) video.load();
              void video.play().catch(fail);
            });
          }
          complete();
        };
        // A slow or unavailable optional video still leaves the chapters usable.
        void play().catch(() => { if (!cancelled) complete(); });
      } else { setIncoming(url); timer = window.setTimeout(complete, 900); }
    }).catch((error: Error) => { if (!cancelled) onAssetError(error.message); });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cleanups.forEach(cleanup => cleanup());
      for (const video of videos.current) {
        if (!video) continue;
        video.pause(); video.removeAttribute('src'); video.load();
      }
    };
  }, [stage, quality, portrait, reducedMotion, jump, manifest, onReady, onArrive, onAssetError]);

  return (
    <div className="rendered-world" data-stage={stage} data-orientation={portrait ? 'portrait' : 'landscape'}>
      {current && <img className="rendered-frame" src={current} alt="" draggable={false} />}
      {incoming && <img key={incoming} className="rendered-frame rendered-frame--incoming" src={incoming} alt="" draggable={false} />}
      {[0, 1].map(slot => <video key={slot} ref={element => { videos.current[slot] = element; }}
        className={'rendered-flight' + (activeFlight === slot ? ' rendered-flight--active' : '')}
        muted playsInline preload="none" aria-hidden="true" />)}
    </div>
  );
}
