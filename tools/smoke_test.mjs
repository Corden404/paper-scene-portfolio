import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const chrome = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const address = process.env.PORTFOLIO_URL || 'http://127.0.0.1:4173/';
const dest = path.resolve('.work/screenshots');
await fs.mkdir(dest, { recursive: true });
const errors = [];
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', error => errors.push('PAGE ERROR: ' + error.message));
page.on('response', response => {
  if (response.status() >= 400) errors.push('HTTP ' + response.status() + ': ' + response.url());
});
page.on('console', msg => {
  if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text().slice(0, 700));
});

try {
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.scene-canvas canvas', { timeout: 25_000 });
  await page.waitForFunction(() => {
    return !document.querySelector('.loading-screen') || Boolean(document.querySelector('.error-screen'));
  }, { timeout: 45_000 });
  if (await page.locator('.error-screen').count()) throw new Error('Scene load error: ' + await page.locator('.error-screen').innerText());
  await page.waitForTimeout(2400);
  const glInfo = await page.locator('canvas').first().evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { ok: false };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { ok: true, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), width: canvas.width, height: canvas.height };
  });
  console.log('WEBGL', JSON.stringify(glInfo));
  if (!glInfo.ok) throw new Error('WebGL context missing');
  await page.screenshot({ path: path.join(dest, 'intro.png') });
  console.log('STAGE INTRO', await page.locator('.scene-copy h1').innerText());

  await page.getByRole('button', { name: /BEGIN JOURNEY/ }).click();
  await page.waitForTimeout(5400);
  await page.screenshot({ path: path.join(dest, 'paper-a.png') });
  console.log('STAGE PAPER A', await page.locator('.scene-copy h1').innerText());

  await page.getByRole('button', { name: /NEXT CHAPTER/ }).click();
  await page.waitForTimeout(5700);
  await page.screenshot({ path: path.join(dest, 'paper-b.png') });
  console.log('STAGE PAPER B', await page.locator('.scene-copy h1').innerText());

  await page.getByRole('button', { name: /THE FULL STORY/ }).click();
  await page.waitForFunction(() => {
    const copy = document.querySelector('.scene-copy');
    return copy?.classList.contains('scene-copy--screen') && !copy?.classList.contains('scene-copy--moving');
  }, { timeout: 15_000 });
  await page.screenshot({ path: path.join(dest, 'monitor-3d.png') });
  await page.waitForSelector('.portfolio-web', { timeout: 15_000 });
  await page.waitForTimeout(1250);
  await page.screenshot({ path: path.join(dest, 'screen.png') });
  console.log('STAGE COMPUTER', await page.locator('.portfolio-web h1').innerText());

  await page.getByRole('button', { name: /Open FORM/ }).click();
  const dialog = page.getByRole('dialog');
  if (!(await dialog.isVisible())) throw new Error('Project detail modal failed');
  console.log('PROJECT MODAL', await dialog.locator('h2').innerText());
  await dialog.getByRole('button', { name: /Close project/ }).click();
  await page.getByRole('button', { name: /THE SCENE/ }).first().click();
  await page.waitForTimeout(5400);
  console.log('RETURN TO SCENE', await page.locator('.scene-copy h1').innerText());
  await page.getByRole('button', { name: /SKIP INTRO/ }).click();
  await page.waitForSelector('.portfolio-web', { timeout: 15_000 });
  console.log('SKIP FROM PAPER TO COMPUTER PASS');

  console.log('RENDER_ERRORS', JSON.stringify(errors.slice(0, 15)));
  const serious = errors.filter(e => /PAGE ERROR|shader error|cannot read propert|failed to compile|webglprogram|uncaught|invalid operation|HTTP (4|5)\\d\\d: .*assets\\/(paper-scene|camera-path)/i.test(e));
  if (serious.length) throw new Error('Browser errors: ' + serious.slice(0, 5).join('; '));
  console.log('SMOKE PASS, screenshots:', dest);
} finally {
  await browser.close();
}
