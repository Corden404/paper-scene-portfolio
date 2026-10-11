import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

const original = await fs.readFile(new URL('../src/config/portfolio.ts', import.meta.url), 'utf8');
const setting = /featuredPaperCount:\s*6,/;
if (!setting.test(original)) throw new Error('The test expects six papers by default');

async function readRoute(count) {
  // Compile an in-memory config variation. Never modify the working tree.
  const modified = original.replace(setting, 'featuredPaperCount: ' + count + ',');
  const js = ts.transpileModule(modified, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js, 'utf8').toString('base64'));
}

for (const [count, expected] of [
  [1, ['intro', 'paper-a', 'screen']],
  [4, ['intro', 'paper-a', 'paper-b', 'paper-c', 'paper-d', 'screen']],
  [6, ['intro', 'paper-a', 'paper-b', 'paper-c', 'paper-d', 'paper-e', 'paper-f', 'screen']],
]) {
  const { stages, stageFrames, featuredProjects, portfolio } = await readRoute(count);
  assert.deepEqual(stages, expected, 'Unexpected route when featuredPaperCount=' + count);
  assert.equal(featuredProjects.length, count);
  assert.equal(portfolio.projects.length, 6, 'Computer catalogue must retain six projects');
  assert.equal(stageFrames.screen, 654, 'Last stop must still reach the monitor');
  let previousFrame = 0;
  for (const stage of stages) {
    assert.ok(stageFrames[stage] > previousFrame, 'The active stops must follow the v3 camera route');
    previousFrame = stageFrames[stage];
  }
  console.log(count, 'FEATURED PAPERS =>', stages.join(' → '));
}
console.log('CONFIG ROUTING PASS');
