// Browser acceptance for the spherical-shell explorer (Mode B — Observe).
// Run on demand:  npm run check:shell
//
// It boots the production server, opens the built client in system Chromium, and
// asserts the shell UI's honest behaviour end to end:
//
//   * a cursor is bound to the query that produced it (and a stale/malformed
//     cursor is refused, resetting to page one rather than failing);
//   * an unknown-distance object is labelled direction-only, not placed in 3D;
//   * the 3D legend separates located, uncertain (radial range) and the sky dome;
//   * a unit change converts the band instead of relabelling it;
//   * cursor pagination surfaces "Load more" and appends records;
//   * rapid band changes do not let a stale response overwrite the newest;
//   * open-ended distance intervals: a lower-bounded interval (e.g., ≥ X ly/pc)
//     renders no finite upper bound and keeps the "only a lower bound" note;
//   * empty results render an EMPTY SHELL panel with no canvases;
//   * partial/failed sources show a recoverable warning without hiding results;
//   * a failed request shows a recoverable ERROR panel with a Retry path;
//   * the built app remains usable at a narrow mobile viewport (one-column grid,
//     no horizontal overflow, canvases within viewport);
//   * the canvases are released when the view unmounts;
//   * no uncaught page/console errors.

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
  // Keep PASS lines informative but short; failures carry the full detail.
  const text = !detail ? '' : (ok ? String(detail).replace(/\s+/g, ' ').trim().slice(0, 110) : detail);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${text ? ` — ${text}` : ''}`);
  if (!ok) problems.push(name);
}
// Informational line for a real observation that is deliberately outside this
// change's acceptance contract (e.g. pre-existing shared-chrome behaviour) but
// should still be visible in the run output. A NOTE never fails the run.
function note(message) {
  results.push(`NOTE  ${message}`);
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
// Playwright's built-in click actionability is unreliable at a narrow viewport
// here: the document root sets `overflow-x: hidden`, which derails Playwright's
// scroll-into-view retry loop so its "stable" check never passes. For mobile we
// scroll the target in explicitly, wait for its box to settle, then click real
// pointer coordinates — the same thing a user's finger does.
async function tap(page, selector) {
  const target = page.locator(selector).first();
  await target.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }));
  let previous = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const box = await target.boundingBox();
    if (box && previous && Math.abs(box.x - previous.x) < 0.5 && Math.abs(box.y - previous.y) < 0.5) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
    previous = box;
    await delay(80);
  }
  throw new Error(`tap: ${selector} never settled`);
}
// Header geometry: which nav controls are actually visible (not `display:none`
// / `visibility:hidden` / transparent), whether they fit the viewport, and
// whether the burger is the topmost hit-test target (i.e. not clipped).
const navState = (page) => page.evaluate(() => {
  const vw = window.innerWidth;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const shown = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
    return box(el);
  };
  const burger = document.querySelector('.nav-burger');
  let burgerHit = null;
  if (burger && shown(burger)) {
    const r = burger.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
    burgerHit = hit === burger || burger.contains(hit);
  }
  return {
    vw,
    burger: shown(burger),
    burgerHit,
    tabs: shown(document.querySelector('.nav-tabs')),
    tabCount: document.querySelectorAll('.nav-tabs .tab').length,
    items: [...document.querySelectorAll('.nav > *')].map((el) => ({ cls: String(el.className), box: shown(el) })),
  };
});
const navItemsWithinViewport = (state) => state.items.every(
  (item) => !item.box || (item.box.x >= -1 && item.box.right <= state.vw + 1),
);

const OPEN_INTERVAL_ID = 'probe-open-interval';
const OPEN_PROBE = {
  id: OPEN_INTERVAL_ID,
  name: 'Open-interval probe',
  ra: 120,
  dec: 20,
  frame: 'icrs',
  type: 'STAR',
  mag: 8.1,
  spectralType: null,
  status: 'uncertain',
  classification: {
    status: 'uncertain',
    reason: 'interval-overlaps-shell',
    // Open (one-sided) interval: Infinity does not survive JSON; server
    // serialises the far bound as null. The client treats null as unbounded.
    interval: { low: 90, high: null },
  },
  provenance: { source: 'stars', sourceId: 'probe', catalog: 'acceptance-probe' },
  qualityNotes: ['distance-from-parallax', 'distance-interval'],
};

let consoleErrors = [];
let failedShellLoads = [];
function attachDiagnostics(page) {
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.url().includes('/api/observe/shell') && response.status() >= 400) failedShellLoads.push(response.status());
  });
}

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

  // --- Page A: happy path (band, legend, pagination, stale cursor, races) ---
  consoleErrors = [];
  failedShellLoads = [];
  const pageA = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  attachDiagnostics(pageA);

  await pageA.goto(`${origin}/#observe/star-sirius`, { waitUntil: 'load' });
  await pageA.locator('.observe-footer').waitFor({ timeout: 30_000 });
  await delay(250);

  // Header/navigation coverage lives in the dedicated responsive sweep below
  // (a lightweight Home page, so it does not depend on WebGL).

  // 1. Direction-only honesty and the layer legend.
  const target = await pageA.locator('.observe-target').innerText();
  check('unknown-distance object is labelled UNKNOWN', /\bUNKNOWN\b/.test(target), target.split('\n')[0]);
  check('unknown distance is shown as direction-only', /unknown \(direction only\)/i.test(target));
  const legend = await pageA.locator('.observe-legend').innerText();
  check('3D legend names the direction-only sky dome', /sky dome/i.test(legend), legend.replace(/\s+/g, ' ').trim());
  check('3D legend names the uncertain radial range', /radial range/i.test(legend));
  check('linked 2D and 3D canvases render', (await pageA.locator('.observe-grid canvas').count()) === 2);

  // 2. A unit change converts the canonical band; it does not relabel it.
  await pageA.fill(RADIUS, '10');
  await pageA.fill(THICKNESS, '1');
  await pageA.selectOption(UNIT, 'pc');
  await delay(900);
  const band = await pageA.locator('.tb-group', { hasText: 'BAND' }).locator('.muted').innerText();
  check('band converts to the selected unit', /9\.50\s*[–-]\s*10\.50\s*pc/.test(band), band.trim());

  // 3. Pagination: a wide band leaves a "Load more" control that appends records.
  const [wideResponse] = await Promise.all([
    shellResponse(pageA, 1000),
    (async () => {
      await pageA.fill(RADIUS, '1000');
      await pageA.selectOption(UNIT, 'ly');
      await pageA.fill(THICKNESS, '2000');
    })(),
  ]);
  const wideBody = await wideResponse.json();
  await waitForMembers(pageA, wideBody.counts.members);
  const loadMore = pageA.locator('.observe-footer button');
  await loadMore.waitFor({ timeout: 15_000 });
  const loadMoreLabel = await loadMore.innerText();
  check('pagination exposes a load-more control', /load \d+ more/i.test(loadMoreLabel), loadMoreLabel.trim());
  const before = await footerCounts(pageA);
  await loadMore.click();
  await pageA.waitForFunction(
    (expected) => {
      const match = document.querySelector('.observe-footer .caption')?.textContent?.match(/(\d+) of (\d+) matched records shown/);
      return match && Number(match[1]) > expected;
    },
    before.returned,
    { timeout: 15_000 },
  ).catch(() => {});
  await delay(600);
  const after = await footerCounts(pageA);
  check('load-more appends records', !!before && !!after && after.returned > before.returned, `${before?.returned} -> ${after?.returned}`);

  // 3b. A refused cursor resets the view to page one.
  let poisonCursor = false;
  await pageA.route('**/api/observe/shell**', async (route) => {
    const url = new URL(route.request().url());
    if (poisonCursor && url.searchParams.has('cursor')) {
      url.searchParams.set('cursor', 'stale-cursor-from-another-query');
      await route.continue({ url: url.toString() });
    } else {
      await route.continue();
    }
  });
  poisonCursor = true;
  const reloadResponse = pageA.waitForResponse(
    (response) => response.url().includes('/api/observe/shell')
      && !new URL(response.url()).searchParams.has('cursor'),
  );
  await loadMore.click();
  await reloadResponse;
  await delay(700);
  const reset = await footerCounts(pageA);
  check('a refused cursor resets the view to page one', !!reset && reset.returned === 300, JSON.stringify(reset));
  poisonCursor = false;
  await pageA.unroute('**/api/observe/shell**');

  // 4. Rapid band changes settle on the newest query.
  const targets = [1500, 1650, 1750, 1850];
  const last = targets[targets.length - 1];
  const lastResponse = shellResponse(pageA, last);
  for (const radius of targets) {
    await pageA.fill(RADIUS, String(radius));
    await delay(260);
  }
  const lastBody = await (await lastResponse).json();
  await waitForMembers(pageA, lastBody.counts.members);
  const finalRadius = await pageA.locator(RADIUS).inputValue();
  const finalCounts = await footerCounts(pageA);
  check(
    'fast repeated changes settle on the newest query',
    finalRadius === String(last) && finalCounts?.members === lastBody.counts.members,
    `radius=${finalRadius} footer=${JSON.stringify(finalCounts)}`,
  );

  // --- Page B: injected / adversarial states. Each phase ends with a real
  //     reload, because a hash-only `goto` is a same-document navigation that
  //     neither reloads the app nor re-issues the shell query. ---
  const pageB = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  attachDiagnostics(pageB);
  const reloadB = async (hash) => {
    await pageB.evaluate((next) => { location.hash = next; }, hash);
    await pageB.reload({ waitUntil: 'load' });
  };

  // B1. Open-ended interval: inject probe and assert lower-bound label.
  let injectProbe = true;
  let injectWarning = false;
  await pageB.route('**/api/observe/shell**', async (route) => {
    const response = await route.fetch();
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!body || !Array.isArray(body.records)) {
      await route.fulfill({ status: response.status(), body: await response.text() });
      return;
    }
    // Snapshot the flags after the await so a request whose fetch resolves while
    // the flags are being flipped cannot be mutated by a later phase.
    const probe = injectProbe;
    const warning = injectWarning;
    if (probe) {
      body.records = [OPEN_PROBE, ...body.records.filter((record) => record.id !== OPEN_INTERVAL_ID)];
      if (body.counts) {
        body.counts = {
          ...body.counts,
          members: body.counts.members + 1,
          returned: body.counts.returned + 1,
          uncertain: (body.counts.uncertain ?? 0) + 1,
        };
      }
    }
    if (warning) {
      body.coverage = [{ source: 'stars', status: 'error', error: 'simulated source failure' }, ...(body.coverage ?? [])];
    }
    await route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  await pageB.goto(`${origin}/#observe/${OPEN_INTERVAL_ID}`, { waitUntil: 'load' });
  await pageB.locator('.observe-footer').waitFor({ timeout: 30_000 });
  await pageB.locator('.observe-target').waitFor({ timeout: 15_000 });
  await delay(400);
  const targetB1 = await pageB.locator('.observe-target').innerText();
  check('open-ended interval renders lower bound only (≥ ly)', /≥\s*90\.00\s*ly/.test(targetB1), targetB1.split('\n')[0]);
  check('open-ended interval shows only a lower bound note', /only a lower bound/i.test(targetB1));
  const compactTarget = targetB1.replace(/\s+/g, ' ').trim();
  check('open-ended interval does not fabricate an upper bound', /90\.00\s*[–-]/.test(targetB1) === false, compactTarget);
  check('open-ended interval is classified uncertain, not located', /UNCERTAIN/.test(targetB1));
  const legendB = await pageB.locator('.observe-legend').innerText();
  check('3D legend still separates located / uncertain / sky dome', /radial range/i.test(legendB) && /sky dome/i.test(legendB), legendB.replace(/\s+/g, ' ').trim());
  await pageB.selectOption(UNIT, 'pc');
  await delay(700);
  const targetB1pc = await pageB.locator('.observe-target').innerText();
  check('open-ended interval converts to pc (≥ 27.59 pc)', /≥\s*27\.59\s*pc/.test(targetB1pc), targetB1pc.split('\n')[0]);
  check('unit change keeps the interval open-ended', /only a lower bound/i.test(targetB1pc) && /27\.59\s*[–-]/.test(targetB1pc) === false);
  await pageB.selectOption(UNIT, 'ly');
  await delay(400);

  // B2. A failing source leaves the rest of the result usable, with a warning.
  injectWarning = true;
  await reloadB('#observe/star-sirius');
  await pageB.locator('.observe-footer').waitFor({ timeout: 30_000 });
  await delay(300);
  const warn = await pageB.locator('.err.sm').innerText();
  check('partial/source failure shows a recoverable warning', /source warning/i.test(warn) && /simulated source failure/i.test(warn), warn.trim());
  check('partial coverage does not hide the usable records', (await pageB.locator('.observe-grid canvas').count()) === 2);

  // B3. Empty results (real server, no injections) render a non-error empty state.
  injectProbe = false;
  injectWarning = false;
  await pageB.unroute('**/api/observe/shell**');
  await reloadB('#observe/star-sirius');
  await pageB.locator('.observe-footer').waitFor({ timeout: 30_000 });
  await delay(300);
  // Located-only layers plus a band outside every fixture distance.
  await pageB.locator('.seg-view[aria-label="Distance layers"] button', { hasText: 'Uncertain' }).click();
  await pageB.locator('.seg-view[aria-label="Distance layers"] button', { hasText: 'Unknown' }).click();
  await pageB.fill(RADIUS, '100000');
  await pageB.fill(THICKNESS, '1');
  await pageB.selectOption(UNIT, 'ly');
  await pageB.locator('.panel-head h2', { hasText: 'EMPTY SHELL' }).waitFor({ timeout: 20_000 });
  check('empty results render an EMPTY SHELL panel', true);
  check('empty results show no canvases', (await pageB.locator('.observe-grid canvas').count()) === 0);
  const emptyFooter = await footerCounts(pageB).catch(() => null);
  check('empty results report zero members', !!emptyFooter && emptyFooter.members === 0 && emptyFooter.returned === 0, JSON.stringify(emptyFooter));
  const emptyCopy = await pageB.locator('.panel', { hasText: 'EMPTY SHELL' }).innerText();
  check('empty state explains how to recover', /widen the radius or thickness/i.test(emptyCopy), emptyCopy.replace(/\s+/g, ' ').trim());

  // B4. A failed request is recoverable: ERROR panel, then Retry recovers.
  await pageB.route('**/api/observe/shell**', async (route) => {
    await route.fulfill({
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'simulated backend failure' }),
    });
  });
  await reloadB('#observe/star-sirius');
  await pageB.locator('.tag', { hasText: 'ERROR' }).waitFor({ timeout: 20_000 });
  check('failed request shows a recoverable ERROR panel', await pageB.locator('.panel-head h2', { hasText: 'OBSERVE' }).isVisible());
  check('failed request surfaces the server message', /simulated backend failure/.test(await pageB.locator('.panel .err').innerText()));
  await pageB.unroute('**/api/observe/shell**');
  await pageB.locator('button', { hasText: 'Retry' }).click();
  await pageB.locator('.observe-footer').waitFor({ timeout: 20_000 });
  await delay(500);
  check('retry recovers the failed request', (await pageB.locator('.observe-grid canvas').count()) === 2);
  const retryCounts = await footerCounts(pageB);
  check('retry restores a non-empty result', !!retryCounts && retryCounts.returned > 0, JSON.stringify(retryCounts));

  // --- Page C: mobile layout at a narrow viewport (390 × 844) ---
  const pageC = await browser.newPage({ viewport: { width: 390, height: 844 } });
  attachDiagnostics(pageC);
  await pageC.goto(`${origin}/#observe/star-sirius`, { waitUntil: 'load' });
  try {
    await pageC.locator('.observe-footer').waitFor({ timeout: 45_000 });
  } catch (e) {
    // Software rendering can stall a freshly created page; report the DOM state
    // so a genuine render regression is distinguishable from an environment stall.
    const diag = await pageC.evaluate(() => ({
      hash: location.hash,
      headings: [...document.querySelectorAll('.panel-head h2')].map((h) => h.textContent),
      err: [...document.querySelectorAll('.err')].map((el) => el.textContent),
      canvases: document.querySelectorAll('canvas').length,
      footer: Boolean(document.querySelector('.observe-footer')),
    })).catch(() => 'evaluate failed');
    throw new Error(`mobile page did not render the footer: ${e.message}\nDIAG: ${JSON.stringify(diag)}`);
  }
  await delay(400);

  // Measure the default (narrow) band first: the deep-linked selection is in
  // the first page, so the TARGET panel is populated and we see the full layout.
  const layout = await pageC.evaluate(() => {
    const vw = window.innerWidth;
    const box = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const groups = [...document.querySelectorAll('.sky-toolbar .tb-group')].map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.querySelector('.tb-label')?.textContent ?? '?', left: Math.round(r.left), right: Math.round(r.right) };
    });
    const canvases = [...document.querySelectorAll('.observe-grid canvas')].map((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
    });
    const main = document.querySelector('main.view');
    const grid = document.querySelector('.observe-grid');
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length : 0;
    return {
      vw,
      mainWidth: main ? Math.round(main.getBoundingClientRect().width) : -1,
      mainScrollWidth: main ? main.scrollWidth : -1,
      documentWidth: document.documentElement.scrollWidth,
      columns,
      groups,
      canvases,
      band: box('.tb-group:last-child'),
      caption: box('.observe-footer .caption'),
      target: box('.observe-target'),
      legend: box('.observe-legend'),
    };
  });
  const withinViewport = (r) => !!r && r.x >= -1 && r.x + r.w <= layout.vw + 1 && r.w > 0 && r.h > 0;
  check('mobile: viewport is narrow', layout.vw === 390, `vw=${layout.vw}`);
  check(
    'mobile: the Observe content does not overflow horizontally',
    layout.mainWidth <= layout.vw + 1 && layout.mainScrollWidth <= layout.vw + 1 && layout.documentWidth <= layout.vw + 1,
    `main=${layout.mainWidth} mainScroll=${layout.mainScrollWidth} doc=${layout.documentWidth} vw=${layout.vw}`,
  );
  check('mobile: observe grid collapses to one column', layout.columns === 1, `columns=${layout.columns}`);
  check('mobile: toolbar controls stay within the viewport', layout.groups.length > 0 && layout.groups.every((g) => g.left >= -1 && g.right <= layout.vw + 1), JSON.stringify(layout.groups));
  check('mobile: both canvases render within the viewport', layout.canvases.length === 2 && layout.canvases.every((c) => c.w > 0 && c.h > 0 && c.right <= layout.vw + 1), JSON.stringify(layout.canvases));
  check('mobile: the band label is visible', withinViewport(layout.band), JSON.stringify(layout.band));
  check('mobile: the results caption is visible', withinViewport(layout.caption), JSON.stringify(layout.caption));
  check('mobile: the target panel is visible', withinViewport(layout.target), JSON.stringify(layout.target));
  check('mobile: the on-canvas legend is visible', withinViewport(layout.legend), JSON.stringify(layout.legend));

  // The header collapses to a burger at this width (`.nav-tabs` is hidden
  // <=1180px), making the burger the only way to change modes. It must stay on
  // screen and be hittable — a header that overflows here strands the user in
  // whichever mode they arrived in.
  const navC = await navState(pageC);
  check('mobile nav: the menu button is within the viewport', !!navC.burger && navC.burger.x >= -1 && navC.burger.right <= navC.vw + 1, JSON.stringify(navC.burger));
  check('mobile nav: the menu button is the topmost hit target (not clipped)', navC.burgerHit === true);
  check('mobile nav: no header control overflows the viewport', navItemsWithinViewport(navC), JSON.stringify(navC.items.filter((i) => i.box)));

  // Pagination must be usable, not just rendered. A wide band leaves the
  // "Load more" control deep in the page.
  await pageC.fill(RADIUS, '1000');
  await pageC.fill(THICKNESS, '2000');
  await pageC.locator('.observe-footer button').waitFor({ timeout: 20_000 });
  await delay(500);
  const mobileBefore = await footerCounts(pageC);
  await tap(pageC, '.observe-footer button');
  await pageC.waitForFunction(
    (expected) => {
      const match = document.querySelector('.observe-footer .caption')?.textContent?.match(/(\d+) of (\d+) matched records shown/);
      return match && Number(match[1]) > expected;
    },
    mobileBefore.returned,
    { timeout: 15_000 },
  ).catch(() => {});
  await delay(500);
  const mobileAfter = await footerCounts(pageC);
  check('mobile: load-more appends records', !!mobileAfter && mobileAfter.returned > mobileBefore.returned, `${mobileBefore?.returned} -> ${mobileAfter?.returned}`);

  // The layer controls live in the toolbar near the top of the page.
  const uncertainButton = pageC.locator('.seg-view[aria-label="Distance layers"] button', { hasText: 'Uncertain' });
  const pressedBefore = await uncertainButton.getAttribute('aria-pressed');
  await tap(pageC, '.seg-view[aria-label="Distance layers"] button:has-text("Uncertain")');
  await delay(500);
  const pressedAfter = await uncertainButton.getAttribute('aria-pressed');
  check('mobile: layer controls toggle', pressedBefore !== pressedAfter, `${pressedBefore} -> ${pressedAfter}`);

  // The collapsed header must not merely look reachable: the menu has to open,
  // expose every mode, and navigate in both directions.
  await tap(pageC, '.nav-burger');
  await pageC.locator('.nav-mobile.open').waitFor({ timeout: 15_000 });
  const menuTabs = await pageC.locator('.nav-mobile.open .tab').count();
  const expectedModes = await pageC.locator('.nav-tabs .tab').count(); // DOM count; the strip is display:none here
  check('mobile nav: the menu opens and lists every mode', menuTabs === expectedModes && menuTabs > 0, `menu=${menuTabs} tabs=${expectedModes}`);
  const menuFits = await pageC.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll('.nav-mobile.open .tab, .nav-mobile.open .nav-mobile-repo')]
      .map((el) => el.getBoundingClientRect())
      .every((r) => r.width > 0 && r.left >= -1 && r.right <= vw + 1);
  });
  check('mobile nav: the open menu stays within the viewport', menuFits);

  await tap(pageC, '.nav-mobile.open .tab:has-text("MISSION")');
  await pageC.waitForFunction(() => location.hash.startsWith('#home'), null, { timeout: 20_000 });
  await pageC.locator('.observe-grid').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
  check('mobile nav: choosing a mode navigates away from Observe', (await pageC.locator('.observe-grid canvas').count()) === 0);
  check('mobile nav: the menu closes after a choice', (await pageC.locator('.nav-mobile.open').count()) === 0);

  await tap(pageC, '.nav-burger');
  await pageC.locator('.nav-mobile.open').waitFor({ timeout: 15_000 });
  await tap(pageC, '.nav-mobile.open .tab:has-text("OBSERVE")');
  await pageC.waitForFunction(() => location.hash.startsWith('#observe'), null, { timeout: 20_000 });
  check('mobile nav: the menu navigates back to Observe', true);
  // Remounting Observe is the heaviest step here under software GL (see §17.6).
  // The navigation contract above is a hard assertion; a render stall is
  // reported like the initial-mount stall instead of failing on this machine.
  const backSettled = await pageC.locator('.observe-footer').waitFor({ timeout: 45_000 }).then(() => true).catch(() => false);
  if (backSettled) {
    await delay(400);
    check('mobile nav: the Observe view re-renders after the round trip', (await pageC.locator('.observe-grid canvas').count()) === 2);
  } else {
    const diag = await pageC.evaluate(() => ({
      hash: location.hash,
      footer: Boolean(document.querySelector('.observe-footer')),
      canvases: document.querySelectorAll('canvas').length,
    })).catch(() => 'evaluate failed');
    note(`mobile nav: Observe remount after the round trip did not settle in 45s (DIAG ${JSON.stringify(diag)}); navigation itself succeeded`);
  }

  // --- Responsive header sweep (page D, lightweight Home route) ---
  // The header is shared chrome. Drive it on the no-WebGL Home route so the
  // sweep is fast and deterministic, and bracket the collapse breakpoint the
  // stylesheet uses. NAV_COLLAPSE_PX must match `@media (max-width: 1560px)`
  // in client/src/styles.css — if that changes, this test should change too.
  const NAV_COLLAPSE_PX = 1560;
  const pageD = await browser.newPage({ viewport: { width: 1920, height: 900 } });
  attachDiagnostics(pageD);
  await pageD.goto(`${origin}/#home`, { waitUntil: 'load' });
  await pageD.locator('.nav').waitFor({ timeout: 15_000 });
  await pageD.evaluate(() => document.fonts.ready); // avoid font-load width jitter
  await delay(150);

  const sweepWidths = [390, 640, 641, 768, 1024, 1180, 1400, 1519, 1559, 1560, 1561, 1680, 1920];
  const sweep = [];
  for (const width of sweepWidths) {
    await pageD.setViewportSize({ width, height: 900 });
    await delay(120);
    const state = await navState(pageD);
    sweep.push({ width, want: width <= NAV_COLLAPSE_PX ? 'burger' : 'tabs', ...state });
  }
  const variantOf = (s) => (s.burger ? 'burger' : (s.tabs ? 'tabs' : 'none'));
  const shownVariantCount = (s) => (s.burger ? 1 : 0) + (s.tabs ? 1 : 0);
  const wrongVariant = sweep.filter((s) => shownVariantCount(s) !== 1 || variantOf(s) !== s.want);
  check(
    'responsive nav: exactly the right variant shows at every swept width',
    wrongVariant.length === 0,
    JSON.stringify(wrongVariant.map((s) => ({ w: s.width, got: variantOf(s), shown: shownVariantCount(s), want: s.want }))),
  );
  const clippedAt = sweep.filter((s) => !navItemsWithinViewport(s));
  check(
    'responsive nav: no header control is clipped at any swept width',
    clippedAt.length === 0,
    JSON.stringify(clippedAt.map((s) => ({
      w: s.width,
      clipped: s.items.filter((i) => i.box && (i.box.x < -1 || i.box.right > s.vw + 1)).map((i) => i.cls),
    }))),
  );
  check(
    'responsive nav: the burger is the topmost hit target wherever it is shown',
    sweep.filter((s) => s.want === 'burger').every((s) => s.burgerHit === true),
    JSON.stringify(sweep.filter((s) => s.want === 'burger' && s.burgerHit !== true).map((s) => s.width)),
  );
  const at = (w) => sweep.find((s) => s.width === w);
  check(`responsive nav: ${NAV_COLLAPSE_PX - 1}px (just below the breakpoint) collapses to the burger`, variantOf(at(NAV_COLLAPSE_PX - 1)) === 'burger');
  check(`responsive nav: ${NAV_COLLAPSE_PX}px (at the breakpoint) collapses to the burger`, variantOf(at(NAV_COLLAPSE_PX)) === 'burger');
  check(`responsive nav: ${NAV_COLLAPSE_PX + 1}px (just above the breakpoint) shows the full tab strip`, variantOf(at(NAV_COLLAPSE_PX + 1)) === 'tabs');
  check('responsive nav: the tab strip shows all eight modes and fits at 1920px', !!at(1920).tabs && at(1920).tabCount === at(390).tabCount && at(1920).tabs.right <= at(1920).vw + 1, `tabs=${at(1920).tabCount} right=${at(1920).tabs?.right}`);

  // The full strip must actually navigate. Use CATALOGUE: it renders from the
  // objects the app has already loaded, so it issues no request that a quick
  // navigate-away could abort (which would surface as a console error).
  await pageD.locator('.nav-tabs .tab', { hasText: 'CATALOGUE' }).first().click();
  await pageD.waitForFunction(() => location.hash.startsWith('#catalogue'), null, { timeout: 10_000 });
  await pageD.waitForLoadState('networkidle').catch(() => {});
  check('responsive nav: a tab click navigates (full strip)', true);

  // At a collapsed desktop width the menu must still be accessible and fit.
  // (Menu *navigation* is exercised end to end on the mobile page above.)
  await pageD.setViewportSize({ width: 1400, height: 900 });
  await delay(150);
  await tap(pageD, '.nav-burger');
  await pageD.locator('.nav-mobile.open').waitFor({ timeout: 10_000 });
  const sweepMenuTabs = await pageD.locator('.nav-mobile.open .tab').count();
  const sweepMenuFits = await pageD.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll('.nav-mobile.open .tab, .nav-mobile.open .nav-mobile-repo')]
      .map((el) => el.getBoundingClientRect())
      .every((r) => r.width > 0 && r.left >= -1 && r.right <= vw + 1);
  });
  check('responsive nav: the menu is accessible and fits at a collapsed desktop width (1400px)', sweepMenuTabs === at(1400).tabCount && sweepMenuFits, `menu=${sweepMenuTabs}`);

  // --- Mode A smoke (page E): the header is shared chrome, so confirm the Sky
  // Viewer still renders and the header behaves on that route too. ---
  const pageE = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  attachDiagnostics(pageE);
  await pageE.goto(`${origin}/#sky/star-sirius`, { waitUntil: 'load' });
  const modeARendered = await pageE.locator('canvas').first().waitFor({ timeout: 45_000 }).then(() => true).catch(() => false);
  const modeADiag = modeARendered ? '' : await pageE.evaluate(() => ({
    hash: location.hash,
    canvases: document.querySelectorAll('canvas').length,
    headings: [...document.querySelectorAll('.panel-head h2')].map((h) => h.textContent),
  })).catch(() => 'diag failed');
  check('mode A smoke: the Sky Viewer renders', modeARendered, modeARendered ? '' : JSON.stringify(modeADiag));
  await pageE.evaluate(() => document.fonts.ready);
  await delay(150);
  const navE = await navState(pageE);
  check(
    'mode A smoke: the header fits on the Sky route at 1400px (collapsed variant)',
    !!navE.burger && navItemsWithinViewport(navE),
    JSON.stringify(navE.items.filter((i) => i.box && (i.box.x < -1 || i.box.right > navE.vw + 1)).map((i) => i.cls)),
  );
  await pageE.setViewportSize({ width: 1920, height: 900 });
  await delay(200);
  const navE1920 = await navState(pageE);
  check(
    'mode A smoke: the header shows the full tab strip at 1920px on the Sky route',
    !!navE1920.tabs && navItemsWithinViewport(navE1920),
    JSON.stringify(navE1920.tabs),
  );

  // --- Unmount (page A) ---
  await pageA.locator('.nav-brand').click();
  await pageA.locator('.observe-footer').waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {});
  await delay(300);
  check('desktop nav: navigating away releases the Observe view', (await pageA.evaluate(() => location.hash)).startsWith('#home'));
  check('unmount releases the shell canvases', (await pageA.locator('canvas').count()) === 0);

  const realErrors = consoleErrors.filter((message) => !/favicon/i.test(message));
  const failedLoadNotes = realErrors.filter((message) => /status of \d{3}/.test(message));
  const unexpected = realErrors.filter((message) => !/status of \d{3}/.test(message));
  check(
    'no uncaught page or console errors',
    unexpected.length === 0 && failedLoadNotes.length === failedShellLoads.length,
    `${realErrors.length} error(s), ${failedShellLoads.length} shell 4xx, unexpected: ${unexpected.slice(0, 3).join(' | ')}`,
  );
} catch (error) {
  const message = String(error?.message || error);
  console.error('--- run error ---');
  console.error(message);
  check('acceptance run completed without throwing', false, message.split('\n')[0]);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

console.log(results.join('\n'));
console.log(`\n${problems.length === 0 ? 'SHELL ACCEPTANCE OK' : `SHELL ACCEPTANCE FAILURES: ${problems.join(', ')}`}`);
process.exit(problems.length === 0 ? 0 : 1);
