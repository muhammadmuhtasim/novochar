// Browser acceptance for the SPHEREx 3D explorer: the verified regional
// archive and the separate illustrative global timeline.
//
// Run on demand after `npm run build`:
//
//   npm run check:spherex3d
//
// It boots the production server, opens the built client in system Chromium,
// and checks the things a screenshot alone cannot:
//
//   * the archive index exposes exactly two verified epochs and no global claim;
//   * both archive rasters are PNGs with mode/epoch provenance headers;
//   * the default view is the archive region, with no fabricated all-sky base;
//   * switching archive epochs changes the real observation on screen;
//   * the illustrative mode is a separate, clearly labelled four-epoch layer;
//   * source markers, play/pause and RESET VIEW work in illustrative mode;
//   * the page offers no difference/subtraction/variability action;
//   * the mobile path selects the low-quality profile without side-scrolling;
//   * a browser without WebGL2 gets an honest fallback, not a blank canvas;
//   * the FIELD bridge lands in the validated tab with no uncaught errors.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const projectRoot = new URL('..', import.meta.url).pathname;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function check(name, condition, detail = '') {
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
  console.log(`✓ ${name}`);
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(origin, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${origin}/api/health`, { cache: 'no-store' });
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await delay(200);
  }
  throw new Error(`server did not become healthy at ${origin}`);
}

const cdpSessions = new WeakMap();

async function canvasStats(page) {
  // Playwright's stability check can wait forever on the live canvas, and
  // page.screenshot() waits for document fonts. Capture through CDP instead:
  // it reads the current compositor frame without either wait.
  await page.evaluate(() => {
    document.querySelector('.sky3d-canvas')?.scrollIntoView({ block: 'center', behavior: 'instant' });
  });
  await delay(150);
  const box = await page.locator('.sky3d-canvas').boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, 'canvas should have a layout box');
  let cdp = cdpSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    cdpSessions.set(page, cdp);
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const screenshot = Buffer.from(data, 'base64');
  return page.evaluate(async ({ base64, box }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const scale = image.width / window.innerWidth;
    const x = Math.round(box.x * scale);
    const y = Math.round(box.y * scale);
    const width = Math.round(box.width * scale);
    const height = Math.round(box.height * scale);
    const pixels = context.getImageData(x, y, width, height).data;
    let nonDark = 0;
    let bright = 0;
    let checksum = 0;
    let total = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const sum = pixels[i] + pixels[i + 1] + pixels[i + 2];
      if (sum > 24) nonDark += 1;
      if (sum > 240) bright += 1;
      checksum = (checksum * 31 + sum) >>> 0;
      total += sum;
    }
    const count = width * height;
    return {
      width,
      height,
      nonDark,
      bright,
      checksum,
      mean: +(total / count / 3).toFixed(2),
      fraction: +(nonDark / count).toFixed(3),
    };
  }, { base64: screenshot.toString('base64'), box });
}

async function waitForSky(page, { timeout = 60_000 } = {}) {
  await page.locator('.sky3d-canvas').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => !document.querySelector('.sky3d-loading'), null, { timeout });
  await delay(1800);
  const fatal = await page.locator('.sky3d-fatal').count();
  if (fatal) {
    const text = await page.locator('.sky3d-fatal').innerText();
    throw new Error(`3D view reported a fatal error: ${text.replace(/\s+/g, ' ')}`);
  }
}

const systemChromium = process.env.CHROMIUM_PATH
  || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
const browserArgs = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--enable-webgl',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

const port = await unusedPort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: projectRoot,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (chunk) => { serverLog += chunk; });
server.stderr.on('data', (chunk) => { serverLog += chunk; });

let browser;
try {
  await waitForServer(origin);

  // --- contracts -------------------------------------------------------------
  const indexResponse = await fetch(`${origin}/api/spherex/sky`, { cache: 'no-store' });
  check('sky index answers', indexResponse.status === 200, `HTTP ${indexResponse.status}`);
  const index = await indexResponse.json();
  check('sky index schema', index.schema === 'novochar.spherex.sky-index/v1', index.schema);
  check('sky index is illustrative', index.mode === 'illustrative', index.mode);
  check('sky index has four epochs', index.epochs?.length === 4, String(index.epochs?.length));
  check('sky index uses HEALPix NEST', index.tiles?.scheme === 'healpix-nest' && index.tiles?.ordering === 'NEST');
  check('sky pyramid is order 1..4', index.tiles?.baseOrder === 1 && index.tiles?.maxOrder === 4);
  check('sky index carries the non-measurement notice', /not an archive measurement|visualization prototype/i.test(index.notice ?? ''));

  const sourcesResponse = await fetch(`${origin}/api/spherex/sky/sources`, { cache: 'no-store' });
  check('source layer answers', sourcesResponse.status === 200, `HTTP ${sourcesResponse.status}`);
  const sources = await sourcesResponse.json();
  check('source layer schema', sources.schema === 'novochar.spherex.sky-sources/v1', sources.schema);
  check('source layer is illustrative', sources.mode === 'illustrative', sources.mode);
  check('source layer has candidates', Array.isArray(sources.candidates) && sources.candidates.length >= 10,
    String(sources.candidates?.length));
  check('every candidate carries four epochs',
    sources.candidates.every((candidate) => candidate.epochs?.length === 4));

  for (const [kind, url] of [
    ['base', `${origin}/api/spherex/sky/base/${index.epochs[0].id}.png`],
    ['tile', `${origin}/api/spherex/sky/tile/${index.epochs[0].id}/1/0.png`],
  ]) {
    const response = await fetch(url, { cache: 'no-store' });
    check(`${kind} raster answers`, response.status === 200, `HTTP ${response.status}`);
    check(`${kind} raster is PNG`, response.headers.get('content-type') === 'image/png');
    check(`${kind} raster advertises illustrative mode`,
      response.headers.get('x-novochar-sky-mode') === 'illustrative');
    check(`${kind} raster is ETagged`, Boolean(response.headers.get('etag')));
    const bytes = new Uint8Array(await response.arrayBuffer());
    check(`${kind} raster has the PNG signature`,
      PNG_SIGNATURE.every((byte, i) => bytes[i] === byte), `${bytes.length} bytes`);
  }

  const archiveResponse = await fetch(`${origin}/api/spherex/sky/archive`, { cache: 'no-store' });
  check('archive index answers', archiveResponse.status === 200, `HTTP ${archiveResponse.status}`);
  const archive = await archiveResponse.json();
  check('archive index schema', archive.schema === 'novochar.spherex.sky-archive/v1', archive.schema);
  check('archive index is regional', archive.mode === 'archive'
    && archive.dataset?.regionOnly === true
    && archive.dataset?.globalCoverage === false);
  check('archive has exactly two verified epochs', archive.epochs?.length === 2,
    String(archive.epochs?.length));
  check('archive epochs carry observation provenance',
    archive.epochs.every((epoch) => epoch.archive?.obs_id && epoch.archive?.date_obs_utc
      && epoch.archive?.cutout_sha256 && epoch.derived?.output_sha256));
  check('archive keeps quantitative differences disabled',
    archive.comparison?.quantitativeDifferenceEnabled === false);
  check('archive declares one shared display stretch',
    archive.display?.method === 'shared-linear-percentile'
    && archive.display?.sampleSize > 0
    && /shared by every archive epoch/i.test(archive.display?.note ?? ''));
  check('archive declares a TAN tangent plane', archive.surface?.kind === 'regional-tan'
    && archive.surface?.projection === 'TAN'
    && archive.surface?.x_axis_direction === 'west');

  for (const epoch of archive.epochs) {
    const response = await fetch(`${origin}${epoch.raster}`, { cache: 'no-store' });
    check(`${epoch.id} archive raster answers`, response.status === 200, `HTTP ${response.status}`);
    check(`${epoch.id} archive raster is PNG`, response.headers.get('content-type') === 'image/png');
    check(`${epoch.id} archive raster advertises archive mode`,
      response.headers.get('x-novochar-sky-mode') === 'archive');
    check(`${epoch.id} archive raster names its epoch`,
      response.headers.get('x-novochar-sky-epoch') === epoch.id);
    check(`${epoch.id} archive raster carries its source hash`,
      response.headers.get('x-novochar-sky-source-sha256')?.length === 64);
    const bytes = new Uint8Array(await response.arrayBuffer());
    check(`${epoch.id} archive raster has the PNG signature`,
      PNG_SIGNATURE.every((byte, i) => bytes[i] === byte), `${bytes.length} bytes`);
  }

  // --- desktop: verified regional archive (default) --------------------------
  browser = await chromium.launch({ headless: true, executablePath: systemChromium, args: browserArgs });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/i.test(message.text())) pageErrors.push(message.text());
  });

  await page.goto(`${origin}/#spherex3d`, { waitUntil: 'domcontentloaded' });
  await waitForSky(page);
  check('the 3D tab is active', (await page.locator('.sky3d').count()) === 1);
  check('the canvas is WebGL2',
    await page.evaluate(() => Boolean(document.querySelector('.sky3d-canvas')?.getContext('webgl2'))));
  check('the verified archive mode is selected by default',
    await page.getByRole('tab', { name: /NEP ARCHIVE/i }).getAttribute('aria-selected') === 'true');
  check('the archive badge is visible',
    (await page.locator('.sky3d-badges').innerText()).includes('VERIFIED REGIONAL ARCHIVE'));
  check('the archive readout names the regional data',
    await page.waitForFunction(() => /DETAIL\s+NEP/.test(document.querySelector('.sky3d-readout')?.innerText || ''), null, { timeout: 15_000 }).then(() => true).catch(() => false));
  check('the real archive texture arrives',
    await page.waitForFunction(() => /([1-9]\d*) TEX/.test(document.querySelector('.sky3d-telemetry')?.innerText || ''), null, { timeout: 40_000 }).then(() => true).catch(() => false));

  const archiveInitial = await canvasStats(page);
  check('the archive region is not blank', archiveInitial.fraction > 0.08, JSON.stringify(archiveInitial));
  check('the archive region contains measured brightness', archiveInitial.bright > 100, String(archiveInitial.bright));

  const archiveStops = page.locator('.sky3d-stop');
  check('the archive timeline has two observations', (await archiveStops.count()) === 2);
  check('the first epoch names its observation date',
    (await page.locator('.sky3d-epoch-title').innerText()).includes('2025-04-29'));
  const archiveCard = (await page.locator('.sky3d-sidebar').innerText()).replace(/\s+/g, ' ');
  check('the active card carries the archive observation id', /2025W18_1B_0095_2/.test(archiveCard), archiveCard.slice(0, 200));
  check('the active card carries release and calibration context',
    /QR2/.test(archiveCard) && /6\.4\+psffix1/.test(archiveCard) && /valid grid/i.test(archiveCard));
  check('the comparison gate is visibly disabled',
    /QUANTITATIVE OFF/.test(archiveCard) && /DISABLED/.test(archiveCard));
  check('archive mode offers no change candidates', (await page.locator('.sky3d-source').count()) === 0);
  check('the archive legend distinguishes observation and no-data',
    /VERIFIED NEP PIXELS/.test(await page.locator('.sky3d-legend').innerText())
    && /NO ARCHIVE DATA/.test(await page.locator('.sky3d-legend').innerText()));

  await archiveStops.nth(1).click();
  await page.waitForFunction(() => /2025-11-16/.test(document.querySelector('.sky3d-epoch-title')?.innerText || ''), null, { timeout: 15_000 });
  await delay(1600);
  const archiveSecond = await canvasStats(page);
  check('switching archive epochs changes the measured sky', archiveSecond.checksum !== archiveInitial.checksum,
    `${archiveInitial.checksum} -> ${archiveSecond.checksum}`);
  const secondCard = (await page.locator('.sky3d-sidebar').innerText()).replace(/\s+/g, ' ');
  check('the second observation keeps its own provenance', /2025W46_2A_0537_1/.test(secondCard), secondCard.slice(0, 200));

  // --- desktop: separate illustrative global layer ---------------------------
  await page.getByRole('tab', { name: /ILLUSTRATIVE/i }).click();
  await page.waitForFunction(() => /ILLUSTRATIVE GLOBAL LAYER/.test(document.querySelector('.sky3d-badges')?.innerText || ''), null, { timeout: 15_000 });
  await waitForSky(page);
  check('the illustrative mode is a separate explicit tab',
    await page.getByRole('tab', { name: /ILLUSTRATIVE/i }).getAttribute('aria-selected') === 'true');
  check('the illustrative badge is visible',
    (await page.locator('.sky3d-badges').innerText()).includes('ILLUSTRATIVE GLOBAL LAYER'));
  check('the illustrative readout exposes HEALPix detail',
    await page.waitForFunction(() => /DETAIL\s+L2/.test(document.querySelector('.sky3d-readout')?.innerText || ''), null, { timeout: 15_000 }).then(() => true).catch(() => false));
  check('illustrative detail tiles actually arrive',
    await page.waitForFunction(() => /([1-9]\d*) TEX/.test(document.querySelector('.sky3d-telemetry')?.innerText || ''), null, { timeout: 40_000 }).then(() => true).catch(() => false));

  const initial = await canvasStats(page);
  check('the illustrative sky is not blank', initial.fraction > 0.08, JSON.stringify(initial));
  check('the illustrative sky contains bright pixels', initial.bright > 100, String(initial.bright));
  const telemetry = (await page.locator('.sky3d-telemetry').innerText()).replace(/\s+/g, ' ');
  check('telemetry reports frames and textures', /\d+(?:\.\d+)? FPS/.test(telemetry) && /([1-9]\d*) TEX/.test(telemetry), telemetry);

  const stops = page.locator('.sky3d-stop');
  check('the illustrative timeline has four epochs', (await stops.count()) === 4);
  await stops.nth(1).click();
  await page.waitForFunction(() => /EPOCH 2/.test(document.querySelector('.sky3d-epoch-title')?.innerText || ''), null, { timeout: 15_000 });
  await delay(1600);
  const epoch2 = await canvasStats(page);
  check('switching illustrative epochs changes the rendered sky', epoch2.checksum !== initial.checksum,
    `${initial.checksum} -> ${epoch2.checksum}`);
  check('the active epoch is labelled', (await page.locator('.sky3d-epoch-title').innerText()).includes('EPOCH 2'));

  const toggle = page.locator('.sky3d-toggle input');
  const beforeToggle = await canvasStats(page);
  await toggle.click();
  await delay(700);
  const afterToggle = await canvasStats(page);
  check('hiding the source overlay changes the view', afterToggle.checksum !== beforeToggle.checksum);
  await toggle.click();
  await delay(400);

  await page.locator('.sky3d-source').first().click();
  await page.locator('.sky3d-selected').waitFor({ state: 'visible', timeout: 10_000 });
  const selectedText = (await page.locator('.sky3d-selected').innerText()).replace(/\s+/g, ' ');
  check('selecting a candidate shows its four epochs',
    ['1', '2', '3', '4'].every((epoch) => new RegExp(`(^|\\s)${epoch}(\\s|$)`).test(selectedText)), selectedText);
  check('the candidate is labelled a prototype', /prototype/i.test(selectedText), selectedText.slice(0, 120));
  check('the selected card has a focus action', await page.getByRole('button', { name: /FOCUS IN THIS EPOCH/i }).isVisible());
  await page.getByRole('button', { name: /FOCUS IN THIS EPOCH/i }).click();
  await page.waitForFunction(() => /FOV\s+24\.0°/.test(document.querySelector('.sky3d-readout')?.innerText || ''), null, { timeout: 10_000 });
  check('focusing a candidate narrows the field of view', true);
  await delay(900);
  const focused = await canvasStats(page);
  check('the focused sky is still rendered', focused.fraction > 0.08, JSON.stringify(focused));

  const play = page.locator('.sky3d-play');
  await play.click();
  await delay(700);
  check('PLAY starts the timeline', await play.evaluate((button) => button.classList.contains('on')));
  await play.click();
  await delay(300);
  check('PLAY pauses the timeline', !(await play.evaluate((button) => button.classList.contains('on'))));

  await page.getByRole('button', { name: /RESET VIEW/i }).click();
  await page.waitForFunction(() => /RA\s+00h 00m/.test(document.querySelector('.sky3d-readout')?.innerText || '') && /DEC\s+\+00°/.test(document.querySelector('.sky3d-readout')?.innerText || ''), null, { timeout: 10_000 });
  check('RESET VIEW returns to the illustrative epoch meridian', true);

  const buttons = await page.locator('button').allInnerTexts();
  check('no control offers an epoch difference',
    !buttons.some((label) => /DIFFERENCE|SUBTRACT|DELTA|VARIABILITY/i.test(label)), buttons.join(' | '));

  await page.getByRole('button', { name: /OPEN VALIDATED FIELD/i }).last().click();
  await page.waitForFunction(() => location.hash === '#spherex', null, { timeout: 15_000 });
  await page.locator('.spherex').first().waitFor({ state: 'visible', timeout: 20_000 });
  check('the FIELD bridge lands in the validated tab', page.url().endsWith('#spherex'));
  check('desktop page has no uncaught errors', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
  await delay(500);

  // --- mobile profile --------------------------------------------------------
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const mobileErrors = [];
  mobile.on('pageerror', (error) => mobileErrors.push(error.message));
  await mobile.goto(`${origin}/#spherex3d`, { waitUntil: 'domcontentloaded' });
  await waitForSky(mobile);
  check('mobile selects the low-quality path',
    (await mobile.locator('.sky3d-badges').innerText()).includes('LOW PATH'));
  check('mobile opens the verified regional archive by default',
    (await mobile.locator('.sky3d-badges').innerText()).includes('VERIFIED REGIONAL ARCHIVE'));
  const layout = await mobile.evaluate(() => ({
    scrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    canvas: Boolean(document.querySelector('.sky3d-canvas')),
    stops: document.querySelectorAll('.sky3d-stop').length,
  }));
  check('mobile does not scroll sideways', layout.scrollWidth <= layout.clientWidth + 1,
    `${layout.scrollWidth} > ${layout.clientWidth}`);
  check('mobile keeps the canvas and the two archive observations', layout.canvas && layout.stops === 2);
  const mobileCanvas = await mobile.evaluate(() => {
    const canvas = document.querySelector('.sky3d-canvas');
    return {
      webgl2: Boolean(canvas?.getContext('webgl2')),
      width: canvas?.width ?? 0,
      height: canvas?.height ?? 0,
    };
  });
  check('mobile has a WebGL2 drawing buffer',
    mobileCanvas.webgl2 && mobileCanvas.width > 0 && mobileCanvas.height > 0, JSON.stringify(mobileCanvas));
  check('mobile page has no uncaught errors', mobileErrors.length === 0, mobileErrors.join(' | '));
  // Close the still-streaming mobile page before opening the fallback. Under
  // software WebGL its tile requests can occupy the single Node process and
  // starve the next document request long enough to look like a page failure.
  await mobile.close();
  await delay(300);

  // --- honest no-WebGL fallback ---------------------------------------------
  const fallback = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patched(type, ...args) {
      if (String(type).startsWith('webgl')) return null;
      return original.call(this, type, ...args);
    };
  });
  await fallback.goto(`${origin}/#spherex3d`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await fallback.locator('.sky3d-fatal').waitFor({ state: 'visible', timeout: 20_000 });
  const fallbackText = (await fallback.locator('.sky3d-fatal').innerText()).replace(/\s+/g, ' ');
  check('a no-WebGL browser gets an honest fallback', /could not start/i.test(fallbackText), fallbackText);
  check('the fallback offers the validated FIELD', /OPEN THE VALIDATED FIELD VIEW/i.test(fallbackText));

  console.log('\nSPHEREx 3D acceptance passed.');
} catch (error) {
  console.error('\nSPHEREx 3D acceptance failed.');
  if (serverLog.trim()) console.error(serverLog.trim().split('\n').slice(-20).join('\n'));
  throw error;
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
}
