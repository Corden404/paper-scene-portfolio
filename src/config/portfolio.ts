/**
 * Editorial DEMO content. Replace these sample projects with real results
 * before publishing. Model contains six hero sheets, Paper A through Paper F.
 */
export type PaperId = 'paper-a' | 'paper-b' | 'paper-c' | 'paper-d' | 'paper-e' | 'paper-f';
export type Stage = 'intro' | PaperId | 'screen';
export type ProjectStyle = 'contour' | 'signal' | 'lattice' | 'orbit' | 'prism' | 'waves';

export interface PortfolioProject {
  id: PaperId;
  number: string;
  tag: string;
  title: string;
  heroHeading: string;
  subtitle: string;
  summary: string;
  description: string;
  category: string;
  year: string;
  keywords: string[];
  style: ProjectStyle;
  accent: string;
}

export const portfolio = {
  name: 'LeeQ',
  monogram: 'LQ',
  discipline: 'RESEARCH  /  ENGINEERING  /  IDEAS',
  headline: ['NOT EVERYTHING', 'STAYS ON', 'PAPER.'],
  introduction: 'A journey through ideas, experiments, and the work that makes them real.',
  email: '',
  github: '',
  // Set this to 1–6 to showcase fewer papers. Visitors can always skip to the
  // computer; the full catalogue below still shows all six listed projects.
  featuredPaperCount: 6,
  projects: [
    {
      id: 'paper-a', number: '01', tag: 'THE FIRST CHAPTER',
      title: 'FORM &\nFUNCTION', heroHeading: 'EVERYTHING\nBEGINS SOMEWHERE.',
      subtitle: 'Exploration and experimentation',
      summary: 'From the first question to a clear, considered result.',
      description: 'A place for the work you are most proud of. Explain the challenge, the approach, what you built, and the lessons you learned. Replace all demo copy with your real achievements.',
      category: 'FEATURED WORK', year: '2026',
      keywords: ['IDEATION', 'DESIGN', 'IMPLEMENTATION'],
      style: 'contour', accent: '#71999c',
    },
    {
      id: 'paper-b', number: '02', tag: 'THE SECOND CHAPTER',
      title: 'SIGNAL &\nSYSTEM', heroHeading: 'A QUESTION\nBECOMES A WORLD.',
      subtitle: 'Making complex ideas tangible',
      summary: 'An experiment in turning a possibility into something real.',
      description: 'Use this page to tell the story behind your second project: the initial problem, the ideas tested, and the results. This placeholder can be research, software, academic or creative work.',
      category: 'SELECTED PROJECT', year: '2026',
      keywords: ['RESEARCH', 'DEVELOPMENT', 'RESULTS'],
      style: 'signal', accent: '#9ea8a1',
    },
    {
      id: 'paper-c', number: '03', tag: 'THE THIRD CHAPTER',
      title: 'PATTERN &\nPROCESS', heroHeading: 'LOOK CLOSER.\nFIND THE PATTERN.',
      subtitle: 'Finding structure in complexity',
      summary: 'A closer look at the patterns that shape meaningful solutions.',
      description: 'Present a third selected achievement, describing your methods, discoveries, and contribution. The layout and artwork are fully editable.',
      category: 'EXPLORATION', year: '2026',
      keywords: ['ANALYSIS', 'STRUCTURE', 'DISCOVERY'],
      style: 'lattice', accent: '#8aaba9',
    },
    {
      id: 'paper-d', number: '04', tag: 'THE FOURTH CHAPTER',
      title: 'DEPTH &\nDETAIL', heroHeading: 'IN THE DETAILS,\nTHE DIFFERENCE.',
      subtitle: 'Care through every iteration',
      summary: 'The small decisions that make a larger idea feel complete.',
      description: 'Highlight another project, award, publication or learning experience. Explain why it mattered and what changed because of your work.',
      category: 'SELECTED WORK', year: '2026',
      keywords: ['CRAFT', 'ITERATION', 'QUALITY'],
      style: 'orbit', accent: '#99aca0',
    },
    {
      id: 'paper-e', number: '05', tag: 'THE FIFTH CHAPTER',
      title: 'THEORY &\nPRACTICE', heroHeading: 'FROM THEORY\nTO SOMETHING REAL.',
      subtitle: 'Building beyond the hypothesis',
      summary: 'Moving from abstract ideas to work you can see and use.',
      description: 'Introduce a fifth achievement: your goals, process and measured outcomes. All text here is sample content awaiting your own work.',
      category: 'RESEARCH & MAKING', year: '2026',
      keywords: ['EXPERIMENT', 'PROTOTYPE', 'IMPACT'],
      style: 'prism', accent: '#78979c',
    },
    {
      id: 'paper-f', number: '06', tag: 'THE SIXTH CHAPTER',
      title: 'THE NEXT\nPAGE', heroHeading: 'THE STORY\nIS STILL UNFOLDING.',
      subtitle: 'An open invitation to explore',
      summary: 'The next direction, new questions and possibilities ahead.',
      description: 'Use the final chapter for future-looking ideas, current work or one more memorable accomplishment. After this sheet, visitors enter the full interactive portfolio.',
      category: 'WHAT COMES NEXT', year: '2026',
      keywords: ['FUTURE', 'CURIOSITY', 'EXPLORATION'],
      style: 'waves', accent: '#90b3af',
    },
  ] satisfies PortfolioProject[],
};

export const featuredProjects: PortfolioProject[] = portfolio.projects.slice(
  0,
  Math.max(1, Math.min(portfolio.featuredPaperCount, portfolio.projects.length)),
);

export const stages: Stage[] = ['intro', ...featuredProjects.map((p) => p.id), 'screen'];

// V4 keeps the six-paper camera route; the opening matches reference frame 25.
export const stageFrames: Record<Stage, number> = {
  intro: 25,
  'paper-a': 109,
  'paper-b': 205,
  'paper-c': 288,
  'paper-d': 372,
  'paper-e': 456,
  'paper-f': 541,
  screen: 654,
};
