// Browser acceptance for the real SPHEREx product viewer (M3-C).
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
