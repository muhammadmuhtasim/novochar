// Capture fallback screenshots for the M7 demo.
// Run: node scripts/capture-screenshots.mjs
// Requires: npm run build -w client (dist must be current) and the server running
// (or it boots its own).

import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT = 'docs/m7-demo/screenshots';
mkdirSync(OUT, { recursive: true });

const free = () => new Promise((res) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
});
const port = await free();
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: '/home/kali/Projects/Novochar',
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: 'ignore',
});
await delay(2000);

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// Desktop screenshots
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
await delay(500);
await page.getByRole('button', { name: /SPHEREx FIELD/ }).click();
await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
await page.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 30_000 });
await delay(800);

// 01: side-by-side
await page.screenshot({ path: path.join(OUT, '01-side-by-side.png'), fullPage: false });
console.log('captured 01-side-by-side.png');

// Scroll to metadata panel and capture
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.3));
await delay(300);
await page.screenshot({ path: path.join(OUT, '02-metadata-panel.png'), fullPage: false });
console.log('captured 02-metadata-panel.png');

// 03: single epoch
await page.getByRole('button', { name: 'SINGLE', exact: true }).click();
await delay(400);
await page.screenshot({ path: path.join(OUT, '03-single-epoch.png'), fullPage: false });
console.log('captured 03-single-epoch.png');

// 04: blink paused
await page.getByRole('button', { name: 'BLINK', exact: true }).click();
await delay(600);
const pauseBtn = page.getByRole('button', { name: '⏸ PAUSE', exact: true });
if (await pauseBtn.count()) await pauseBtn.click();
await delay(300);
await page.screenshot({ path: path.join(OUT, '04-blink-paused.png'), fullPage: false });
console.log('captured 04-blink-paused.png');

// 05: evidence panel — go back to side by side and click a pixel
await page.getByRole('button', { name: 'SIDE BY SIDE', exact: true }).click();
await page.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 15_000 });
await delay(400);
await page.evaluate(() => {
  const canvas = document.querySelector('.spherex-canvas');
  const rect = canvas.getBoundingClientRect();
  const x = 100, y = 143, w = canvas.width, h = canvas.height;
  const sx = rect.left + (x + 0.5) * (rect.width / w);
  const sy = rect.top + (h - 1 - y + 0.5) * (rect.height / h);
  canvas.dispatchEvent(new MouseEvent('click', { clientX: sx, clientY: sy, bubbles: true }));
});
await delay(500);
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
await delay(300);
await page.screenshot({ path: path.join(OUT, '05-evidence-panel.png'), fullPage: false });
console.log('captured 05-evidence-panel.png');

// 08: failure/recovery (force 503)
await page.route('**/api/spherex/products', (route) => route.fulfill({
  status: 503,
  contentType: 'application/json',
  body: JSON.stringify({ error: 'the sidecar could not be started', code: 'sidecar_unavailable' }),
}));
await page.reload({ waitUntil: 'domcontentloaded' });
const tab = page.getByRole('button', { name: /SPHEREx FIELD/ });
if (await tab.count()) await tab.click();
await page.locator('.module-error').waitFor({ state: 'visible', timeout: 45_000 });
await delay(300);
await page.screenshot({ path: path.join(OUT, '08-failure-recovery.png'), fullPage: false });
console.log('captured 08-failure-recovery.png');

await page.unroute('**/api/spherex/products');

// Mobile screenshots
const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobilePage.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded' });
await delay(500);
// Open burger menu at mobile width
const burger = mobilePage.locator('.nav-burger');
if (await burger.count()) await burger.click();
await mobilePage.locator('.nav-mobile.open').waitFor({ state: 'visible', timeout: 15_000 });
await mobilePage.locator('.nav-mobile.open').getByText('SPHEREx FIELD').click();
await mobilePage.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
await mobilePage.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 30_000 });
await delay(800);
await mobilePage.screenshot({ path: path.join(OUT, '06-mobile-side-by-side.png'), fullPage: false });
console.log('captured 06-mobile-side-by-side.png');

// Mobile: tap a pixel
await mobilePage.locator('.spherex-canvas').first().click();
await delay(500);
await mobilePage.screenshot({ path: path.join(OUT, '07-mobile-evidence.png'), fullPage: false });
console.log('captured 07-mobile-evidence.png');

await browser.close();
server.kill('SIGTERM');
console.log('All screenshots captured.');