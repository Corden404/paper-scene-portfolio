import { Canvas } from '@react-three/fiber';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, Eye, EyeOff, Monitor, MousePointer2, Volume2 } from 'lucide-react';
import { Component, Suspense, useCallback, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import PaperWorld from './components/PaperWorld';
import FinalPortfolio from './components/FinalPortfolio';
import { featuredProjects, portfolio, stages } from './config/portfolio';
import type { Stage } from './config/portfolio';

type BoundaryProps = { children: ReactNode; onError: (message: string) => void };
class SceneErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, _info: ErrorInfo) { this.props.onError(error.message); }
  render() { return this.state.failed ? null : this.props.children; }
}

const openingChapter = {
  index: '00', eyebrow: 'A DIFFERENT KIND OF PORTFOLIO',
  heading: "IDEAS DON'T\nSTAY ON PAPER.",
  description: 'A quiet space for the things that make us curious. Follow the pages to see what comes next.',
};
const lastFeaturedPaper = featuredProjects[featuredProjects.length - 1].id;

function useMotionPreferences() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const narrow = window.matchMedia('(max-width: 720px)');
    const update = () => { setReducedMotion(reduced.matches); setMobile(narrow.matches); };
    update();
    reduced.addEventListener('change', update);
    narrow.addEventListener('change', update);
    return () => { reduced.removeEventListener('change', update); narrow.removeEventListener('change', update); };
  }, []);
  return { reducedMotion, mobile };
}

export default function App() {
  const { reducedMotion, mobile } = useMotionPreferences();
  const [stage, setStage] = useState<Stage>('intro');
  const [quality, setQuality] = useState<'cinema' | 'balanced'>('cinema');
  const [qualityOverridden, setQualityOverridden] = useState(false);
  const [ready, setReady] = useState(false);
  const [moving, setMoving] = useState(false);
  const [webEntered, setWebEntered] = useState(false);
  const [loadError, setLoadError] = useState('');
  const currentIndex = stages.indexOf(stage);

  useEffect(() => {
    if (!qualityOverridden && (mobile || reducedMotion)) setQuality('balanced');
  }, [mobile, reducedMotion, qualityOverridden]);

  const onReady = useCallback(() => setReady(true), []);
  const onAssetError = useCallback((message: string) => setLoadError(message), []);
  const onArrive = useCallback((_next: Stage) => {
    setMoving(false);
  }, []);

  // Let visitors actually see the physical monitor before the HTML portfolio
  // takes over the frame. The final page then becomes fully accessible DOM.
  useEffect(() => {
    if (stage !== 'screen' || moving || !ready || webEntered) return;
    const timer = window.setTimeout(() => setWebEntered(true), reducedMotion ? 180 : 1450);
    return () => window.clearTimeout(timer);
  }, [stage, moving, ready, webEntered, reducedMotion]);

  const goTo = useCallback((next: Stage) => {
    // Jumping to the computer is always allowed, even during a camera move.
    // The current GSAP segment is cancelled and the existing path is sped up.
    if (!ready || loadError || (moving && next !== 'screen')) return;
    if (next === stage) return;
    setWebEntered(false);
    setStage(next);
    setMoving(true);
  }, [ready, loadError, moving, stage]);

  const next = useCallback(() => {
    const index = stages.indexOf(stage);
    if (index < stages.length - 1) goTo(stages[index + 1]);
  }, [goTo, stage]);

  const back = useCallback(() => {
    const index = stages.indexOf(stage);
    if (index > 0) goTo(stages[index - 1]);
  }, [goTo, stage]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if (event.key === 'ArrowRight' || event.key === ' ' || event.key === 'Enter') {
        if (webEntered) return;
        if (['INPUT', 'TEXTAREA', 'BUTTON', 'A'].includes((event.target as HTMLElement).tagName)) return;
        event.preventDefault();
        next();
      }
      if (event.key === 'ArrowLeft' && !webEntered) { event.preventDefault(); back(); }
      if (event.key === 'End' && !webEntered) { event.preventDefault(); goTo('screen'); }
      if (event.key === 'Escape' && webEntered) goTo(lastFeaturedPaper);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, back, webEntered, goTo]);

  const chapterProject = portfolio.projects.find((project) => project.id === stage);
  const chapter = chapterProject ? {
    index: chapterProject.number,
    eyebrow: `${chapterProject.tag} / SELECTED WORK`,
    heading: chapterProject.heroHeading,
    description: chapterProject.summary,
  } : openingChapter;
  const isIntro = stage === 'intro';

  return (
    <div className={'experience' + (webEntered ? ' experience--web' : '')}>
      <div className="scene-canvas" aria-hidden="true">
        <SceneErrorBoundary onError={onAssetError}>
          <Canvas
            dpr={quality === 'cinema' ? [1, 1.65] : [1, 1.1]}
            frameloop={webEntered ? 'demand' : 'always'}
            gl={{ alpha: false, antialias: quality === 'balanced', powerPreference: 'high-performance' }}
            camera={{ position: [0, 1, 10], fov: 50, near: 0.025, far: 180 }}
            onCreated={({ gl }) => {
              gl.outputColorSpace = SRGBColorSpace;
              gl.toneMapping = ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.08;
            }}
          >
            <Suspense fallback={null}>
              <PaperWorld
                stage={stage}
                quality={quality}
                reducedMotion={reducedMotion}
                onReady={onReady}
                onArrive={onArrive}
                onAssetError={onAssetError}
              />
            </Suspense>
          </Canvas>
        </SceneErrorBoundary>
      </div>

      <div className="cinema-grain" aria-hidden="true" />
      <div className="cinema-edges" aria-hidden="true" />

      {!webEntered && <button className="scene-click-layer" type="button" tabIndex={-1} aria-label="Continue to next chapter" onClick={next} disabled={!ready || moving || stage === 'screen'} />}

      <header className={'site-header' + (webEntered ? ' site-header--hidden' : '')}>
        <div className="brand">
          <span className="brand-icon">{portfolio.monogram}</span>
          <span className="brand-label">{portfolio.name}<small>PORTFOLIO / 2026</small></span>
        </div>
        <div className="header-subtitle">{portfolio.discipline}</div>
        <div className="header-actions">
          <button
            type="button" className="quality-toggle"
            onClick={() => { setQuality(quality === 'cinema' ? 'balanced' : 'cinema'); setQualityOverridden(true); }}
            title={quality === 'cinema' ? 'Switch to performance mode' : 'Switch to cinematic quality'}
            aria-label="Toggle rendering quality"
          >
            {quality === 'cinema' ? <Eye size={17} /> : <EyeOff size={17} />}
            <span>{quality === 'cinema' ? 'CINEMA' : 'LITE'}</span>
          </button>
          <span className="header-divider" />
          <button type="button" className="text-link" onClick={() => goTo('screen')} disabled={!ready || stage === 'screen'}>
            SKIP INTRO <ArrowUpRight size={15} />
          </button>
        </div>
      </header>

      {!webEntered && !loadError && (
        <>
          <div className={'scene-copy scene-copy--' + stage + (chapterProject ? ' scene-copy--featured-paper' : '') + (moving ? ' scene-copy--moving' : '')}>
            <div className="intro-rule"><span /> <p>{chapter.eyebrow}</p></div>
            <p className="scene-copy__index">{chapter.index} / {String(stages.length - 1).padStart(2, '0')}</p>
            <h1>{chapter.heading.split('\n').map((line) => <span key={line}>{line}</span>)}</h1>
            <p className="scene-copy__desc">{chapter.description}</p>
            {isIntro && <p className="intro-hint"><MousePointer2 size={14} /> CLICK ANYWHERE TO EXPLORE</p>}
          </div>

          <div className="stage-caption">
            <span className="caption-line" />
            <span>{stage === 'intro' ? 'THE OPENING' : stage === 'screen' ? 'THE FINAL FRAME' : `IN FOCUS / ${chapter.index.padStart(3, '0')}`}</span>
          </div>

          <footer className="scene-footer">
            <div className="footer-chapters" aria-label="Chapter progress">
              {stages.map((entry, index) => (
                <button
                  type="button" key={entry} className={'chapter-marker' + (index === currentIndex ? ' chapter-marker--active' : '')}
                  onClick={() => goTo(entry)} disabled={!ready || moving}
                  aria-label={'Go to ' + (entry === 'intro' ? 'opening' : entry === 'screen' ? 'computer' : entry)}
                  aria-current={index === currentIndex ? 'step' : undefined}
                >
                  <span className="chapter-marker__index">0{index}</span>
                  <span className="chapter-marker__bar" />
                  <span className="chapter-marker__name">{entry === 'intro' ? 'THE SPACE' : entry === 'screen' ? 'THE SCREEN' : `PAPER ${String(index).padStart(2, '0')}`}</span>
                </button>
              ))}
            </div>
            <div className="footer-actions">
              {currentIndex > 0 && !webEntered && (
                <button className="back-button" type="button" onClick={back} disabled={!ready || moving}><ArrowLeft size={17} /> BACK</button>
              )}
              <button className="next-button" type="button" onClick={stage === 'screen' ? () => setWebEntered(true) : next} disabled={!ready || moving}>
                {stage === 'screen' ? 'ENTER PORTFOLIO' : isIntro ? 'BEGIN JOURNEY' : stage === lastFeaturedPaper ? 'THE FULL STORY' : 'NEXT CHAPTER'}
                {stage === 'screen' ? <Monitor size={17} /> : <ArrowRight size={18} />}
              </button>
            </div>
          </footer>

          {stage === 'intro' && <div className="vertical-scroll-hint"><span>SCROLL INTO THE STORY</span><ArrowDown size={16}/></div>}
          <div className="sound-detail" aria-hidden="true"><Volume2 size={15} /><span>A VISUAL EXPERIENCE — SOUND OFF</span></div>
        </>
      )}

      {!ready && !loadError && (
        <div className="loading-screen" role="status" aria-live="polite">
          <div className="loading-logo">{portfolio.monogram}</div>
          <p>PREPARING THE SCENE</p>
          <div className="loading-progress"><i /></div>
          <span>THE WORLD BETWEEN THE PAGES</span>
        </div>
      )}

      {loadError && (
        <div className="error-screen" role="alert">
          <p className="web-eyebrow">SCENE INITIALIZATION</p>
          <h2>One moment.<br /><em>The scene needs its assets.</em></h2>
          <p>{loadError}</p>
          <code>blender --background --python tools/export_scene.py</code>
          <p className="error-small">The original Blender source is preserved. Refresh after exporting.</p>
        </div>
      )}

      {webEntered && <div className="portfolio-transition"><FinalPortfolio onRevisit={() => goTo(lastFeaturedPaper)} /></div>}
      <div className="preload-tag" aria-hidden="true"><ChevronRight size={1} /></div>
    </div>
  );
}
