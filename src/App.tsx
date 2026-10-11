import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, ChevronRight, Eye, EyeOff, Monitor, MousePointer2, Volume2 } from 'lucide-react';
import { Component, useCallback, useEffect, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import RenderedPaperWorld from './components/RenderedPaperWorld';
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
const screenChapter = {
  index: '07', eyebrow: 'THE FULL COLLECTION',
  heading: 'THE WORK\nCOMES INTO VIEW.',
  description: 'Explore the complete collection on the screen.',
};
const lastFeaturedPaper = featuredProjects[featuredProjects.length - 1].id;
const sceneOnly = new URLSearchParams(window.location.search).get('view') === 'scene';
const requestedChapter = new URLSearchParams(window.location.search).get('chapter') as Stage;

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
  const [stage, setStage] = useState<Stage>(stages.includes(requestedChapter) ? requestedChapter : 'intro');
  const [quality, setQuality] = useState<'cinema' | 'balanced'>('cinema');
  const [qualityOverridden, setQualityOverridden] = useState(false);
  const [ready, setReady] = useState(false);
  const [moving, setMoving] = useState(false);
  const [jump, setJump] = useState(false);
  const [webEntered, setWebEntered] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sceneFailed, setSceneFailed] = useState(false);
  const currentIndex = stages.indexOf(stage);

  useEffect(() => {
    if (!qualityOverridden && (mobile || reducedMotion)) setQuality('balanced');
  }, [mobile, reducedMotion, qualityOverridden]);

  const onReady = useCallback(() => setReady(true), []);
  const onAssetError = useCallback((message: string) => {
    setLoadError(message); setSceneFailed(true); setMoving(false);
  }, []);
  const onArrive = useCallback((_next: Stage) => {
    setMoving(false);
  }, []);

  // Let visitors actually see the physical monitor before the HTML portfolio
  // takes over the frame. The final page then becomes fully accessible DOM.
  useEffect(() => {
    if (sceneOnly || stage !== 'screen' || moving || !ready || webEntered) return;
    const timer = window.setTimeout(() => setWebEntered(true), reducedMotion ? 180 : 1450);
    return () => window.clearTimeout(timer);
  }, [stage, moving, ready, webEntered, reducedMotion]);

  const goTo = useCallback((next: Stage, skipFlight = false) => {
    if (!ready || loadError || (moving && next !== 'screen')) return;
    if (sceneFailed) { window.location.reload(); return; }
    if (next === stage) return;
    setWebEntered(false);
    setJump(skipFlight);
    setStage(next);
    setMoving(true);
  }, [ready, loadError, moving, stage, sceneFailed]);

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
      if (event.key === 'End' && !webEntered) { event.preventDefault(); goTo('screen', true); }
      if (event.key === 'Escape' && webEntered) goTo(lastFeaturedPaper, true);
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
  } : stage === 'screen' ? screenChapter : openingChapter;
  const isIntro = stage === 'intro';

  return (
    <div className={'experience experience--rendered' + (sceneOnly ? ' experience--scene-only' : '') + (webEntered ? ' experience--web' : '')}>
      <div className="scene-canvas" aria-hidden="true">
        <SceneErrorBoundary onError={onAssetError}>
          <RenderedPaperWorld
            stage={stage}
            quality={quality}
            reducedMotion={reducedMotion}
            jump={jump}
            onReady={onReady}
            onArrive={onArrive}
            onAssetError={onAssetError}
          />
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
            title={quality === 'cinema' ? 'Switch to lightweight scenes' : 'Switch to cinematic quality'}
            aria-label="Toggle image quality"
          >
            {quality === 'cinema' ? <Eye size={17} /> : <EyeOff size={17} />}
            <span>{quality === 'cinema' ? 'CINEMA' : 'LITE'}</span>
          </button>
          <span className="header-divider" />
          <button type="button" className="text-link" onClick={() => goTo('screen', true)} disabled={!ready || stage === 'screen'}>
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
          <p className="web-eyebrow">THE WORLD BETWEEN THE PAGES</p>
          <h2>One moment.<br /><em>The scene is taking a little longer.</em></h2>
          <p>{loadError}</p>
          <button className="next-button" onClick={() => window.location.reload()}>TRY AGAIN</button>
          <button className="text-link" onClick={() => { setLoadError(''); setReady(true); setWebEntered(true); }}>VIEW THE PORTFOLIO <ArrowUpRight size={15} /></button>
        </div>
      )}

      {webEntered && <div className="portfolio-transition"><FinalPortfolio onRevisit={() => goTo(lastFeaturedPaper, true)} /></div>}
      <div className="preload-tag" aria-hidden="true"><ChevronRight size={1} /></div>
    </div>
  );
}
