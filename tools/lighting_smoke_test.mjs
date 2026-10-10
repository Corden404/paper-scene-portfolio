import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const chrome = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.env.PORTFOLIO_URL || 'http://127.0.0.1:4173/';
const dest = path.resolve('.work/screenshots');
await fs.mkdir(dest, { recursive: true });
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    const lighting = { backlightShaders: 0, paperSwayShaders: 0 };
    Object.defineProperty(window, '__lightingQA', { value: lighting });
    for (const key of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
      const GL = window[key];
      if (!GL) continue;
      const original = GL.prototype.shaderSource;
      GL.prototype.shaderSource = function shaderSource(shader, source) {
        if (source.includes('thinScatter') && source.includes('inkTransmission')) lighting.backlightShaders++;
        if (source.includes('paperSway')) lighting.paperSwayShaders++;
        return original.call(this, shader, source);
      };
    }
  });
  page.on('pageerror', error => errors.push('JS: ' + error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !/favicon/i.test(message.text())) {
      errors.push('GL: ' + message.text().slice(0, 2500));
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.loading-screen'), { timeout: 75_000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(dest, 'cinema-fixed-backlight-intro.png') });
  const shaders = await page.evaluate(() => window.__lightingQA);
  console.log('LIGHTING SHADERS', JSON.stringify(shaders));
  if (shaders.backlightShaders < 2 || shaders.paperSwayShaders < 2) {
    throw new Error('Expected actual compiled backlit and moving-paper shaders; got ' + JSON.stringify(shaders));
  }
  if (errors.length) throw new Error('Shader/browser errors: ' + errors.join(' | '));

  await page.locator('.chapter-marker').nth(3).click();
  await page.waitForFunction(() =>
    document.querySelectorAll('.chapter-marker')[3]?.getAttribute('aria-current') === 'step'
    && !document.querySelector('.scene-copy--moving'), { timeout: 22_000 });
  await page.screenshot({ path: path.join(dest, 'cinema-fixed-backlight-paper-c.png') });
  console.log('CINEMATIC SHADER VALIDATED, intro and Paper C screenshots captured');
} finally {
  await browser.close();
}
