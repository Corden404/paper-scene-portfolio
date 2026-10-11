import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_BIN || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const address = process.env.PORTFOLIO_URL || 'http://127.0.0.1:4173/';
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(address);
  await page.waitForSelector('.rendered-frame');
  // Decode every delivered image through the actual browser, including assets
  // beyond the first prefetched chapter and the mobile/low-bandwidth variants.
  const manifest = await (await page.request.get(new URL('/assets/rendered/frames.json', address).href)).json();
  if (manifest.version !== 'V4' || Object.keys(manifest.frames).length !== 8) throw new Error('Incomplete V4 delivery');
  for (const frame of Object.values(manifest.frames)) {
    for (const orientation of ['landscape', 'portrait']) {
      for (const mode of ['cinema', 'lite']) {
        const url = frame[orientation][mode];
        await page.evaluate(async url => {
          const image = new Image();
          image.src = url;
          await image.decode();
          if (!image.naturalWidth || !image.naturalHeight) throw new Error('Undecodable frame: ' + url);
        }, url);
      }
    }
  }
  await page.getByRole('button', { name: 'Toggle image quality' }).click();
  await page.waitForFunction(() => document.querySelector('.rendered-frame')?.currentSrc.includes('intro-landscape-lite'));
  await page.getByRole('button', { name: /BEGIN JOURNEY/ }).click();
  await page.waitForSelector('.rendered-flight--active');
  const start = await page.locator('.rendered-flight--active').evaluate(video => video.currentTime);
  await page.waitForFunction(t => document.querySelector('.rendered-flight--active')?.currentTime > t + .2, start);
  await page.waitForFunction(() => document.querySelector('.rendered-frame')?.currentSrc.includes('paper-a-landscape-lite') && !document.querySelector('.scene-copy--moving'));
  await page.getByRole('button', { name: 'BACK', exact: true }).click();
  await page.waitForSelector('.rendered-flight--active');
  if (!(await page.locator('.rendered-flight--active').evaluate(video => video.currentSrc)).includes('paper-a--intro')) throw new Error('Reverse camera route missing');
  await page.waitForFunction(() => document.querySelector('.rendered-frame')?.currentSrc.includes('intro-landscape-lite') && !document.querySelector('.scene-copy--moving'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.rendered-frame')?.currentSrc.includes('intro-portrait-lite'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Go to paper-c' }).click();
  await page.waitForFunction(() => document.querySelector('.rendered-frame')?.currentSrc.includes('paper-c-portrait-lite') && !document.querySelector('.scene-copy--moving'));
  if (errors.length) throw new Error(errors.join('; '));
  if (await page.locator('.rendered-flight--active').count()) throw new Error('Reduced motion must skip flights');
  console.log('ALL 32 V4 IMAGES DECODED; REAL FORWARD/REVERSE FLIGHTS, QUALITY, RESIZE AND REDUCED MOTION PASS');
} finally {
  await browser.close();
}
