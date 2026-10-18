// Unit tests for the M3-C product store (docs/spherex-m3c-contracts.md).
//
// Everything runs offline. The archive and the sidecar are both injected: the
// fake sidecar writes a *real* (tiny) FITS product and prints a real report, so
// the FITS decode, the WCS read-back, the checksum re-verification and the wire
// format are all exercised for real. Only the reprojection maths itself is out
// of scope here — that is `npm run test:sidecar`'s job.
//
// Two things are deliberately locked down rather than assumed:
//   * `npm test` must never need Python (the spawn path is tested against a
//     binary that does not exist, and must fail honestly);
//   * the metadata surface must offer no way to difference two epochs
//     (Contract 4) while the gate says it is disabled.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createProductStore, ProductError, SIDECAR_ROLES, WIRE_FORMAT } from './spherex-products.js';

// ---------------------------------------------------------------------------
// A minimal, spec-shaped FITS writer. 80-character cards, 2880-byte blocks,
// big-endian pixels — enough to be indistinguishable from astropy's output to
// the reader under test.
// ---------------------------------------------------------------------------

const NX = 5;
const NY = 4;
const CARD_PAD = ' '.repeat(80);

function card(key, value) {
  const k = key.padEnd(8).slice(0, 8);
  let text;
  if (typeof value === 'boolean') text = `${k}= ${value ? 'T' : 'F'}`;
  else if (typeof value === 'string') text = `${k}= '${value}'`;
  else if (Number.isInteger(value)) text = `${k}= ${String(value).padStart(20)}`;
  else text = `${k}= ${Number(value).toExponential(14).toUpperCase().padStart(20)}`;
  return `${text}${CARD_PAD}`.slice(0, 80);
}

function headerBuffer(cards) {
  const lines = [...cards, 'END'.padEnd(80)];
  const pad = (2880 - ((lines.length * 80) % 2880)) % 2880;
  return Buffer.from(lines.join('') + ' '.repeat(pad), 'latin1');
}

function padToBlock(buf) {
  const pad = (2880 - (buf.length % 2880)) % 2880;
  return pad ? Buffer.concat([buf, Buffer.alloc(pad, 0)]) : buf;
}

/** Reference pixel values the raster test asserts against. */
function referenceImage(nx = NX, ny = NY) {
  return Float32Array.from({ length: nx * ny }, (_, i) => (i % 7) * 10 + 1);
}

function referenceMask(nx = NX, ny = NY) {
  return Uint8Array.from({ length: nx * ny }, (_, i) => (i % 5 === 0 ? 0 : 1));
}

function buildProductFits({ nx = NX, ny = NY, crval = [270, 66.5], crpix = [3, 2.5] } = {}) {
  const flux = referenceImage(nx, ny);
  const usable = referenceMask(nx, ny);
  const wcsCards = [
    card('CRPIX1', crpix[0]),
    card('CRPIX2', crpix[1]),
    card('CRVAL1', crval[0]),
    card('CRVAL2', crval[1]),
    card('CDELT1', 1),
    card('CDELT2', 1),
    card('PC1_1', -0.0017083333333333),
    card('PC2_2', 0.0017083333333333),
    card('CTYPE1', 'RA---TAN'),
    card('CTYPE2', 'DEC--TAN'),
    card('RADESYS', 'ICRS'),
    card('EQUINOX', 2000),
  ];
  const fluxBuf = Buffer.alloc(flux.length * 4);
  flux.forEach((v, i) => fluxBuf.writeFloatBE(v, i * 4));
  const imageHdu = Buffer.concat([
    headerBuffer([
      card('XTENSION', 'IMAGE'),
      card('BITPIX', -32),
      card('NAXIS', 2),
      card('NAXIS1', nx),
      card('NAXIS2', ny),
      card('PCOUNT', 0),
      card('GCOUNT', 1),
      card('EXTNAME', 'IMAGE'),
      card('BUNIT', 'MJy / sr'),
      ...wcsCards,
    ]),
    padToBlock(fluxBuf),
  ]);
  const maskHdu = Buffer.concat([
    headerBuffer([
      card('XTENSION', 'IMAGE'),
      card('BITPIX', 8),
      card('NAXIS', 2),
      card('NAXIS1', nx),
      card('NAXIS2', ny),
      card('PCOUNT', 0),
      card('GCOUNT', 1),
      card('EXTNAME', 'MASK'),
      card('BUNIT', 'valid'),
      ...wcsCards,
    ]),
    padToBlock(Buffer.from(usable)),
  ]);
  const primary = headerBuffer([
    card('SIMPLE', true),
    card('BITPIX', 8),
    card('NAXIS', 0),
    card('EXTEND', true),
    card('VERSION', '6.4+psffix1'),
  ]);
  return Buffer.concat([primary, imageHdu, maskHdu]);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRunner({ fits = {}, tweak } = {}) {
  const run = async ({ requestPath }) => {
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    const products = [];
    for (const p of request.products) {
      const out = buildProductFits(fits);
      const outPath = path.join(request.outputs.dir, `${p.role}_reprojected.fits`);
      await writeFile(outPath, out);
      products.push({
        role: p.role,
        input: { sha256: p.sha256 },
        output: { path: outPath, sha256: createHash('sha256').update(out).digest('hex') },
        arrays_sha256: `arrays-${p.role}`,
        stats: {
          covered_fraction: 0.9,
          valid_fraction: 0.8,
          finite_fraction: 1,
          any_flag_fraction: 0.434,
          quality_flag_fraction: 0.029,
          informational_flag_fraction: 0.408,
          median: 42,
        },
        flag_policy: {
          source: 'header',
          invalid_roles: ['pathology', 'not_sky'],
          unclassified_bits: [],
          per_bit: {},
        },
        checks: [{ id: 'image_reprojected', status: 'pass' }],
      });
    }
    const report = {
      ok: true,
      milestone: 'M3-B',
      grid: request.grid,
      method: request.method,
      products,
      checks: [{ id: 'outputs_share_target_grid', status: 'pass' }],
      alignment: { lag_px: [0, 0], offset_px: 0, peak_correlation: 0.639, common_pixels: 65328 },
      gate: {
        spatial_alignment: true,
        quantitative_difference_enabled: false,
        acceptance_rule: 'matching output grids establish spatial alignment — not scientific comparability',
      },
      sidecar: { python: 'test', astropy: 'test', numpy: 'test', reproject: 'test' },
    };
    if (tweak) tweak(report, request);
    return { stdout: JSON.stringify(report) };
  };
  const runSidecar = async (args) => {
    runSidecar.calls += 1;
    return run(args);
  };
  runSidecar.calls = 0;
  return runSidecar;
}

function baseManifest(cutoutSha, cutoutBytes) {
  const obs = (label, obsId, url, crpix) => ({
    label,
    date_obs_utc: label === 'epoch-1' ? '2025-04-29T03:50:28.360' : '2025-11-16T02:07:55.367',
    mjd_obs: label === 'epoch-1' ? 60794.160050463 : 60995.088835266,
    obs_id: obsId,
    detector: 2,
    pipeline_version: '6.4+psffix1',
    pipeline_build: 'l2b-v20-2025-240',
    quality: { L1DQAFLG: 'Pass', L2DQAFLG: 'Pass' },
    exposure_sec: 113.5826,
    cutout_wcs_reference: { crval_ra_deg: 270, crval_dec_deg: 66.5, crpix },
    archive_url: url,
    cutout_url: `${url}?center=270,66.5&size=0.5`,
    cutout_bytes: cutoutBytes,
    cutout_sha256: cutoutSha,
  });
  return {
    schema: 'novochar.spherex.demo-manifest/v1',
    generated: '2026-10-17',
    mission: 'SPHEREx',
    release: { id: 'QR2', label: 'SPHEREx Quick Release Spectral Images - QR2', doi: '10.26131/IRSA652' },
    field: {
      id: 'nep',
      name: 'North Ecliptic Pole deep field',
      center: { ra_deg: 270, dec_deg: 66.5, frame: 'ICRS' },
      requested_cutout_deg: 0.5,
    },
    product: { type: 'level2_b', pixel_scale_arcsec: 6.15, bunit: 'MJy/sr' },
    observations: [
      obs('epoch-1', 'FIXTURE_A', 'https://example.invalid/a.fits', [147.5, 27.5]),
      obs('epoch-2', 'FIXTURE_B', 'https://example.invalid/b.fits', [86.5, 168.5]),
    ],
    baseline_days: 200.93,
    rights: {
      terms: 'IRSA public data, no usage restrictions',
      terms_url: 'https://irsa.ipac.caltech.edu/data_use_terms.html',
      citation_doi: '10.26131/IRSA652',
      acknowledgement: 'This publication makes use of data products from SPHEREx.',
    },
    caveats: ['A raw pixel difference would be wrong; a valid blink needs WCS reprojection.'],
  };
}

function fixtureGrid() {
  return {
    schema: 'novochar.spherex.common-grid/v1',
    id: 'fixture-grid',
    field: 'nep',
    ra: 270,
    dec: 66.5,
    frame: 'ICRS',
    projection: 'TAN',
    pixel_scale_arcsec: 6.15,
    shape: [NY, NX],
    rotation_deg: 0,
    orientation: 'north-up, east-left',
  };
}

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'novochar-products-'));
  const dataDir = path.join(root, 'data');
  const cacheDir = path.join(root, 'cache');
  const scriptA = path.join(root, 'reproject_common.py');
  const scriptB = path.join(root, 'reproject_common.changed.py');
  await mkdir(dataDir, { recursive: true });
  await writeFile(scriptA, '# stand-in sidecar (M3-B pipeline)\n');
  await writeFile(scriptB, '# stand-in sidecar (changed)\n');

  const cutout = Buffer.alloc(64, 7);
  const cutoutSha = createHash('sha256').update(cutout).digest('hex');
  await writeFile(
    path.join(dataDir, 'demo-manifest.json'),
    JSON.stringify(baseManifest(cutoutSha, cutout.length)),
  );
  await writeFile(path.join(dataDir, 'common-grid.json'), JSON.stringify(fixtureGrid()));

  const fetchCalls = [];
  const archiveFetch = async (url) => {
    fetchCalls.push(url);
    return new Response(cutout, { headers: { 'content-length': String(cutout.length) } });
  };

  const makeStore = (opts = {}) => {
    const args = {
      rootDir: root,
      dataDir,
      cacheDir,
      sidecarScript: opts.sidecarScript ?? scriptA,
      pythonBin: opts.pythonBin ?? path.join(root, 'python-that-does-not-exist'),
      fetchImpl: opts.fetchImpl ?? archiveFetch,
    };
    if (!opts.realSidecar) args.runSidecar = opts.runSidecar ?? makeRunner(opts.runnerOptions);
    return createProductStore(args);
  };

  return { root, dataDir, cacheDir, scriptA, scriptB, cutout, cutoutSha, fetchCalls, makeStore };
}

function rewriteManifest(dataDir, mutate) {
  return async () => {
    const file = path.join(dataDir, 'demo-manifest.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    mutate(manifest);
    await writeFile(file, JSON.stringify(manifest));
  };
}

async function expectProductError(promise, code) {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof ProductError, `expected ProductError, got ${err}`);
    assert.equal(err.code, code);
    return err;
  }
  assert.fail(`expected a ProductError with code "${code}"`);
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

test('metadata keeps archive facts and derived facts in separate namespaces', async () => {
  const { makeStore } = await setup();
  const meta = await makeStore().metadata();

  assert.equal(meta.schema, 'novochar.spherex.derived/v1');
  assert.equal(meta.epochs.length, 2);

  const [a] = meta.epochs;
  assert.equal(a.role, 'epoch-a');
  // Archive namespace: what the mission/archive says, unmodified.
  assert.equal(a.archive.label, 'epoch-1');
  assert.equal(a.archive.obs_id, 'FIXTURE_A');
  assert.equal(a.archive.detector, 2);
  assert.equal(a.archive.pipeline_version, '6.4+psffix1');
  assert.equal(a.archive.cutout_sha256, a.derived.input_sha256);
  assert.ok(a.archive.cutout_url.startsWith('https://example.invalid/a.fits?center='));
  assert.equal(a.archive.quality.L1DQAFLG, 'Pass');

  // Derived namespace: what this pipeline did to it.
  assert.equal(a.derived.units, 'MJy / sr');
  assert.deepEqual(a.derived.shape, [NY, NX]);
  assert.equal(a.derived.stats.quality_flag_fraction, 0.029);
  assert.equal(a.derived.stats.informational_flag_fraction, 0.408);
  assert.ok(a.derived.output_sha256);
  assert.equal(a.derived.output_sha256.length, 64);

  // Nothing display-ish leaks into either namespace.
  assert.equal(a.display, undefined);
  assert.deepEqual(Object.keys(a).sort(), ['archive', 'derived', 'raster', 'role']);
  assert.equal(meta.wire.format, WIRE_FORMAT);
});

test('reads the WCS back out of the product and normalises CDELT*PC to one CD matrix', async () => {
  const { makeStore } = await setup();
  const meta = await makeStore().metadata();

  for (const epoch of meta.epochs) {
    const { wcs } = epoch.derived;
    assert.deepEqual(wcs.crval, [270, 66.5], `${epoch.role} crval`);
    assert.deepEqual(wcs.crpix, [3, 2.5], `${epoch.role} crpix stays 1-based FITS`);
    assert.deepEqual(wcs.ctype, ['RA---TAN', 'DEC--TAN']);
    assert.equal(wcs.radesys, 'ICRS');
    // CD = CDELT * PC: the client only ever sees this one convention.
    assert.ok(Math.abs(wcs.cd[0][0] - -0.0017083333333333) < 1e-15);
    assert.ok(Math.abs(wcs.cd[1][1] - 0.0017083333333333) < 1e-15);
    assert.equal(wcs.cd[0][1], 0);
    assert.equal(wcs.cd[1][0], 0);
    // North-up: increasing y is increasing dec, and CD1_1 < 0 means east is left.
    assert.ok(wcs.cd[1][1] > 0);
    assert.ok(wcs.cd[0][0] < 0);
  }
  assert.equal(meta.gate.spatial_alignment, true);
  assert.equal(meta.gate.quantitative_difference_enabled, false);
});

// ---------------------------------------------------------------------------
// Raster
// ---------------------------------------------------------------------------

test('serves a raster as little-endian float32 plus a uint8 mask', async () => {
  const { makeStore } = await setup();
  const store = makeStore();
  await store.metadata();

  const raster = await store.raster('epoch-a');
  const plane = NX * NY;
  assert.equal(raster.width, NX);
  assert.equal(raster.height, NY);
  assert.equal(raster.bytes.length, plane * 5, 'IMAGE plane then MASK plane');

  const image = new Float32Array(raster.bytes.buffer, raster.bytes.byteOffset, plane);
  const mask = raster.bytes.subarray(plane * 4);
  assert.deepEqual([...image], [...referenceImage()]);
  assert.deepEqual([...mask], [...referenceMask()]);
  assert.equal(raster.sha256, createHash('sha256').update(raster.bytes).digest('hex'));

  await expectProductError(store.raster('epoch-z'), 'product_unavailable');
  await expectProductError(store.raster('../../etc/passwd'), 'product_unavailable');
});

test('rejects a product that does not sit on the agreed grid', async () => {
  const { makeStore } = await setup();
  const store = makeStore({ runnerOptions: { fits: { crval: [12, 34] } } });
  await expectProductError(store.metadata(), 'product_unavailable');
});

// ---------------------------------------------------------------------------
// Orchestration: cache, idempotency, honest failures
// ---------------------------------------------------------------------------

test('runs the sidecar once and reuses a checksum-verified cached run', async () => {
  const { makeStore } = await setup();
  const runner = makeRunner();
  const store = makeStore({ runSidecar: runner });

  await store.metadata();
  await store.raster('epoch-a');
  await store.metadata();
  assert.equal(runner.calls, 1, 'no second reprojection for a warm cache');

  // A fresh store over the same cache directory reuses it too, because the
  // manifest hashes, the grid and the sidecar script are all unchanged.
  const runner2 = makeRunner();
  const again = await makeStore({ runSidecar: runner2 }).metadata();
  assert.equal(runner2.calls, 0, 'cached run reused across store instances');
  assert.equal(again.epochs[0].derived.output_sha256.length, 64);

  const report = JSON.parse(await readFile(path.join(store.derivedDir, 'report.json'), 'utf8'));
  assert.equal(report.schema, 'novochar.spherex.derived/v1');
  assert.equal(report.sidecar.script_sha256.length, 64);
});

test('re-runs when the sidecar script itself changes', async () => {
  const { makeStore, scriptB } = await setup();
  await makeStore({ runSidecar: makeRunner() }).metadata();

  const runner = makeRunner();
  await makeStore({ runSidecar: runner, sidecarScript: scriptB }).metadata();
  assert.equal(runner.calls, 1, 'a changed pipeline invalidates the cached products');
});

test('refuses a report that failed the sidecar gate, naming the failed checks', async () => {
  const { makeStore } = await setup();
  const store = makeStore({
    runSidecar: makeRunner({
      tweak: (report) => {
        report.ok = false;
        report.checks.push({ id: 'outputs_share_target_grid', status: 'fail' });
      },
    }),
  });
  const err = await expectProductError(store.metadata(), 'reprojection_failed');
  assert.deepEqual(err.detail.failedChecks, ['outputs_share_target_grid']);
});

test('refuses to expose images when spatial alignment was not established', async () => {
  const { makeStore } = await setup();
  const store = makeStore({
    runSidecar: makeRunner({
      tweak: (report) => { report.gate.spatial_alignment = false; },
    }),
  });
  const err = await expectProductError(store.metadata(), 'reprojection_failed');
  assert.match(err.message, /spatial alignment/);
});

test('refuses an output whose checksum disagrees with the sidecar report', async () => {
  const { makeStore } = await setup();
  const store = makeStore({
    runSidecar: makeRunner({
      tweak: (report) => { report.products[0].output.sha256 = 'dead'.repeat(16); },
    }),
  });
  const err = await expectProductError(store.metadata(), 'reprojection_failed');
  assert.match(err.message, /checksum differs/);
});

test('fetches cutouts on demand and serves the next run from the cache', async () => {
  const { makeStore, fetchCalls } = await setup();
  await makeStore({ runSidecar: makeRunner() }).metadata();
  assert.equal(fetchCalls.length, 2, 'one bounded fetch per epoch');

  fetchCalls.length = 0;
  await makeStore({ runSidecar: makeRunner() }).metadata();
  assert.equal(fetchCalls.length, 0, 'second run reads verified cutouts from cache');
});

test('reports cutout_unavailable when the archive returns a different checksum', async () => {
  const { makeStore, dataDir, cutoutSha } = await setup();
  // The archive changed underneath us: same URL, different bytes.
  const manifestSha = '00'.repeat(32);
  await writeFile(path.join(dataDir, 'demo-manifest.json'), JSON.stringify(baseManifest(manifestSha, 64)));
  const store = makeStore({ runSidecar: makeRunner() });
  const err = await expectProductError(store.metadata(), 'cutout_unavailable');
  assert.equal(err.detail.expected, manifestSha, 'the manifest hash is what was promised');
  assert.equal(err.detail.actual, cutoutSha, 'the archive hash is what arrived');
  assert.notEqual(err.detail.actual, err.detail.expected);
});

test('reports sidecar_unavailable when the sidecar cannot be started', async () => {
  const { makeStore } = await setup();
  const store = makeStore({ realSidecar: true });
  const err = await expectProductError(store.metadata(), 'sidecar_unavailable');
  assert.match(err.message, /sidecar (failed to run|exited)/);
});

test('rejects a manifest that does not describe exactly two epochs', async () => {
  const { makeStore, dataDir } = await setup();
  await rewriteManifest(dataDir, (m) => { m.observations = [m.observations[0]]; })();
  await expectProductError(makeStore().metadata(), 'product_unavailable');
});

test('rejects a manifest that is missing a checksum', async () => {
  const { makeStore, dataDir } = await setup();
  await rewriteManifest(dataDir, (m) => { delete m.observations[1].cutout_sha256; })();
  await expectProductError(makeStore().metadata(), 'product_unavailable');
});

// ---------------------------------------------------------------------------
// Contract 4 — the scientific gate
// ---------------------------------------------------------------------------

function collectKeys(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach((v) => collectKeys(v, out));
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'gate') continue; // the gate is the one place the flag lives, by contract
      out.push(k);
      collectKeys(v, out);
    }
  }
  return out;
}

test('exposes no epoch-to-epoch difference surface while the gate is off', async () => {
  const { makeStore } = await setup();
  const meta = await makeStore().metadata();

  // The gate arrives verbatim from the sidecar's report.
  assert.equal(meta.gate.spatial_alignment, true);
  assert.equal(meta.gate.quantitative_difference_enabled, false);
  assert.match(meta.gate.acceptance_rule, /spatial alignment/);

  // ...and nothing else in the payload suggests a difference, subtraction,
  // photometry or variability product exists.
  const forbidden = /difference|subtract|delta|photometr|variab/i;
  const offenders = collectKeys(meta).filter((k) => forbidden.test(k));
  assert.deepEqual(offenders, [], 'no difference-shaped keys in the metadata surface');

  // Every epoch is reachable only as metadata + a pre-formatted raster.
  for (const epoch of meta.epochs) {
    assert.equal(epoch.raster, `/api/spherex/products/${epoch.role}/raster`);
    assert.deepEqual(Object.keys(epoch).sort(), ['archive', 'derived', 'raster', 'role']);
  }
});

test('ProductError carries a stable machine-readable code', () => {
  const err = new ProductError('cutout_unavailable', 'nope', { detail: 1 });
  assert.equal(err.name, 'ProductError');
  assert.equal(err.code, 'cutout_unavailable');
  assert.deepEqual(err.detail, { detail: 1 });
  assert.deepEqual(SIDECAR_ROLES, ['epoch-a', 'epoch-b']);
});
