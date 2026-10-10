import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUpRight, ExternalLink, X } from 'lucide-react';
import { portfolio } from '../config/portfolio';
import type { PortfolioProject } from '../config/portfolio';

function ProjectDetail({ project, onClose }: { project: PortfolioProject; onClose: () => void }) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="detail-backdrop" onClick={onClose} role="presentation">
      <section
        role="dialog" aria-modal="true" aria-labelledby="detail-title"
        className="detail-modal" onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-topline">
          <span>SELECTED PROJECT / {project.number}</span>
          <button autoFocus type="button" aria-label="Close project" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className={'detail-art detail-art--' + project.style} aria-hidden="true">
          <span className="detail-art__number">{project.number}</span>
          <span className="detail-art__rings" />
        </div>
        <p className="detail-eyebrow">{project.category}  /  {project.year}</p>
        <h2 id="detail-title">{project.title.replace('\n', ' ')}</h2>
        <p className="detail-summary">{project.summary}</p>
        <p className="detail-body">{project.description}</p>
        <div className="detail-tags">{project.keywords.map((keyword) => <span key={keyword}>{keyword}</span>)}</div>
        <p className="detail-footnote">Demo content — edit src/config/portfolio.ts to replace with your real work.</p>
      </section>
    </div>
  );
}

type Props = { onRevisit: () => void };

export default function FinalPortfolio({ onRevisit }: Props) {
  const [selected, setSelected] = useState<PortfolioProject | null>(null);
  const contact = Boolean(portfolio.email || portfolio.github);

  return (
    <div className="portfolio-web">
      <nav className="portfolio-nav" aria-label="Portfolio navigation">
        <a className="brand brand--dark" href="#top" onClick={() => setSelected(null)}>
          <span className="brand-icon">{portfolio.monogram}</span>
          <span className="brand-label">{portfolio.name}<small>PORTFOLIO / 2026</small></span>
        </a>
        <div className="portfolio-nav__right">
          <a href="#works">PROJECTS</a>
          <a href="#about">ABOUT</a>
          {contact && <a href="#contact">CONTACT</a>}
          <button type="button" onClick={onRevisit} className="nav-revisit"><ArrowLeft size={15} /> THE SCENE</button>
        </div>
      </nav>

      <main id="top" className="portfolio-main">
        <header className="web-hero">
          <div className="web-hero__copy">
            <p className="label-row"><span className="dot" /> A COLLECTION OF QUESTIONS, EXPERIMENTS & IDEAS</p>
            <h1>From an idea,<br /><em>into the world.</em></h1>
            <p className="web-hero__lede">{portfolio.introduction} This is where the details unfold.</p>
            <a href="#works" className="web-scroll">DISCOVER THE WORK <ArrowDown size={19} /></a>
          </div>
          <div className="web-hero__glyph" aria-hidden="true">
            <div className="orbital orbital--one" />
            <div className="orbital orbital--two" />
            <div className="orbital orbital--three" />
            <div className="orbital-core">LQ</div>
          </div>
          <p className="web-hero__side">INTERACTIVE COLLECTION / VOL. 01</p>
        </header>

        <section className="web-works" id="works">
          <div className="section-intro">
            <div>
              <p className="web-eyebrow">01 / THE PROJECTS</p>
              <h2>Selected <em>works.</em></h2>
            </div>
            <p>Two highlighted ideas from an ongoing practice. Explore each chapter for its story, process and outcome.</p>
          </div>
          <div className="project-grid">
            {portfolio.projects.map((project, i) => (
              <button
                className="project-card" type="button" key={project.id}
                onClick={() => setSelected(project)}
                aria-label={'Open ' + project.title.replace('\n', ' ')}
              >
                <span className={'project-card__visual project-card__visual--' + project.style}>
                  <span className="project-card__visual-index">NO. {project.number}</span>
                  <span className="project-card__artwork" aria-hidden="true">
                    {Array.from({ length: 12 }, (_, j) => <i key={j} style={{ '--ring': j } as React.CSSProperties} />)}
                  </span>
                  <span className="project-card__visual-foot">AN EXPLORATION IN {i === 0 ? 'FORM' : 'SYSTEMS'}</span>
                </span>
                <span className="project-card__category">{project.category} / {project.year}<ArrowUpRight size={19} /></span>
                <span className="project-card__title">{project.title.replace('\n', ' ')}</span>
                <span className="project-card__summary">{project.summary}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="web-about" id="about">
          <div>
            <p className="web-eyebrow">02 / THE PERSON BEHIND THE WORK</p>
            <h2>Always<br />in <em>progress.</em></h2>
          </div>
          <div className="web-about__body">
            <p>The best work usually starts with a question. It grows through research, making, testing, and the determination to see what happens next.</p>
            <p>This is an editable introduction. Write about your interests, background, experience and the direction you are exploring.</p>
            <div className="about-discipline">{portfolio.discipline.split('  /  ').map((x) => <span key={x}>{x}</span>)}</div>
          </div>
        </section>

        <footer id="contact" className="portfolio-footer">
          <p className="web-eyebrow">03 / THE NEXT CHAPTER</p>
          <h2>Let's make<br /><em>something matter.</em></h2>
          <div className="footer-bottom">
            <span>© 2026 {portfolio.name}. All ideas in motion.</span>
            <div className="footer-links">
              {portfolio.email && <a href={'mailto:' + portfolio.email}>EMAIL <ArrowUpRight size={14} /></a>}
              {portfolio.github && <a href={portfolio.github} target="_blank" rel="noreferrer">GITHUB <ExternalLink size={14} /></a>}
              <button type="button" onClick={onRevisit}>RETURN TO THE SCENE <ArrowUpRight size={14} /></button>
            </div>
          </div>
        </footer>
      </main>
      {selected && <ProjectDetail project={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
