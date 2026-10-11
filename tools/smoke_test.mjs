import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const chrome = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const address = process.env.PORTFOLIO_URL || 'http://127.0.0.1:4173/';
const dest = path.resolve('.work/screenshots');
await fs.mkdir(dest, { recursive: true });
const errors = [];
const browser = await chromium.launch({
  executablePath: chrome, headless: true,
  args: ['--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', error => errors.push('PAGE ERROR: ' + error.message));
page.on('response', response => {
  if (response.status() >= 400) errors.push('HTTP ' + response.status() + ': ' + response.url());
});
page.on('console', msg => {
  if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text().slice(0, 700));
});

async function waitChapter(index) {
  await page.waitForFunction(expectedIndex => {
    const markers = document.querySelectorAll('.chapter-marker');
    return markers.length === 8
      && markers[expectedIndex]?.getAttribute('aria-current') === 'step'
      && !document.querySelector('.scene-copy--moving')
      && Boolean(document.querySelector('.rendered-frame')?.complete)
      && document.querySelector('.rendered-frame')?.naturalWidth > 0
      && !document.querySelector('.rendered-frame--incoming');
  }, index, { timeout: 20_000 });
}
try {
  await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.rendered-frame', { timeout: 25_000 });
  await page.waitForFunction(() => !document.querySelector('.loading-screen') || Boolean(document.querySelector('.error-screen')), { timeout: 60_000 });
  if (await page.locator('.error-screen').count()) throw new Error('Scene load error: ' + await page.locator('.error-screen').innerText());

  const imageInfo = await page.locator('.rendered-frame').evaluate(image => {
    return { decoded: image.complete && image.naturalWidth > 0, width: image.naturalWidth, height: image.naturalHeight, url: image.currentSrc };
  });
  if (!imageInfo.decoded) throw new Error('Opening image did not decode');
  console.log('RENDERED V4', JSON.stringify(imageInfo));
  await waitChapter(0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(dest, 'six-intro.png') });

  for (let i = 1; i <= 6; i++) {
    await page.locator('.next-button').click();
    await waitChapter(i);
    const key = String.fromCharCode(96 + i);
    const title = await page.locator('.scene-copy h1').textContent();
    if (!title) throw new Error('Missing chapter copy at paper ' + key);
    console.log('SIX PAPER', i, title.replace(/\s+/g, ' ').trim());
    await page.screenshot({ path: path.join(dest, 'six-paper-' + key + '.png') });
  }
  await page.locator('.next-button').click();
  await waitChapter(7);
  await page.screenshot({ path: path.join(dest, 'six-monitor-3d.png') });
  await page.waitForSelector('.portfolio-web', { timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(dest, 'six-screen.png') });

  const count = await page.locator('.project-card').count();
  if (count !== 6) throw new Error('Expected six projects on computer, got ' + count);
  await page.getByRole('button', { name: /Open FORM/ }).click();
  if (!(await page.getByRole('dialog').isVisible())) throw new Error('Project detail A failed');
  await page.getByRole('dialog').getByRole('button', { name: 'Close project' }).click();
  await page.getByRole('button', { name: /Open THE NEXT PAGE/ }).click();
  if (!(await page.getByRole('dialog').isVisible())) throw new Error('Project detail F failed');
  await page.getByRole('dialog').getByRole('button', { name: 'Close project' }).press('Escape');
  if (!(await page.locator('.portfolio-web').isVisible())) throw new Error('Closing details must not leave the portfolio');
  console.log('FINAL HTML projects', count);

  await page.getByRole('button', { name: /THE SCENE/ }).first().click();
  await waitChapter(6);
  console.log('RETURN FROM HTML TO F OK');
  await page.locator('.chapter-marker').nth(3).click();
  await waitChapter(3);
  console.log('RANDOM ACCESS C OK');
  await page.locator('.next-button').click();
  await page.getByRole('button', { name: /SKIP INTRO/ }).click();
  await page.waitForSelector('.portfolio-web', { timeout: 15_000 });
  console.log('MID-TRANSITION SKIP TO SCREEN OK');
  console.log('RENDER_ERRORS', JSON.stringify(errors.slice(0, 15)));
  if (errors.length) {
    throw new Error('Browser errors: ' + errors.slice(0, 8).join('; '));
  }
  console.log('SIX PAPER SMOKE PASS', dest);
} finally {
  await browser.close();
}
