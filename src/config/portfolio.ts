/**
 * All public portfolio copy and project metadata live here.
 * This ships with editable editorial DEMO content — replace the projects
 * with your real achievements before publishing.
 */
export type ProjectStyle = 'contour' | 'signal';
export interface PortfolioProject {
  id: 'paper-a' | 'paper-b';
  number: string;
  tag: string;
  title: string;
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
  email: '', // Supply an address to display a real contact link.
  github: '', // Supply a public GitHub URL to display the link.
  projects: [
    {
      id: 'paper-a',
      number: '01',
      tag: 'THE FIRST CHAPTER',
      title: 'FORM &\nFUNCTION',
      subtitle: 'Exploration and experimentation',
      summary: 'From the first question to a clear, considered result.',
      description: 'A space for the work you are most proud of. Describe the challenge, how you approached it, what you built, and what you learned. Replace this editorial demo copy with your actual achievements.',
      category: 'FEATURED WORK',
      year: '2026',
      keywords: ['IDEATION', 'DESIGN', 'IMPLEMENTATION'],
      style: 'contour',
      accent: '#71999c',
    },
    {
      id: 'paper-b',
      number: '02',
      tag: 'THE SECOND CHAPTER',
      title: 'SIGNAL &\nSYSTEM',
      subtitle: 'Making complex ideas tangible',
      summary: 'An experiment in turning a possibility into something real.',
      description: 'Highlight another selected project here. This layout supports visual research, engineering work, software, academic papers, awards, or any other outcome you would like visitors to explore.',
      category: 'SELECTED PROJECT',
      year: '2026',
      keywords: ['RESEARCH', 'DEVELOPMENT', 'RESULTS'],
      style: 'signal',
      accent: '#9ea8a1',
    },
  ] satisfies PortfolioProject[],
} as const;

export type Stage = 'intro' | 'paper-a' | 'paper-b' | 'screen';
export const stages: readonly Stage[] = ['intro', 'paper-a', 'paper-b', 'screen'];
export const stageFrames: Record<Stage, number> = {
  intro: 24,
  'paper-a': 122,
  'paper-b': 238,
  screen: 345,
};
