import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const executablePath = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.env.PORTFOLIO_URL || 'http://127.0.0.1:4173/';
const screenshotDir = path.resolve('.work/screenshots');
await fs.mkdir(screenshotDir, { recursive: true });
const browser = await chromium.launch({
  executablePath, headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
    isMobile: true, hasTouch: true, reducedMotion: 'reduce',
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => {
    if (r.status() >= 400 && r.url().includes('/assets/')) errors.push('HTTP ' + r.status() + ' ' + r.url());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.loading-screen'), { timeout: 60000 });
  const hint = await page.locator('.quality-toggle').getAttribute('title');
  if (!hint?.includes('cinematic quality')) throw new Error('Mobile should default to the balanced rendering mode: ' + hint);
  if (await page.locator('.chapter-marker').count() !== 8) throw new Error('Mobile missing six chapter stops');
  await page.screenshot({ path: path.join(screenshotDir, 'six-mobile-intro.png') });
  await page.locator('.chapter-marker').nth(4).click();
  await page.waitForFunction(() => document.querySelectorAll('.chapter-marker')[4]?.getAttribute('aria-current') === 'step');
  await page.screenshot({ path: path.join(screenshotDir, 'six-mobile-paper-d.png') });
  await page.getByRole('button', { name: /SKIP INTRO/ }).click();
  await page.waitForSelector('.portfolio-web', { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(screenshotDir, 'six-mobile-screen.png') });
  const dimensions = await page.evaluate(() => ({
    width: innerWidth, viewport: document.documentElement.clientWidth,
    pageOverflow: document.querySelector('.portfolio-web')?.scrollWidth - document.querySelector('.portfolio-web')?.clientWidth,
    projectCount: document.querySelectorAll('.project-card').length,
  }));
  console.log('SIX MOBILE DIMENSIONS', JSON.stringify(dimensions));
  if (dimensions.pageOverflow > 2 || dimensions.projectCount !== 6) throw new Error('Mobile page overflow or incorrect project count');
  await page.getByRole('link', { name: /DISCOVER THE WORK/ }).click();
  await page.getByRole('button', { name: /Open THE NEXT PAGE/ }).click();
  if (!(await page.getByRole('dialog').isVisible())) throw new Error('Mobile project F modal failed');
  await page.getByRole('dialog').getByRole('button', { name: 'Close project' }).click();
  await page.getByRole('button', { name: /THE SCENE/ }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('.chapter-marker')[6]?.getAttribute('aria-current') === 'step');
  await page.screenshot({ path: path.join(screenshotDir, 'six-mobile-paper-f.png') });
  console.log('SIX MOBILE RETURN TO F OK');
  if (errors.length) throw new Error('Mobile browser errors: ' + errors.join('; '));
  console.log('SIX MOBILE PASS');
} finally {
  await browser.close();
}
