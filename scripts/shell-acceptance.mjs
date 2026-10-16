// Browser acceptance for the spherical-shell explorer (Mode B — Observe).
// Run on demand:  npm run check:shell
//
// It boots the production server, opens the built client in system Chromium, and
// asserts the shell UI's honest behaviour end to end:
//   * an unknown-distance object is labelled direction-only, not placed in 3D;
//   * the 3D legend separates located, uncertain (radial range) and the sky dome;
//   * a unit change converts the band instead of relabelling it;
//   * cursor pagination surfaces "Load more" and appends records;
//   * pagination cursors are bound to their query server-side, and a refused
//     cursor makes the UI reset to page one rather than fail;
//   * rapid band changes do not let a stale response overwrite the newest;
//   * the canvases are released when the view unmounts;
//   * no uncaught page/console errors.
//
// Open-ended interval rendering and real radial spokes are not asserted here
// because no active source publishes interval evidence yet (see the plan, §17.3).

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const projectRoot = new URL('..', import.meta.url);
const RADIUS = 'input[aria-label="Shell mean radius"]';
const THICKNESS = 'input[aria-label="Shell full thickness"]';
const UNIT = 'select[aria-label="Distance unit"]';
const FOOTER = '.observe-footer .caption';

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve())));
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

const port = await unusedPort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: projectRoot,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port) },
  stdio: 'ignore',
});

const results = [];
const problems = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(name);
}

const shellResponse = (page, radius) => page.waitForResponse(
  (response) => response.url().includes('/api/observe/shell')
    && new URL(response.url()).searchParams.get('radius') === String(radius),
);
const footerCounts = async (page) => {
  const text = await page.locator(FOOTER).innerText();
  const match = text.match(/(\d+) of (\d+) matched records shown/);
  return match ? { returned: Number(match[1]), members: Number(match[2]) } : null;
};
const waitForMembers = (page, members) => page.waitForFunction(
  (expected) => document.querySelector('.observe-footer .caption')?.textContent?.includes(`${expected} matched records shown`),
  members,
  { timeout: 15_000 },
);

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`production server exited with ${server.exitCode}`);
    try {
      if ((await fetch(origin)).ok) { ready = true; break; }
    } catch {}
    await delay(100);
  }
  assert.ok(ready, 'production server did not become ready');

  // 0. Server contract: a cursor is bound to the query that produced it.
  const cursorFirst = await (await fetch(`${origin}/api/observe/shell?limit=10`)).json();
  check('server issues an opaque pagination cursor', typeof cursorFirst.page.next === 'string');
  const nextRes = await fetch(`${origin}/api/observe/shell?limit=10&cursor=${encodeURIComponent(cursorFirst.page.next)}`);
  const nextBody = await nextRes.json();
  check('server continues the query that made the cursor', nextRes.status === 200 && nextBody.page.offset === 10, `status=${nextRes.status} offset=${nextBody.page?.offset}`);
  const staleRes = await fetch(`${origin}/api/observe/shell?radius=250&limit=10&cursor=${encodeURIComponent(cursorFirst.page.next)}`);
  const staleBody = await staleRes.json();
  check(
    'server refuses a cursor from another query',
    staleRes.status === 400 && staleBody.code === 'invalid-cursor' && staleBody.reason === 'mismatch',
    JSON.stringify(staleBody),
  );
  const malformedRes = await fetch(`${origin}/api/observe/shell?cursor=not-a-cursor`);
  const malformedBody = await malformedRes.json();
  check(
    'server refuses a malformed cursor',
    malformedRes.status === 400 && malformedBody.code === 'invalid-cursor' && malformedBody.reason === 'malformed',
    JSON.stringify(malformedBody),
  );

  const systemChromium = process.env.CHROMIUM_PATH
    || ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
  browser = await chromium.launch({
    headless: true,
    ...(systemChromium ? { executablePath: systemChromium } : {}),
    args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });

  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const consoleErrors = [];
  // The browser logs each failed (4xx/5xx) resource load as a generic console
  // error with no URL, so record the actual shell responses to pair them up.
  const failedShellLoads = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.url().includes('/api/observe/shell') && response.status() >= 400) failedShellLoads.push(response.status());
  });

  await page.goto(`${origin}/#observe/star-sirius`, { waitUntil: 'load' });
  await page.locator('.observe-footer').waitFor({ timeout: 30_000 });
  await delay(250);

  // 1. Direction-only honesty and the layer legend.
  const target = await page.locator('.observe-target').innerText();
  check('unknown-distance object is labelled UNKNOWN', /\bUNKNOWN\b/.test(target), target.split('\n')[0]);
  check('unknown distance is shown as direction-only', /unknown \(direction only\)/i.test(target));
  const legend = await page.locator('.observe-legend').innerText();
  check('3D legend names the direction-only sky dome', /sky dome/i.test(legend), legend.replace(/\s+/g, ' ').trim());
  check('3D legend names the uncertain radial range', /radial range/i.test(legend));
  check('linked 2D and 3D canvases render', (await page.locator('.observe-grid canvas').count()) === 2);

  // 2. A unit change converts the canonical band; it does not relabel it.
  await page.fill(RADIUS, '10');
  await page.fill(THICKNESS, '1');
  await page.selectOption(UNIT, 'pc');
  await delay(900);
  const band = await page.locator('.tb-group', { hasText: 'BAND' }).locator('.muted').innerText();
  check('band converts to the selected unit', /9\.50\s*[–-]\s*10\.50\s*pc/.test(band), band.trim());

  // 3. Pagination: a wide band leaves a "Load more" control that appends records.
  const [wideResponse] = await Promise.all([
    shellResponse(page, 1000),
    (async () => {
      await page.fill(RADIUS, '1000');
      await page.selectOption(UNIT, 'ly');
      await page.fill(THICKNESS, '2000');
    })(),
  ]);
  const wideBody = await wideResponse.json();
  await waitForMembers(page, wideBody.counts.members);
  const loadMore = page.locator('.observe-footer button');
  await loadMore.waitFor({ timeout: 15_000 });
  const loadMoreLabel = await loadMore.innerText();
  check('pagination exposes a load-more control', /load \d+ more/i.test(loadMoreLabel), loadMoreLabel.trim());
  const before = await footerCounts(page);
  await loadMore.click();
  await page.waitForFunction(
    (expected) => {
      const match = document.querySelector('.observe-footer .caption')?.textContent?.match(/(\d+) of (\d+) matched records shown/);
      return match && Number(match[1]) > expected;
    },
    before.returned,
    { timeout: 15_000 },
  ).catch(() => {});
  await delay(600);
  const after = await footerCounts(page);
  check('load-more appends records', !!before && !!after && after.returned > before.returned, `${before?.returned} -> ${after?.returned}`);

  // 3b. A cursor the server refuses (band changed mid-flight) resets the view to
  //     page one instead of surfacing a fatal error. We force the race by
  //     rewriting only the cursor-bearing request to a token from nowhere.
  let poisonCursor = false;
  await page.route('**/api/observe/shell**', async (route) => {
    const url = new URL(route.request().url());
    if (poisonCursor && url.searchParams.has('cursor')) {
      url.searchParams.set('cursor', 'stale-cursor-from-another-query');
      await route.continue({ url: url.toString() });
    } else {
      await route.continue();
    }
  });
  poisonCursor = true;
  const reloadResponse = page.waitForResponse(
    (response) => response.url().includes('/api/observe/shell')
      && !new URL(response.url()).searchParams.has('cursor'),
  );
  await loadMore.click();
  await reloadResponse;
  await delay(700);
  const reset = await footerCounts(page);
  check('a refused cursor resets the view to page one', !!reset && reset.returned === 300, JSON.stringify(reset));
  poisonCursor = false;
  await page.unroute('**/api/observe/shell**');

  // 4. Rapid band changes must settle on the newest query.
  const targets = [1500, 1650, 1750, 1850];
  const last = targets[targets.length - 1];
  const lastResponse = shellResponse(page, last);
  for (const radius of targets) {
    await page.fill(RADIUS, String(radius));
    await delay(260);
  }
  const lastBody = await (await lastResponse).json();
  await waitForMembers(page, lastBody.counts.members);
  const finalRadius = await page.locator(RADIUS).inputValue();
  const finalCounts = await footerCounts(page);
  check(
    'fast repeated changes settle on the newest query',
    finalRadius === String(last) && finalCounts?.members === lastBody.counts.members,
    `radius=${finalRadius} footer=${JSON.stringify(await page.locator(FOOTER).innerText())}`,
  );

  // 4. Unmount releases the canvases.
  await page.locator('.nav-tabs button').first().click();
  await page.locator('.observe-footer').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  await delay(300);
  check('unmount releases the shell canvases', (await page.locator('canvas').count()) === 0);

  const realErrors = consoleErrors.filter((message) => !/favicon/i.test(message));
  // Separate the generic "failed resource" notes from real uncaught errors, then
  // require them to account exactly for the shell 4xx responses we caused.
  const failedLoadNotes = realErrors.filter((message) => /status of \d{3}/.test(message));
  const unexpected = realErrors.filter((message) => !/status of \d{3}/.test(message));
  check(
    'no uncaught page or console errors',
    unexpected.length === 0 && failedLoadNotes.length === failedShellLoads.length,
    `${realErrors.length} error(s), ${failedShellLoads.length} shell 4xx, unexpected: ${unexpected.slice(0, 3).join(' | ')}`,
  );
} catch (error) {
  check('acceptance run completed without throwing', false, String(error?.message || error).split('\n')[0]);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

console.log(results.join('\n'));
console.log(`\n${problems.length === 0 ? 'SHELL ACCEPTANCE OK' : `SHELL ACCEPTANCE FAILURES: ${problems.join(', ')}`}`);
process.exit(problems.length === 0 ? 0 : 1);
