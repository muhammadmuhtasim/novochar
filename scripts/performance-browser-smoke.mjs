import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await unusedPort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: 'ignore',
});
let browser;
const errors = [];

try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Production server exited with ${server.exitCode}`);
    try {
      const response = await fetch(origin);
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, 'production server did not become ready');

  const systemChromium = process.env.CHROMIUM_PATH || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? { executablePath: systemChromium } : {}),
    args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc'],
  });

  const desktop = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  desktop.on('pageerror', (error) => errors.push(error.message));
  const catalogueRequests = [];
  let catalogueDelay = true;
  await desktop.route('**/data/objects.json', async (route) => {
    catalogueRequests.push(route.request().url());
    if (catalogueDelay) await delay(900);
    await route.continue();
  });

  const landing = await desktop.goto(origin, { waitUntil: 'domcontentloaded' });
  assert.equal(landing.status(), 200, 'production landing page should return 200');
  await desktop.locator('.nav-tabs button').first().waitFor({ state: 'visible' });
  await delay(250);
  assert.equal(catalogueRequests.length, 0, 'landing page must not fetch the object catalogue');
  console.log('browser check: landing page did not fetch catalogue');

  const tab = (index) => desktop.locator('.nav-tabs button').nth(index);
  // The two object-data tabs used here are Catalogue and Spectra; their indices
  // follow the navigation order.
  for (const index of [4, 5, 4, 5, 4]) {
    await tab(index).evaluate((button) => button.click());
    await delay(70);
  }
  await tab(4).evaluate((button) => button.click());
  await desktop.getByText('1660/1660 SHOWN', { exact: false }).waitFor({ timeout: 15_000 });
  assert.equal(catalogueRequests.length, 1, 'rapid tab switching should issue one catalogue request');
  assert.match(await desktop.locator('.nav-tabs .active').innerText(), /CATALOGUE/);
  catalogueDelay = false;
  await desktop.close();
  console.log('browser check: rapid route changes deduplicated catalogue request');

  let denySkyChunk = true;
  const retryPage = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  retryPage.on('pageerror', (error) => errors.push(error.message));
  await retryPage.route('**/assets/SkyViewer-*.js', (route) => denySkyChunk ? route.abort() : route.continue());
  await retryPage.goto(origin, { waitUntil: 'domcontentloaded' });
  await retryPage.locator('.nav-tabs button').nth(1).click();
  await retryPage.locator('.module-error button').waitFor({ state: 'visible', timeout: 30_000 });
  denySkyChunk = false;
  await retryPage.getByRole('button', { name: 'Retry feature' }).click();
  await retryPage.locator('.sky-mode-switch').waitFor({ state: 'visible', timeout: 60_000 });
  assert.equal(new URL(retryPage.url()).hash, '#sky', 'retry should retain the selected feature');
  console.log('browser check: failed chunk retried after app reload');

  const timeFeature = async (buttonIndex, selector) => {
    const started = performance.now();
    await retryPage.locator('.sky-mode-switch button').nth(buttonIndex).click();
    await retryPage.locator(selector).waitFor({ state: 'visible', timeout: 60_000 });
    return Math.round(performance.now() - started);
  };
  const firstExploreStarted = performance.now();
  await retryPage.locator('.celestial-canvas').waitFor({ state: 'visible', timeout: 60_000 });
  const firstExploreMs = Math.round(performance.now() - firstExploreStarted);
  console.log('browser check: Explore Sky mounted');
  const firstFlightMs = await timeFeature(1, '.space3d-canvas');
  console.log('browser check: Free-flight mounted');

  const contextLoss = await retryPage.locator('.space3d-canvas').evaluate(async (canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return { supported: false };
    const result = await new Promise((resolve) => {
      let lost = false;
      const finish = (restored) => resolve({ supported: true, lost, restored, isContextLost: gl.isContextLost() });
      canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); lost = true; }, { once: true });
      canvas.addEventListener('webglcontextrestored', () => finish(true), { once: true });
      extension.loseContext();
      setTimeout(() => extension.restoreContext(), 150);
      setTimeout(() => finish(false), 3500);
    });
    return result;
  });
  await delay(600);
  const flightAfterContextRestore = await retryPage.locator('.space3d-canvas').evaluate((canvas) => ({
    size: [canvas.width, canvas.height],
    rect: [Math.round(canvas.getBoundingClientRect().width), Math.round(canvas.getBoundingClientRect().height)],
  }));
  if (contextLoss.supported) assert.ok(contextLoss.lost && contextLoss.restored && !contextLoss.isContextLost, 'WebGL context should restore');
  assert.ok(flightAfterContextRestore.size.every((size) => size > 0), 'renderer should keep a non-zero canvas after context restoration');
  console.log('browser check: WebGL context-loss recovery completed');

  await timeFeature(0, '.celestial-canvas');
  const repeatFlightMs = await timeFeature(1, '.space3d-canvas');
  await retryPage.locator('.nav-tabs button').first().click();
  await retryPage.locator('.space3d-canvas').waitFor({ state: 'detached' });
  const cdp = await retryPage.context().newCDPSession(retryPage);
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const heapAfterUnmount = await retryPage.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  await cdp.detach();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  mobile.on('pageerror', (error) => errors.push(error.message));
  const mobileCdp = await mobile.context().newCDPSession(mobile);
  await mobile.goto(origin, { waitUntil: 'domcontentloaded' });
  await mobile.locator('.nav-burger').evaluate((button) => button.click());
  await mobile.locator('.nav-mobile button').nth(1).evaluate((button) => button.click());
  console.log('browser check: mobile menu selected Sky Viewer');
  await mobileCdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const exploreCanvas = await mobile.waitForSelector('.celestial-canvas', { state: 'visible', timeout: 60_000 });
  const mobileExplore = await exploreCanvas.evaluate((canvas) => ({
    viewport: [innerWidth, innerHeight],
    size: [canvas.width, canvas.height],
    rect: [Math.round(canvas.getBoundingClientRect().width), Math.round(canvas.getBoundingClientRect().height)],
    pageWidth: document.documentElement.scrollWidth,
  }));
  const skyControls = await mobile.evaluate(() => ({
    hash: location.hash,
    modeButtons: document.querySelectorAll('.sky-mode-switch button').length,
    activeTab: document.querySelector('.nav-mobile .active')?.innerText ?? null,
  }));
  assert.equal(skyControls.modeButtons, 2, `Sky Viewer controls missing on mobile: ${JSON.stringify(skyControls)}`);
  await mobile.evaluate(() => document.querySelectorAll('.sky-mode-switch button')[1].click());
  console.log('browser check: mobile switched to Free-flight');
  const flightCanvas = await mobile.waitForSelector('.space3d-canvas', { state: 'visible', timeout: 60_000 });
  await mobile.setViewportSize({ width: 740, height: 900 });
  await delay(300);
  const mobileFlight = await flightCanvas.evaluate((canvas) => ({
    size: [canvas.width, canvas.height],
    rect: [Math.round(canvas.getBoundingClientRect().width), Math.round(canvas.getBoundingClientRect().height)],
  }));
  await mobile.evaluate(() => {
    document.querySelector('.nav-burger').click();
    document.querySelector('.nav-mobile button').click();
  });
  await mobile.locator('.space3d-canvas').waitFor({ state: 'detached', timeout: 10_000 });
  const canvasesAfterUnmount = await mobile.locator('canvas').count();
  await mobileCdp.detach();
  console.log('browser check: mobile emulation and canvas cleanup completed');

  assert.equal(canvasesAfterUnmount, 0, 'navigation away should release viewer canvases');
  assert.deepEqual(errors, [], 'browser should not raise uncaught JavaScript errors');
  const report = {
    landing: { status: landing.status(), catalogueRequests: 0 },
    catalogueRace: { requests: catalogueRequests.length, finalTab: 'Catalogue', rows: 1660 },
    retry: { forcedChunkFailureShown: true, recoveredOnSelectedTab: true },
    skyModesMs: { firstExplore: firstExploreMs, firstFreeFlight: firstFlightMs, repeatedFreeFlight: repeatFlightMs },
    webglContextLoss: contextLoss,
    canvasAfterContextRestore: flightAfterContextRestore,
    heapBytesAfterNavigationAndUnmount: heapAfterUnmount,
    mobileEmulation: { viewport: mobileExplore, resizedFreeFlight: mobileFlight, canvasesAfterUnmount },
    uncaughtErrors: errors,
  };
  const reportPath = join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'performance-regression-report.json');
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
