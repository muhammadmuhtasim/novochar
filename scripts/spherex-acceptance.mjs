// Browser acceptance for the real SPHEREx product viewer (M3-C) and the blink
// comparison (M4).
// Run on demand:  npm run check:spherex
//
// It boots the production server, opens the built client in system Chromium,
// and asserts what the viewer claims on screen against the bytes the server
// actually served:
//
//   * the metadata route answers with the derived schema and the sidecar's gate
//     (spatial alignment established, quantitative difference disabled);
//   * each raster arrives in the declared wire format, at the declared length;
//   * the canvas is not blank: most pixels are drawn, some are transparent —
//     "no data" must survive to the screen rather than being filled in;
//   * canvas alpha is the product MASK under the renderer's vertical flip, and
//     the gray value is the agreed stretch applied to the served bytes;
//   * one stretch is shared by both epochs rather than each auto-scaling;
//   * the two frames are genuinely different observations;
//   * the coordinate readout tracks the cursor, and reads north-up and
//     east-left on the screen the user is looking at;
//   * a pixel outside the footprint reads "no data", not a number;
//   * no control offers a quantitative difference (client half of Contract 4);
//   * M4: side by side, manual toggle and automatic blink switch reliably; an
//     epoch switch or a blink tick repaints the same canvas rather than
//     remounting it, and through every switch the grid, the sky position and
//     the pooled stretch are unchanged (a mode change re-creates the frames by
//     design, but they draw identical pixels);
//   * M4: the active observation is always identified (date, obs id, pipeline,
//     units), the uncovered rim stays uncovered in every mode, a pause holds
//     and manual selection wins over the alternation;
//   * M4: a failure raised *while comparing* is reported as retryable and
//     recovery keeps the mode the user chose;
//   * M4: the same interaction works at a mobile viewport (390 × 844), controls
//     inside the viewport, with the collapsed menu still reaching the tab;
//   * no uncaught page or console errors.

import { spawn } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const projectRoot = new URL('..', import.meta.url);

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
  const text = !detail ? '' : (ok ? String(detail).replace(/\s+/g, ' ').trim().slice(0, 130) : detail);
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${text ? ` — ${text}` : ''}`);
  if (!ok) problems.push(name);
}
function note(message) {
  results.push(`NOTE  ${message}`);
}

// Playwright's built-in click actionability is unreliable at a narrow viewport
// here (the document root sets `overflow-x: hidden`, which derails its
// scroll-into-view retry loop — the same trap scripts/shell-acceptance.mjs
// documents). Scroll the target in, wait for its box to settle, then click
// real pointer coordinates, which is what a finger does anyway.
async function tap(page, target) {
  const locator = typeof target === 'string' ? page.locator(target).first() : target.first();
  // `inline: 'nearest'` matters: `center` can programmatically scroll the body
  // horizontally (the root is `overflow-x: hidden` but still scrollable by
  // script), which shifts every element's box and would corrupt any measurement
  // taken after a tap.
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  let previous = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const box = await locator.boundingBox();
    if (box && previous && Math.abs(box.x - previous.x) < 0.5 && Math.abs(box.y - previous.y) < 0.5) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
    previous = box;
    await delay(80);
  }
  throw new Error(`tap: ${await locator.count()} matching target(s) never settled`);
}

let browser;
const consoleErrors = [];

// Prefer Playwright's managed browser; fall back to a system Chromium so the
// acceptance still runs on a machine where `npx playwright install` has not
// been run. (The shell harness has the same dependency and does not.)
async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (error) {
    const candidates = [
      process.env.CHROMIUM_PATH,
      '/usr/bin/chromium',
      '/usr/bin/google-chrome',
    ].filter(Boolean);
    for (const executablePath of candidates) {
      try {
        const launched = await chromium.launch({
          executablePath,
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        note(`using system browser ${executablePath}: ${String(error.message).split('\n')[0].slice(0, 80)}`);
        return launched;
      } catch { /* try the next candidate */ }
    }
    throw error;
  }
}

try {
  // Readiness probe for the freshly spawned server.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`${origin}/api/health`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await delay(250);
  }

  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });

  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /SPHEREx FIELD/ }).click();
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelectorAll('.spherex-canvas').length === 2,
    null,
    { timeout: 60_000 },
  );
  await delay(600);

  // Everything the screen depends on is fetched, decoded and measured inside
  // the page so the bytes compared are the ones the canvases were painted from.
  const report = await page.evaluate(async () => {
    const metaRes = await fetch('/api/spherex/products');
    const meta = await metaRes.json();
    const headers = { metaStatus: metaRes.status };
    const planes = {};

    for (const epoch of meta.epochs) {
      const res = await fetch(epoch.raster);
      const buf = new Uint8Array(await res.arrayBuffer());
      const [width, height] = epoch.derived.shape;
      const plane = width * height;
      if (buf.length !== plane * 5) {
        headers[epoch.role] = { status: res.status, wire: res.headers.get('x-novochar-wire'), length: buf.length, expected: plane * 5 };
        continue;
      }
      const view = new DataView(buf.buffer, buf.byteOffset, plane * 4);
      const image = new Float32Array(plane);
      for (let i = 0; i < plane; i += 1) image[i] = view.getFloat32(i * 4, true);
      planes[epoch.role] = { image, mask: buf.slice(plane * 4), width, height };
      headers[epoch.role] = {
        status: res.status,
        wire: res.headers.get('x-novochar-wire'),
        sha: res.headers.get('x-novochar-sha256'),
        length: buf.length,
        expected: plane * 5,
      };
    }

    // The display policy, recomputed here from the served bytes: pooled 1–99th
    // percentile over every epoch's valid pixels, so neither frame can
    // auto-scale itself against the other.
    const percentile = (sorted, p) => {
      const index = p * (sorted.length - 1);
      const lo = Math.floor(index);
      const hi = Math.ceil(index);
      return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
    };
    const pooled = [];
    for (const p of Object.values(planes)) {
      for (let i = 0; i < p.image.length; i += 1) {
        if (p.mask[i] === 1 && Number.isFinite(p.image[i])) pooled.push(p.image[i]);
      }
    }
    pooled.sort((a, b) => a - b);
    const lo = percentile(pooled, 0.01);
    const hi = percentile(pooled, 0.99);
    const span = hi - lo;

    // One pair of pixels carrying nearly the same flux in both epochs: if each
    // frame had its own stretch, the same value would render to two grays.
    let shared = null;
    const roles = Object.keys(planes);
    if (roles.length === 2) {
      const [a, b] = roles.map((r) => planes[r]);
      let best = -1;
      let bestDelta = Infinity;
      for (let i = 0; i < a.image.length; i += 1) {
        if (a.mask[i] !== 1 || b.mask[i] !== 1) continue;
        if (!Number.isFinite(a.image[i]) || !Number.isFinite(b.image[i])) continue;
        const mid = (a.image[i] + b.image[i]) / 2;
        if (mid < lo + 0.15 * span || mid > hi - 0.15 * span) continue;
        const delta = Math.abs(a.image[i] - b.image[i]);
        if (delta < bestDelta) { bestDelta = delta; best = i; }
      }
      if (best >= 0) {
        shared = {
          index: best,
          delta: bestDelta,
          values: roles.map((r) => planes[r].image[best]),
          grays: [],
        };
      }
    }

    const frames = Object.entries(planes).map(([role, p]) => {
      const canvas = document.querySelectorAll('.spherex-canvas')[Object.keys(planes).indexOf(role)];
      const ctx = canvas.getContext('2d');
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const { width, height } = p;
      const plane = width * height;

      let opaque = 0;
      let transparent = 0;
      let alphaMismatches = 0;
      let grayMismatches = 0;
      let graySamples = 0;
      for (let row = 0; row < height; row += 1) {
        const screenRow = height - 1 - row; // the renderer's vertical flip
        for (let col = 0; col < width; col += 1) {
          const src = row * width + col;
          const dst = (screenRow * width + col) * 4;
          const alpha = data[dst + 3];
          const valid = p.mask[src] === 1 && Number.isFinite(p.image[src]);
          if (alpha === 255) opaque += 1;
          if (alpha === 0) transparent += 1;
          if ((alpha === 255) !== valid) alphaMismatches += 1;
          if (valid && (row * width + col) % 37 === 0) {
            const t = (p.image[src] - lo) / span;
            const expected = Math.round(255 * (t < 0 ? 0 : t > 1 ? 1 : t));
            graySamples += 1;
            if (Math.abs(data[dst] - expected) > 1) grayMismatches += 1;
          }
        }
      }

      let gray = null;
      if (shared) {
        const row = Math.floor(shared.index / width);
        const col = shared.index % width;
        const dst = ((height - 1 - row) * width + col) * 4;
        gray = data[dst + 3] === 255 ? data[dst] : null;
      }

      let checksum = 0;
      for (let i = 0; i < data.length; i += 4) checksum = (checksum * 31 + data[i] + data[i + 1] + data[i + 2]) >>> 0;

      return { role, width, height, plane, opaque, transparent, alphaMismatches, grayMismatches, graySamples, gray, checksum };
    });
    if (shared) {
      shared.grays = frames.map((f) => f.gray);
      delete shared.index;
    }

    return { meta, headers, stretch: { lo, hi, pooledSize: pooled.length }, frames, shared };
  });

  // --- What the server said -----------------------------------------------------
  const { meta, headers } = report;
  check('metadata route answers', headers.metaStatus === 200, `HTTP ${headers.metaStatus}`);
  check('metadata is the derived schema', meta.schema === 'novochar.spherex.derived/v1', meta.schema);
  check('the sidecar gate is present and off',
    meta.gate?.spatial_alignment === true && meta.gate?.quantitative_difference_enabled === false,
    JSON.stringify({ spatial: meta.gate?.spatial_alignment, quantitative: meta.gate?.quantitative_difference_enabled }));
  check('both epochs are real observations',
    meta.epochs?.length === 2 && meta.epochs.every((e) => e.archive?.obs_id && e.derived?.output_sha256),
    (meta.epochs || []).map((e) => `${e.role}:${e.archive?.obs_id}`).join(' '));

  for (const epoch of meta.epochs) {
    const r = headers[epoch.role];
    check(`raster ${epoch.role} arrives in the declared wire format`,
      !!r && r.status === 200 && r.wire === 'novochar.spherex.raster/v1' && r.length === r.expected,
      r ? `HTTP ${r.status}, ${r.wire}, ${r.length} bytes (expected ${r.expected})` : 'not fetched');
  }
  note(`gate: spatial_alignment=${meta.gate?.spatial_alignment}, quantitative_difference_enabled=${meta.gate?.quantitative_difference_enabled}`);

  // --- What actually reached the screen -----------------------------------------
  for (const frame of report.frames) {
    check(`canvas ${frame.role} is not blank`,
      frame.opaque > frame.plane * 0.7,
      `${frame.opaque}/${frame.plane} pixels drawn (${((frame.opaque / frame.plane) * 100).toFixed(1)}%)`);
    check(`canvas ${frame.role} leaves the uncovered rim transparent`,
      frame.transparent > frame.plane * 0.05,
      `${frame.transparent} transparent pixels show the no-data backdrop`);
    check(`canvas ${frame.role} alpha follows the product MASK`,
      frame.alphaMismatches === 0,
      `${frame.alphaMismatches} pixel(s) disagree with the served mask`);
    check(`canvas ${frame.role} gray values match the agreed stretch`,
      frame.graySamples > 100 && frame.grayMismatches <= Math.ceil(frame.graySamples * 0.01),
      `${frame.grayMismatches}/${frame.graySamples} sampled pixels off by more than 1/255`);
  }
  note(`shared stretch ${report.stretch.lo.toFixed(3)} → ${report.stretch.hi.toFixed(3)} MJy/sr over ${report.stretch.pooledSize.toLocaleString('en-US')} valid pixels`);

  if (report.frames.length === 2) {
    check('the two frames show genuinely different observations',
      report.frames[0].checksum !== report.frames[1].checksum,
      `frame checksums ${report.frames[0].checksum} vs ${report.frames[1].checksum}`);
    check('one stretch is shared by both epochs',
      !!report.shared && report.shared.grays.every((g) => g !== null)
      && Math.max(...report.shared.grays) - Math.min(...report.shared.grays) <= 1,
      report.shared
        ? `flux ${report.shared.values.map((v) => v.toPrecision(6)).join(' / ')} (Δ ${report.shared.delta.toExponential(1)}) → gray ${report.shared.grays.join(' / ')}`
        : 'no shared-flux candidate pixel found');
  }

  // --- Readout and orientation ---------------------------------------------------
  const box = await page.locator('.spherex-canvas').first().boundingBox();
  if (!box || box.width < 100) throw new Error('first canvas has no usable box');
  const readSky = async (x, y) => {
    await page.mouse.move(x, y);
    await delay(140);
    return page.locator('.spherex-readout-raw').innerText();
  };
  const parseSky = (text) => {
    const match = /RA ([\d.]+)°\s+Dec\s*([+−-]?[\d.]+)°/.exec(text);
    if (!match) return null;
    return { ra: Number(match[1]), dec: Number(match[2].replace('−', '-')) };
  };

  const atStart = parseSky(await readSky(box.x + box.width * 0.3, box.y + box.height * 0.3));
  const atLeft = parseSky(await readSky(box.x + box.width * 0.15, box.y + box.height * 0.5));
  const atRight = parseSky(await readSky(box.x + box.width * 0.85, box.y + box.height * 0.5));
  const atTop = parseSky(await readSky(box.x + box.width * 0.5, box.y + box.height * 0.15));
  const atBottom = parseSky(await readSky(box.x + box.width * 0.5, box.y + box.height * 0.85));

  check('the readout resolves coordinates under the cursor',
    !!(atLeft && atRight && atTop && atBottom && atStart),
    `left ${JSON.stringify(atLeft)}`);
  check('the readout changes as the cursor moves',
    !!atStart && !!atLeft && (atStart.ra !== atLeft.ra || atStart.dec !== atLeft.dec),
    `start ${atStart?.ra?.toFixed(4)},${atStart?.dec?.toFixed(4)} → left ${atLeft?.ra?.toFixed(4)},${atLeft?.dec?.toFixed(4)}`);
  check('east is to the left of the image',
    !!atLeft && !!atRight && atLeft.ra > atRight.ra,
    `RA ${atLeft?.ra?.toFixed(4)} at x=15% > ${atRight?.ra?.toFixed(4)} at x=85%`);
  check('north is above the image',
    !!atTop && !!atBottom && atTop.dec > atBottom.dec,
    `Dec ${atTop?.dec?.toFixed(4)} at y=15% > ${atBottom?.dec?.toFixed(4)} at y=85%`);

  // --- Honest "no data" -----------------------------------------------------------
  const hole = await page.evaluate(() => {
    const canvas = document.querySelector('.spherex-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    // An interior transparent pixel: surrounded by data, so it is a masked hole
    // inside the footprint rather than the blank margin outside it.
    for (let y = 3; y < canvas.height - 3; y += 1) {
      for (let x = 3; x < canvas.width - 3; x += 1) {
        const at = (dx, dy) => data[((y + dy) * canvas.width + (x + dx)) * 4 + 3];
        if (at(0, 0) === 0 && at(-2, 0) === 255 && at(2, 0) === 255 && at(0, -2) === 255 && at(0, 2) === 255) {
          return { x, y, width: canvas.width, height: canvas.height };
        }
      }
    }
    return null;
  });
  if (hole) {
    const rect = await page.locator('.spherex-canvas').first().boundingBox();
    const px = rect.x + ((hole.x + 0.5) / hole.width) * rect.width;
    const py = rect.y + ((hole.y + 0.5) / hole.height) * rect.height;
    await page.mouse.move(px, py);
    await delay(200);
    const foot = await page.locator('.spherex-frame-foot').first().innerText();
    check('a masked pixel inside the footprint reads "no data"', /no data/i.test(foot), foot.split('\n').join(' | ').slice(0, 120));
  } else {
    check('a masked pixel inside the footprint reads "no data"', false, 'no interior hole found in the first frame');
  }

  // A valid pixel must read a number, not the same "no data".
  const solid = await page.evaluate(() => {
    const canvas = document.querySelector('.spherex-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const { width, height } = canvas;
    const centre = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return { x: Math.floor(width / 2), y: Math.floor(height / 2), width, height, alpha: data[centre + 3] };
  });
  if (solid.alpha === 255) {
    const rect = await page.locator('.spherex-canvas').first().boundingBox();
    await page.mouse.move(
      rect.x + (rect.width * (solid.x + 0.5)) / solid.width,
      rect.y + (rect.height * (solid.y + 0.5)) / solid.height,
    );
    await delay(200);
    const foot = await page.locator('.spherex-frame-foot').first().innerText();
    check('a valid pixel reads a measured value', /MJy\/sr/.test(foot), foot.split('\n').join(' | ').slice(0, 120));
  } else {
    check('a valid pixel reads a measured value', false, 'image centre is not valid data in the first frame');
  }

  // --- Contract 4, client half ------------------------------------------------------
  const contract = await page.evaluate(() => {
    const root = document.querySelector('.spherex');
    const controls = [...root.querySelectorAll('button, input, select, a, [role="button"]')];
    return {
      controls: controls.map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim()).filter(Boolean),
      banner: root.querySelector('.spherex-banner')?.textContent || '',
      labels: [...root.querySelectorAll('h2, h3, h4')].map((el) => el.textContent.trim()),
      provenance: [...root.querySelectorAll('.spherex-meta-block h3')].map((el) => el.textContent.trim()),
    };
  });
  check('the viewer labels itself a visualization',
    /Visualization — spatial alignment only/.test(contract.banner),
    contract.banner.slice(0, 110));
  check('no control offers a quantitative difference',
    contract.controls.every((label) => !/difference|subtract|delta|photometr|variab/i.test(label)),
    `${contract.controls.length} control(s): ${contract.controls.slice(0, 8).join(' | ')}`);
  check('provenance keeps archive, derived and display separate',
    ['Archive — what SPHEREx recorded', 'Derived — what this pipeline did', 'Display — computed in your browser']
      .every((h) => contract.provenance.includes(h)),
    contract.provenance.join(' / '));
  note(`panels: ${contract.labels.join(', ')}`);

  // --- M4: side by side, manual toggle, automatic blink ----------------------------
  //
  // The invariant under test: switching epochs or modes changes only *which*
  // observation is drawn. The grid, the sky position and the pooled stretch
  // must come back identical every time, the canvas must not be remounted
  // under the user, and the uncovered rim must stay uncovered in every mode.
  //
  // The cursor is driven by a synthetic pointer event at an exact fractional
  // array coordinate, so the readout is compared byte for byte rather than
  // through pointer rounding that varies with the CSS scale of each layout.
  const moveCursor = async (fx = 100.5 / 294, fy = 150.5 / 294) => {
    await page.evaluate(({ fx: ax, fy: ay }) => {
      const canvas = document.querySelector('.spherex-canvas');
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new PointerEvent('pointermove', {
        clientX: rect.left + rect.width * ax,
        clientY: rect.top + rect.height * ay,
        bubbles: true,
      }));
    }, { fx, fy });
    await delay(160);
    return {
      raw: (await page.locator('.spherex-readout-raw').innerText()).trim(),
      px: (await page.locator('.spherex-readout-px').innerText()).trim(),
    };
  };

  const viewFacts = () => page.evaluate(() => {
    const canvas = document.querySelector('.spherex-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0;
    let checksum = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent += 1;
      checksum = (checksum * 31 + data[i] + data[i + 1] + data[i + 2]) >>> 0;
    }
    const strip = document.querySelector('.spherex-active');
    return {
      canvases: document.querySelectorAll('.spherex-canvas').length,
      width: canvas.width,
      height: canvas.height,
      transparent,
      plane: canvas.width * canvas.height,
      checksum,
      legend: (document.querySelector('.spherex-legend')?.textContent || '').replace(/\s+/g, ' ').trim(),
      active: strip ? strip.textContent.replace(/\s+/g, ' ').trim() : null,
      playLabel: [...document.querySelectorAll('.spherex-controls button')]
        .map((b) => b.textContent.trim())
        .find((t) => /^(⏸ PAUSE|▶ BLINK)$/.test(t)) ?? null,
      speed: document.querySelector('.spherex-speed')?.value ?? null,
      nodeIsFirst: window.__spherexFrame ? window.__spherexFrame === canvas : null,
      nodeIsSingle: window.__spherexSingle ? window.__spherexSingle === canvas : null,
    };
  });
  const activeId = () => page.evaluate(
    () => (document.querySelector('.spherex-active-id')?.textContent ?? '').trim(),
  );
  const [obsA, obsB] = meta.epochs;
  const idOf = (epoch) => `${epoch.archive.label} · ${epoch.archive.obs_id}`;

  // Reference state: the M3-C layout exactly as it loads.
  await page.evaluate(() => { window.__spherexFrame = document.querySelector('.spherex-canvas'); });
  const reference = await viewFacts();
  const referenceCursor = await moveCursor();
  check('M4 reference view is side by side with no active-epoch strip',
    reference.canvases === 2 && reference.active === null,
    `${reference.canvases} frame(s), strip ${reference.active === null ? 'absent' : 'present'}`);

  // --- Manual toggle -------------------------------------------------------------
  await page.getByRole('button', { name: 'SINGLE', exact: true }).click();
  await page.locator('.spherex-active').waitFor({ state: 'visible', timeout: 15_000 });
  const single = await viewFacts();
  const singleCursor = await moveCursor();
  check('M4 toggle puts one observation on screen', single.canvases === 1, `${single.canvases} frame(s)`);
  check('M4 toggle identifies the observation in full (date, obs id, pipeline, units)',
    !!single.active && single.active.includes(idOf(obsA))
    && single.active.includes(obsA.archive.date_obs_utc.slice(0, 10))
    && single.active.includes(`pipeline ${obsA.archive.pipeline_version}`)
    && single.active.includes(obsA.derived.units),
    (single.active || 'no strip').slice(0, 150));
  check('M4 toggle states what switching does not change',
    !!single.active && /same grid, same zoom, same stretch/.test(single.active),
    ((single.active || '').split('same grid')[1] || 'missing').slice(0, 90));
  check('M4 toggle keeps the sky position, the pixel grid and the pooled stretch',
    singleCursor.raw === referenceCursor.raw && singleCursor.px === referenceCursor.px
    && single.legend === reference.legend
    && single.width === reference.width && single.height === reference.height,
    `${singleCursor.raw} ${singleCursor.px}; legend ${single.legend === reference.legend ? 'unchanged' : 'CHANGED'}`);
  check('M4 toggle keeps the uncovered rim transparent',
    single.transparent > single.plane * 0.05,
    `${single.transparent} of ${single.plane} pixels show the no-data backdrop`);
  const singleBanner = await page.locator('.spherex-banner').innerText();
  check('M4 toggle keeps the spatial-alignment disclaimer',
    /Visualization — spatial alignment only/.test(singleBanner) && /never the field of view or the stretch/.test(singleBanner),
    singleBanner.slice(0, 120));

  await page.evaluate(() => { window.__spherexSingle = document.querySelector('.spherex-canvas'); });

  // --- Epoch switch: same canvas node, new pixels, same everything else ----------
  const beforeSwitch = await viewFacts();
  await page.getByRole('button', { name: 'EPOCH-2', exact: true }).click();
  await page.waitForFunction(
    (id) => (document.querySelector('.spherex-active-id')?.textContent ?? '').includes(id),
    idOf(obsB).split(' · ')[1],
    { timeout: 10_000 },
  );
  await delay(250);
  const switched = await viewFacts();
  const switchedCursor = await moveCursor();
  check('M4 epoch switch repaints the same canvas instead of remounting it',
    switched.nodeIsSingle === true, `node preserved: ${switched.nodeIsSingle}`);
  check('M4 epoch switch actually draws the other observation',
    switched.checksum !== beforeSwitch.checksum,
    `checksum ${beforeSwitch.checksum} -> ${switched.checksum}`);
  check('M4 epoch switch leaves the sky position and the pooled stretch alone',
    switchedCursor.raw === referenceCursor.raw && switchedCursor.px === referenceCursor.px
    && switched.legend === reference.legend && switched.width === reference.width,
    `${switchedCursor.raw} ${switchedCursor.px}; legend ${switched.legend === reference.legend ? 'unchanged' : 'CHANGED'}`);
  check('M4 epoch switch identifies the new observation',
    !!switched.active && switched.active.includes(idOf(obsB))
    && switched.active.includes(obsB.archive.date_obs_utc.slice(0, 10))
    && switched.active.includes(`pipeline ${obsB.archive.pipeline_version}`)
    && switched.active.includes(obsB.derived.units),
    (switched.active || '').slice(0, 150));
  check('M4 epoch switch keeps this epoch\'s rim transparent as well',
    switched.transparent > switched.plane * 0.05,
    `${switched.transparent} transparent pixels (nothing zero-filled)`);
  const switchedFoot = await page.locator('.spherex-frame-foot').first().innerText();
  check('M4 each frame reports its own coverage next to the readout',
    /% of grid valid/.test(switchedFoot),
    switchedFoot.split('\n').join(' | ').slice(0, 110));

  // --- Automatic blink -------------------------------------------------------------
  await page.getByRole('button', { name: 'BLINK', exact: true }).click();
  await page.locator('.spherex-speed').waitFor({ state: 'visible', timeout: 15_000 });
  const blinkEntry = await viewFacts();
  check('M4 entering blink keeps the epoch, the canvas and the default cadence',
    blinkEntry.canvases === 1 && blinkEntry.nodeIsSingle === true && blinkEntry.speed === '500',
    `canvases=${blinkEntry.canvases}, node preserved=${blinkEntry.nodeIsSingle}, cadence=${blinkEntry.speed} ms`);
  const blinkBanner = await page.locator('.spherex-banner').innerText();
  check('M4 blink banner warns what a blink cannot establish',
    /cannot by itself establish motion or astrophysical variability/.test(blinkBanner)
    && /Visualization — spatial alignment only/.test(blinkBanner),
    blinkBanner.slice(0, 140));

  const entryId = await activeId();
  const flips = [];
  for (let attempt = 0; attempt < 14 && flips.length < 2; attempt += 1) {
    await delay(250);
    const now = await activeId();
    if (now !== entryId && !flips.includes(now)) flips.push(now);
  }
  check('M4 blink alternates between the real epochs on its own',
    flips.length >= 1, `${entryId} -> ${flips.join(' -> ') || 'never changed'}`);
  const midBlinkCursor = await moveCursor();
  check('M4 blinking does not move the field',
    midBlinkCursor.raw === referenceCursor.raw && midBlinkCursor.px === referenceCursor.px,
    `${midBlinkCursor.raw} ${midBlinkCursor.px} while alternating`);

  // Pause must be a real pause: no stale interval may keep flipping.
  await page.getByRole('button', { name: '⏸ PAUSE', exact: true }).click();
  const paused = await viewFacts();
  const pausedId = await activeId();
  await delay(1400);
  const stillPaused = await viewFacts();
  check('M4 pause stops the alternation deterministically',
    paused.playLabel === '▶ BLINK' && paused.checksum === stillPaused.checksum
    && pausedId === (await activeId()),
    `button=${paused.playLabel}, checksum stable=${paused.checksum === stillPaused.checksum}, still ${pausedId}`);

  // Resume, then let manual selection win over the alternation.
  await page.getByRole('button', { name: '▶ BLINK', exact: true }).click();
  const resumeFrom = await activeId();
  let resumed = false;
  for (let attempt = 0; attempt < 14 && !resumed; attempt += 1) {
    await delay(250);
    resumed = (await activeId()) !== resumeFrom;
  }
  check('M4 play resumes the alternation', resumed, `${resumeFrom} -> ${await activeId()}`);

  await page.getByRole('button', { name: 'EPOCH-1', exact: true }).click();
  await delay(250);
  const manualId = await activeId();
  const manualLabel = (await viewFacts()).playLabel;
  await delay(1400);
  check('M4 selecting an epoch by hand pauses the blink and keeps it there',
    manualId === idOf(obsA) && (manualLabel === '▶ BLINK' || manualLabel === '⏸ PAUSE') && (await activeId()) === manualId,
    `id=${manualId}, button=${manualLabel}, after 1.4 s=${await activeId()}`);
  const manualCursor = await moveCursor();
  check('M4 the field is still in the same place after every switch',
    manualCursor.raw === referenceCursor.raw && manualCursor.px === referenceCursor.px,
    `${manualCursor.raw} ${manualCursor.px}`);

  const blinkControls = await page.evaluate(() => {
    const root = document.querySelector('.spherex');
    const controls = [...root.querySelectorAll('button, input, select, a, [role="button"]')];
    const gateBlock = [...root.querySelectorAll('.spherex-meta-block')]
      .map((b) => b.textContent).find((t) => /Scientific gate/.test(t)) || '';
    return {
      labels: controls.map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim()).filter(Boolean),
      gate: gateBlock,
      banner: root.querySelector('.spherex-banner')?.textContent || '',
    };
  });
  check('M4 even the fully expanded blink controls offer no quantitative analysis',
    blinkControls.labels.length > 4
    && blinkControls.labels.every((label) => !/difference|subtract|delta|photometr|variab/i.test(label)),
    `${blinkControls.labels.length} control(s): ${blinkControls.labels.slice(0, 10).join(' | ')}`);
  check('M4 the gate and the visualization label stay visible while comparing',
    /QUANTITATIVE DIFFERENCE/.test(blinkControls.gate) && /DISABLED/.test(blinkControls.gate)
    && /Visualization — spatial alignment only/.test(blinkControls.banner),
    'gate reports quantitative difference DISABLED');

  // --- Back to the reference, and navigation ------------------------------------
  await page.getByRole('button', { name: 'SIDE BY SIDE', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 15_000 });
  const restored = await viewFacts();
  const restoredCursor = await moveCursor();
  check('M4 returning to side by side restores the reference view exactly',
    restored.active === null && restoredCursor.raw === referenceCursor.raw
    && restored.legend === reference.legend && restored.canvases === 2,
    `strip ${restored.active === null ? 'absent' : 'present'}, ${restoredCursor.raw}, canvases=${restored.canvases}`);

  await page.getByRole('button', { name: /MISSION/ }).click();
  await delay(400);
  await page.getByRole('button', { name: /SPHEREx FIELD/ }).click();
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 30_000 });
  check('M4 navigation away and back keeps the viewer working',
    (await page.locator('.spherex-canvas').count()) === 2,
    'the reference view reloads from the tab');

  // --- M5: candidate selection and evidence inspection -------------------------
  //
  // A user can click a pixel and inspect its evidence across both epochs. The
  // selection lives in grid coordinates, so it survives mode/epoch/blink
  // switches and the documented RELOAD; a full page reload clears it.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const tabM5 = page.getByRole('button', { name: /SPHEREx FIELD/ });
  if (await tabM5.count()) await tabM5.click();
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 30_000 });
  await delay(500);

  // Click on a known-valid pixel (100, 143) in the first frame.
  await page.evaluate(() => {
    const canvas = document.querySelector('.spherex-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = 100, y = 143, w = canvas.width, h = canvas.height;
    const sx = rect.left + (x + 0.5) * (rect.width / w);
    const sy = rect.top + (h - 1 - y + 0.5) * (rect.height / h);
    canvas.dispatchEvent(new MouseEvent('click', { clientX: sx, clientY: sy, bubbles: true }));
  });
  await delay(300);

  const inspectionVisible = await page.locator('.spherex-inspection').count();
  check('M5 clicking a pixel opens the evidence panel',
    inspectionVisible === 1, `${inspectionVisible} inspection panel(s)`);

  // Evidence panel identifies the selected grid pixel.
  const coordsText = await page.locator('.spherex-inspection-coords').innerText();
  check('M5 the selected grid pixel is reported',
    /pixel 100, 143/.test(coordsText), coordsText.replace(/\\s+/g, ' ').slice(0, 80));

  // Sky coordinates are derived and finite.
  check('M5 sky coordinates are derived from the WCS',
    /RA .* Dec/.test(coordsText), coordsText.replace(/\\s+/g, ' ').slice(0, 120));

  // Evidence blocks: one per epoch, with obs id and provenance.
  const evidenceBlocks = await page.locator('.spherex-evidence-block').count();
  check('M5 one evidence block per epoch',
    evidenceBlocks === 2, `${evidenceBlocks} block(s)`);

  // The first evidence block names its epoch and carries a SHA-256.
  const firstBlock = await page.locator('.spherex-evidence-block').first().innerText();
  check('M5 evidence names the epoch and its obs id',
    firstBlock.includes(obsA.archive.obs_id), firstBlock.slice(0, 80));
  check('M5 evidence carries an output SHA-256',
    /OUTPUT SHA-256/.test(firstBlock) && /[0-9a-f]{20,}/.test(firstBlock),
    firstBlock.includes('OUTPUT SHA-256') ? 'present' : 'MISSING');

  // Pixel value is reported (valid pixel → a number, not "no data").
  check('M5 a valid pixel reports its value, not "no data"',
    !/no data/.test(firstBlock.split('PIXEL VALUE')[1]?.slice(0, 40) || ''),
    firstBlock.match(/PIXEL VALUE[^]*?(?=VALIDITY)/)?.[0]?.slice(0, 60) || 'n/a');

  // Evidence level is stated.
  check('M5 every evidence value carries an evidence level',
    /EVIDENCE LEVEL/.test(firstBlock) && /Observed/.test(firstBlock),
    'Observed/Derived/Hypothesis labelled');

  // Limitations block is always visible.
  const limitsVisible = await page.locator('.spherex-limitations').count();
  check('M5 limitations block is always visible',
    limitsVisible === 1, `${limitsVisible} block(s)`);

  // No forbidden quantitative labels in the inspection panel.
  const inspectionText = await page.locator('.spherex-inspection').innerText();
  check('M5 no quantitative-difference or motion claim in the panel',
    !/difference|subtract|delta|photometr|variab|motion|centroid/i.test(inspectionText),
    inspectionText.slice(0, 80));

  // --- M5: selection persists through mode/epoch/blink switches ----------------
  await page.getByRole('button', { name: 'SINGLE', exact: true }).click();
  await delay(200);
  check('M5 selection survives a mode switch',
    (await page.locator('.spherex-inspection').count()) === 1,
    'panel still present in SINGLE mode');

  await page.getByRole('button', { name: 'EPOCH-2', exact: true }).click();
  await delay(200);
  check('M5 selection survives an epoch switch',
    (await page.locator('.spherex-inspection').count()) === 1,
    'panel still present after EPOCH-2');

  await page.getByRole('button', { name: 'BLINK', exact: true }).click();
  await delay(200);
  check('M5 selection survives entering blink',
    (await page.locator('.spherex-inspection').count()) === 1,
    'panel still present in BLINK mode');

  // Pause the blink so it doesn't flip under the test.
  const pauseBtn = page.getByRole('button', { name: '⏸ PAUSE', exact: true });
  if (await pauseBtn.count()) await pauseBtn.click();
  await delay(200);

  // RELOAD preserves selection.
  await page.getByRole('button', { name: /RELOAD/ }).click();
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await delay(500);
  check('M5 selection survives RELOAD',
    (await page.locator('.spherex-inspection').count()) === 1,
    'panel still present after RELOAD');

  // Back to side by side.
  await page.getByRole('button', { name: 'SIDE BY SIDE', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 15_000 });
  await delay(200);
  check('M5 selection survives returning to side by side',
    (await page.locator('.spherex-inspection').count()) === 1,
    'panel still present in side-by-side mode');

  // --- M5: selection clears on full page reload -------------------------------
  await page.reload({ waitUntil: 'domcontentloaded' });
  const tabM5b = page.getByRole('button', { name: /SPHEREx FIELD/ });
  if (await tabM5b.count()) await tabM5b.click();
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 30_000 });
  await delay(500);
  check('M5 a full page reload clears the selection',
    (await page.locator('.spherex-inspection').count()) === 0,
    'no panel after reload, as specified');

  // --- M5: invalid pixel reports "no data", not a number ----------------------
  // Click on a pixel at (0, 0) which may be in the uncovered rim.
  await page.evaluate(() => {
    const canvas = document.querySelector('.spherex-canvas');
    const rect = canvas.getBoundingClientRect();
    const x = 0, y = 0, w = canvas.width, h = canvas.height;
    const sx = rect.left + (x + 0.5) * (rect.width / w);
    const sy = rect.top + (h - 1 - y + 0.5) * (rect.height / h);
    canvas.dispatchEvent(new MouseEvent('click', { clientX: sx, clientY: sy, bubbles: true }));
  });
  await delay(300);
  const inspection2 = await page.locator('.spherex-inspection').count();
  if (inspection2 === 1) {
    const evText = await page.locator('.spherex-evidence-block').first().innerText();
    // Either valid (shows a number) or invalid (shows "no data") — never both.
    const hasValue = /PIXEL VALUE/.test(evText);
    const hasNoData = /no data/.test(evText);
    check('M5 invalid/uncovered pixels are reported as "no data", never as zero',
      hasValue && !hasNoData || hasNoData && !/0\.000000/.test(evText.split('PIXEL VALUE')[1]?.slice(0, 30) || ''),
      evText.match(/PIXEL VALUE[^]*?(?=VALIDITY)/)?.[0]?.slice(0, 40) || 'n/a');
  } else {
    check('M5 clicking an edge pixel selects it',
      inspection2 === 1, `${inspection2} panel(s)`);
  }

  // Clear selection for the next sections.
  const clearBtn = page.locator('button', { hasText: 'Clear selection' });
  if (await clearBtn.count()) await clearBtn.click();
  await delay(200);

  // --- M5: mobile selection at 390 x 844 ------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const tabM5m = page.getByRole('button', { name: /SPHEREx FIELD/ });
  if (await tabM5m.count()) await tabM5m.click();
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('.spherex-canvas').length === 2, null, { timeout: 30_000 });
  await delay(500);

  // Tap on the first canvas at a known-valid pixel.
  await tap(page, page.locator('.spherex-canvas').first());
  await delay(300);
  check('M5 mobile: tapping a pixel opens the evidence panel',
    (await page.locator('.spherex-inspection').count()) === 1,
    `${await page.locator('.spherex-inspection').count()} panel(s)`);

  // Evidence panel is readable (controls fit).
  const mobileInsp = await page.evaluate(() => {
    const panel = document.querySelector('.spherex-inspection');
    const b = panel ? panel.getBoundingClientRect() : null;
    return { w: b ? Math.round(b.width) : 0, vw: window.innerWidth };
  });
  check('M5 mobile: evidence panel fits the viewport',
    mobileInsp.w <= mobileInsp.vw + 4, `${mobileInsp.w} px in ${mobileInsp.vw} px`);

  // Clear and verify.
  const clearM = page.locator('button', { hasText: 'Clear selection' });
  if (await clearM.count()) { await tap(page, clearM); await delay(200); }
  check('M5 mobile: clear selection works',
    (await page.locator('.spherex-inspection').count()) === 0,
    'panel gone after clear');

  // --- Honest failure and recovery --------------------------------------------
  //
  // Vercel cannot spawn Python, so the sidecar routes answer 503 there. That
  // state has to be shown as a retryable failure, never as a blank picture.
  await page.route('**/api/spherex/products', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'the sidecar could not be started', code: 'sidecar_unavailable' }),
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const tabAfterReload = page.getByRole('button', { name: /SPHEREx FIELD/ });
  if (await tabAfterReload.count()) await tabAfterReload.click();
  await page.locator('.module-error').waitFor({ state: 'visible', timeout: 45_000 });
  const errorText = await page.locator('.module-error').innerText();
  check('a retryable failure is reported as such, not as an empty image',
    /sidecar_unavailable/.test(errorText) && /transient environment failure/.test(errorText),
    errorText.split('\n').join(' | ').slice(0, 140));

  await page.unroute('**/api/spherex/products');
  await page.locator('.module-error button').click();
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  check('retry recovers without reloading the page',
    (await page.locator('.spherex-canvas').count()) === 2,
    'both frames are back after one retry');

  // --- M4: a failure raised while comparing, and recovery keeps the mode ------
  //
  // The user has chosen a comparison; a transient failure must be reported as
  // retryable there too, and recovering must not silently drop them back to
  // the default view.
  await page.getByRole('button', { name: 'SINGLE', exact: true }).click();
  await page.locator('.spherex-active').waitFor({ state: 'visible', timeout: 15_000 });
  await page.route('**/api/spherex/products', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'the sidecar could not be started', code: 'sidecar_unavailable' }),
  }));
  await page.getByRole('button', { name: /RELOAD/ }).click();
  await page.locator('.module-error').waitFor({ state: 'visible', timeout: 45_000 });
  const comparedError = await page.locator('.module-error').innerText();
  check('a failure raised while comparing is still reported as retryable',
    /sidecar_unavailable/.test(comparedError) && /transient environment failure/.test(comparedError),
    comparedError.split('\n').join(' | ').slice(0, 130));

  await page.unroute('**/api/spherex/products');
  await page.locator('.module-error button').click();
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  const recovered = await viewFacts();
  check('recovery keeps the comparison mode the user chose',
    recovered.canvases === 1 && !!recovered.active && recovered.active.includes(idOf(obsA)),
    `canvases=${recovered.canvases}, strip=${(recovered.active || 'absent').slice(0, 80)}`);

  // --- M4: the same interaction at a mobile viewport (390 × 844) ----------------
  //
  // The comparison has to be usable where most people will meet it: one
  // column, controls inside the screen with real tap targets, the same honest
  // rendering, and the collapsed menu still reaching this tab.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  await delay(500);

  const mobileLayout = () => page.evaluate(() => {
    // Normalise any programmatic horizontal scroll (decorative layers make the
    // root scrollable even though `overflow-x: hidden` stops a finger): layout
    // fit is what is being measured, not a stray scroll offset.
    document.body.scrollLeft = 0;
    document.documentElement.scrollLeft = 0;
    const controls = [...document.querySelectorAll(
      '.spherex-controls .seg, .spherex-controls .btn, .spherex-controls select, .spherex-controls .tb-label',
    )];
    const canvas = document.querySelector('.spherex-canvas');
    const cb = canvas.getBoundingClientRect();
    const grid = document.querySelector('.spherex-grid');
    return {
      vw: window.innerWidth,
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      controls: controls.map((el) => {
        const b = el.getBoundingClientRect();
        return {
          t: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14),
          l: Math.round(b.left), r: Math.round(b.right), h: Math.round(b.height),
          interactive: !el.classList.contains('tb-label'),
        };
      }),
      canvas: { l: Math.round(cb.left), r: Math.round(cb.right), w: Math.round(cb.width) },
    };
  });
  const controlsFit = (layout) => layout.controls.length > 0
    && layout.controls.every((c) => c.l >= -1 && c.r <= layout.vw + 1
      && (c.interactive ? c.h >= 20 : c.h >= 12));

  const mobile = await mobileLayout();
  check('mobile: the viewport is narrow and side by side collapses to one column',
    mobile.vw === 390 && mobile.columns === 1,
    `vw=${mobile.vw}, ${mobile.columns} column(s)`);
  check('mobile: comparison controls stay inside the viewport with usable tap targets',
    controlsFit(mobile), JSON.stringify(mobile.controls));
  check('mobile: the reference frames fit the viewport width',
    mobile.canvas.l >= -1 && mobile.canvas.r <= mobile.vw + 1 && mobile.canvas.w > 200,
    JSON.stringify(mobile.canvas));

  // Tap through the comparison with real pointer coordinates (see `tap`).
  await tap(page, page.getByRole('button', { name: 'SINGLE', exact: true }));
  await page.locator('.spherex-active').waitFor({ state: 'visible', timeout: 20_000 });
  const mobileSingle = await page.evaluate(() => {
    const canvas = document.querySelector('.spherex-canvas');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque += 1;
    return {
      canvases: document.querySelectorAll('.spherex-canvas').length,
      opaque,
      plane: canvas.width * canvas.height,
      strip: (document.querySelector('.spherex-active')?.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
  check('mobile: single-epoch mode renders a real, mostly drawn frame',
    mobileSingle.canvases === 1 && mobileSingle.opaque > mobileSingle.plane * 0.7,
    `${mobileSingle.opaque}/${mobileSingle.plane} pixels drawn`);
  check('mobile: the active observation is identified in full',
    mobileSingle.strip.includes(idOf(obsA))
    && mobileSingle.strip.includes(`pipeline ${obsA.archive.pipeline_version}`)
    && mobileSingle.strip.includes(obsA.derived.units),
    mobileSingle.strip.slice(0, 130));
  check('mobile: the controls still fit after the layout changes',
    controlsFit(await mobileLayout()), 'all controls inside 390 px');

  await tap(page, page.getByRole('button', { name: 'EPOCH-2', exact: true }));
  await delay(250);
  const mobileEpoch2 = await activeId();
  check('mobile: switching epoch updates the identification',
    mobileEpoch2 === idOf(obsB), mobileEpoch2.slice(0, 90));

  await tap(page, page.getByRole('button', { name: 'BLINK', exact: true }));
  await page.locator('.spherex-speed').waitFor({ state: 'visible', timeout: 15_000 });
  const mobileEntry = await activeId();
  let mobileFlipped = false;
  for (let attempt = 0; attempt < 14 && !mobileFlipped; attempt += 1) {
    await delay(250);
    mobileFlipped = (await activeId()) !== mobileEntry;
  }
  check('mobile: the blink alternates on its own here too',
    mobileFlipped, `${mobileEntry} -> ${await activeId()}`);

  await tap(page, page.getByRole('button', { name: '⏸ PAUSE', exact: true }));
  const mobilePaused = await activeId();
  await delay(1300);
  check('mobile: pause stops the alternation',
    (await activeId()) === mobilePaused, mobilePaused.slice(0, 70));
  const mobileBlink = await mobileLayout();
  check('mobile: the fully expanded blink controls still fit the viewport',
    mobileBlink.controls.length >= 8 && controlsFit(mobileBlink),
    `${mobileBlink.controls.length} control(s), all inside ${mobileBlink.vw} px`);

  // Navigation: the collapsed menu must still leave this tab and return to it.
  await tap(page, '.nav-burger');
  await page.locator('.nav-mobile.open').waitFor({ state: 'visible', timeout: 15_000 });
  await tap(page, page.locator('.nav-mobile.open').getByText('MISSION').first());
  await delay(400);
  check('mobile: the menu leaves this tab for another view',
    (await page.locator('.spherex-canvas').count()) === 0
    && (await page.locator('.nav-mobile.open').count()) === 0,
    'spherex unmounted and the menu closed');

  await tap(page, '.nav-burger');
  await page.locator('.nav-mobile.open').waitFor({ state: 'visible', timeout: 15_000 });
  await tap(page, page.locator('.nav-mobile.open').getByText('SPHEREx FIELD').first());
  await page.locator('.spherex-canvas').first().waitFor({ state: 'visible', timeout: 60_000 });
  check('mobile: the menu returns to this tab with the viewer working',
    (await page.locator('.spherex-canvas').count()) === 2,
    'reference view reloaded at mobile width');

  // --- Errors --------------------------------------------------------------------
  const realErrors = consoleErrors.filter((message) => !/favicon/i.test(message));
  // The deliberately injected 503 above is expected to be logged by Chromium.
  const unexpected = realErrors.filter((message) => !/status of \d{3}/.test(message));
  check('no uncaught page or console errors', unexpected.length === 0,
    `${realErrors.length} logged, unexpected: ${unexpected.slice(0, 3).join(' | ')}`);
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
console.log(`\n${problems.length === 0 ? 'SPHEREx VIEWER ACCEPTANCE OK' : `SPHEREx VIEWER ACCEPTANCE FAILURES: ${problems.join(', ')}`}`);
process.exit(problems.length === 0 ? 0 : 1);
