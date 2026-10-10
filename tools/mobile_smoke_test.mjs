import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const executablePath = process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.env.PORTFOLIO_URL || 'http://127.0.0.1:4173/';
const screenshotDir = path.resolve('.work/screenshots');
await fs.mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  executablePath, headless: true,
  args: ['--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => {
    if (r.status() >= 400 && r.url().includes('/assets/')) errors.push('HTTP '+r.status()+' '+r.url());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('.loading-screen'), { timeout: 60000 });
  const hint = await page.locator('.quality-toggle').getAttribute('title');
  if (!hint?.includes('cinematic quality')) throw new Error('Mobile should default to the balanced rendering mode: '+hint);
  await page.screenshot({ path: path.join(screenshotDir, 'mobile-intro.png') });
  console.log('MOBILE INTRO',await page.locator('.scene-copy h1').innerText());
  await page.getByRole('button',{name:/SKIP INTRO/}).click();
  await page.waitForSelector('.portfolio-web', { timeout: 15000 });
  await page.waitForTimeout(850);
  await page.screenshot({path:path.join(screenshotDir,'mobile-screen.png')});
  const dimensions = await page.evaluate(() => ({
    width:innerWidth,
    viewport:document.documentElement.clientWidth,
    sceneHeight:document.querySelector('.experience')?.clientHeight,
    portfolioOverflow:document.querySelector('.portfolio-web')?.scrollWidth-document.querySelector('.portfolio-web')?.clientWidth,
  }));
  console.log('MOBILE DIMENSIONS',JSON.stringify(dimensions));
  if (dimensions.portfolioOverflow > 2) throw new Error('Mobile portfolio content has horizontal overflow');
  await page.getByRole('link', {name:/DISCOVER THE WORK/}).click();
  await page.getByRole('button',{name:/Open SIGNAL/}).click();
  if(!(await page.getByRole('dialog').isVisible()))throw new Error('Mobile details did not open');
  await page.screenshot({path:path.join(screenshotDir,'mobile-project.png')});
  await page.getByRole('dialog').getByRole('button',{name:'Close project'}).click();
  await page.getByRole('button', {name:/THE SCENE/}).first().click();
  await page.waitForTimeout(800);
  console.log('MOBILE REVISIT', await page.locator('.scene-copy h1').textContent());
  await page.screenshot({path:path.join(screenshotDir,'mobile-paper-b.png')});
  await page.getByRole('button', {name:/BACK/}).first().click();
  await page.waitForTimeout(850);
  await page.screenshot({path:path.join(screenshotDir,'mobile-paper-a.png')});
  console.log('MOBILE PAPER A', await page.locator('.scene-copy h1').textContent());
  if(errors.length)throw new Error('Browser errors: '+errors.join('; '));
  console.log('MOBILE PASS',screenshotDir);
} finally {await browser.close();}
