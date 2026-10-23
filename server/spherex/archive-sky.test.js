// Contract tests for the regional archive sky used by the 3D explorer.
//
// These use a fake product store, so `npm test` never needs Python or network.
// The deployment-bundle check in scripts/check-spherex-bundle.mjs exercises the
// same service against the committed real NEP products.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import express from 'express';
import {
  ARCHIVE_SKY_SCHEMA,
  ArchiveSkyError,
  createArchiveSkyService,
  createSpherexArchiveSkyRouter,
  renderArchivePixels,
  sharedStretch,
  statusForArchiveError,
} from './archive-sky.js';

function pngSize(png) {
  png = Buffer.from(png);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function decodePngRgba(png) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.equal(filter, 0, 'our PNG encoder always writes filter 0');
    rgba.set(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride), y * stride);
  }
  return { width, height, rgba };
}

function wireRaster(image, mask, width, height) {
  const bytes = new Uint8Array(width * height * 5);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < image.length; i++) view.setFloat32(i * 4, image[i], true);
  bytes.set(mask, width * height * 4);
  return { bytes, width, height, sha256: 'c'.repeat(64) };
}

function fakeMetadata(overrides = {}) {
  return {
    schema: 'novochar.spherex.derived/v1',
    mission: 'SPHEREx',
    product: { type: 'Level-2 Spectral Image' },
    field: { name: 'North Ecliptic Pole deep field' },
    release: {
      id: 'QR2',
      label: 'SPHEREx Quick Release Spectral Images - QR2',
      doi: '10.26131/IRSA652',
    },
    baseline_days: 200.928784803,
    grid: {
      ra: 270,
      dec: 66.5,
      frame: 'ICRS',
      projection: 'TAN',
      pixel_scale_arcsec: 6.15,
      shape: [2, 2],
    },
    gate: {
      spatial_alignment: true,
      quantitative_difference_enabled: false,
      still_required_for_comparability: ['matching calibration'],
    },
    caveats: [],
    epochs: [
      {
        role: 'epoch-a',
        archive: {
          obs_id: '2025W18_1B_0095_2',
          detector: 2,
          date_obs_utc: '2025-04-29T03:50:28.360',
          pipeline_version: '6.4+psffix1',
          archive_url: 'https://example.invalid/epoch-a.fits',
          cutout_sha256: 'a'.repeat(64),
        },
        derived: {
          stats: { valid_fraction: 0.75, covered_fraction: 0.75 },
          units: 'MJy / sr',
          wcs: { crval: [270, 66.5] },
          output_sha256: 'a'.repeat(64),
          arrays_sha256: { IMAGE: 'x'.repeat(64), MASK: 'y'.repeat(64) },
          checks: ['wcs_roundtrip'],
        },
      },
      {
        role: 'epoch-b',
        archive: {
          obs_id: '2025W46_2A_0537_1',
          detector: 2,
          date_obs_utc: '2025-11-16T02:07:55.367',
          pipeline_version: '6.4+psffix1',
          archive_url: 'https://example.invalid/epoch-b.fits',
          cutout_sha256: 'b'.repeat(64),
        },
        derived: {
          stats: { valid_fraction: 0.5, covered_fraction: 0.75 },
          units: 'MJy / sr',
          wcs: { crval: [270, 66.5] },
          output_sha256: 'b'.repeat(64),
          arrays_sha256: { IMAGE: 'x'.repeat(64), MASK: 'y'.repeat(64) },
          checks: ['wcs_roundtrip'],
        },
      },
    ],
    ...overrides,
  };
}

function fakeStore({ metadata = fakeMetadata(), rasters } = {}) {
  const rasterMap = new Map(rasters ?? [
    ['epoch-a', wireRaster([0, 1, 2, 3], [1, 1, 1, 1], 2, 2)],
    ['epoch-b', wireRaster([10, 11, 12, 13], [1, 1, 1, 1], 2, 2)],
  ]);
  return {
    metadata: async () => metadata,
    raster: async (role) => {
      const value = rasterMap.get(role);
      if (!value) throw new Error(`unknown role ${role}`);
      return value;
    },
  };
}

function serve(service) {
  const app = express();
  app.use('/api/spherex/sky/archive', createSpherexArchiveSkyRouter(service));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test('the shared stretch uses only valid pixels from every epoch', () => {
  const stretch = sharedStretch([
    { image: Float32Array.from([0, 5, 10]), mask: Uint8Array.from([1, 1, 1]) },
    { image: Float32Array.from([20, Number.NaN, 30]), mask: Uint8Array.from([1, 1, 1]) },
  ]);
  assert.ok(stretch.lo <= 5);
  assert.ok(stretch.hi >= 20);
  assert.equal(stretch.sampleSize, 5);
  assert.equal(stretch.method, 'shared-linear-percentile');

  const masked = sharedStretch([
    { image: Float32Array.from([0, 100]), mask: Uint8Array.from([1, 0]) },
    { image: Float32Array.from([10, 20]), mask: Uint8Array.from([1, 1]) },
  ]);
  assert.ok(masked.hi < 100, 'an invalid high pixel must not set the stretch');
});

test('archive pixels keep invalid samples transparent and flip to north-up rows', () => {
  // FITS row 0 is south. Put the brightest values in the north row.
  const pixels = renderArchivePixels({
    image: Float32Array.from([10, 20, 30, 40]),
    mask: Uint8Array.from([1, 1, 1, 0]),
    width: 2,
    height: 2,
  }, { lo: 0, hi: 40 });
  const index = (x, y) => (y * 2 + x) * 4;
  assert.equal(pixels[index(0, 0)], 191, 'north-west pixel comes from FITS row 1');
  assert.equal(pixels[index(1, 0) + 3], 0, 'an invalid north-east pixel is transparent');
  assert.equal(pixels[index(0, 1)], 64, 'south-west pixel is dimmer');
  assert.equal(pixels[index(1, 1)], 128, 'south-east pixel is dimmer');
});

test('the archive service exposes the two real epochs, their provenance and the gate', async () => {
  const service = createArchiveSkyService({ store: fakeStore() });
  const index = await service.index();

  assert.equal(index.schema, ARCHIVE_SKY_SCHEMA);
  assert.equal(index.mode, 'archive');
  assert.match(index.modelRevision, /^archive-[0-9a-f]{12}$/);
  assert.equal(index.dataset.globalCoverage, false);
  assert.equal(index.dataset.regionOnly, true);
  assert.equal(index.dataset.epochs, 2);
  assert.equal(index.dataset.baselineDays, 200.928784803);
  assert.deepEqual(index.epochs.map((epoch) => epoch.id), ['epoch-a', 'epoch-b']);
  assert.ok(index.epochs.every((epoch) => epoch.status === 'archive'));
  assert.ok(index.epochs.every((epoch) => epoch.coverage === epoch.derived.stats.valid_fraction));
  assert.equal(index.epochs[0].archive.obs_id, '2025W18_1B_0095_2');
  assert.equal(index.epochs[1].archive.obs_id, '2025W46_2A_0537_1');
  assert.equal(index.epochs[0].archive.cutout_sha256, 'a'.repeat(64));
  assert.equal(index.surface.kind, 'regional-tan');
  assert.equal(index.surface.x_axis_direction, 'west');
  assert.deepEqual(index.surface.shape, [2, 2]);
  assert.equal(index.comparison.quantitativeDifferenceEnabled, false);
  assert.deepEqual(index.gate.still_required_for_comparability, ['matching calibration']);
  assert.ok(index.epochs.every((epoch) => /\/api\/spherex\/sky\/archive\/epoch-[ab]\.png$/.test(epoch.raster)));
  assert.match(index.surface.urlTemplate, /archive\/\{epoch\}\.png$/);
  assert.equal(index.sources.candidates.length, 0);
  assert.match(index.notice, /not a full-sky archive/i);
});

test('archive rasters are valid PNGs with a shared stretch and honest headers', async () => {
  const service = createArchiveSkyService({ store: fakeStore() });
  const a = await service.render('epoch-a');
  const b = await service.render('epoch-b');

  assert.deepEqual(pngSize(a.png), { width: 2, height: 2 });
  assert.equal(a.mode, 'archive');
  assert.equal(a.epoch, 'epoch-a');
  assert.equal(a.sourceSha256, 'c'.repeat(64));
  assert.deepEqual(a.stretch, b.stretch, 'one stretch is shared by both epochs');
  assert.notEqual(a.etag, b.etag, 'the two real observations are not byte-identical');
  assert.ok(a.png.length > 8);

  const again = await service.render('epoch-a');
  assert.equal(again.cached, true);
  assert.equal(again.etag, a.etag);
  assert.deepEqual(again.png, a.png);

  await assert.rejects(() => service.render('epoch-c'), (error) => error instanceof ArchiveSkyError
    && error.code === 'unknown_epoch');
});

test('the archive router serves the index, the PNG and an honest 404', async () => {
  const { server, base } = await serve(createArchiveSkyService({ store: fakeStore() }));
  try {
    const indexRes = await fetch(`${base}/api/spherex/sky/archive`);
    assert.equal(indexRes.status, 200);
    assert.match(indexRes.headers.get('content-type'), /application\/json/);
    const index = await indexRes.json();
    assert.equal(index.mode, 'archive');
    assert.equal(index.epochs.length, 2);

    const pngRes = await fetch(`${base}/api/spherex/sky/archive/epoch-a.png`);
    assert.equal(pngRes.status, 200);
    assert.equal(pngRes.headers.get('content-type'), 'image/png');
    assert.equal(pngRes.headers.get('x-novochar-sky-mode'), 'archive');
    assert.equal(pngRes.headers.get('x-novochar-sky-epoch'), 'epoch-a');
    assert.equal(pngRes.headers.get('x-novochar-sky-role'), 'epoch-a');
    assert.equal(pngRes.headers.get('x-novochar-sky-output-sha256'), 'a'.repeat(64));
    assert.equal(pngRes.headers.get('x-novochar-sky-width'), '2');
    assert.equal(pngRes.headers.get('x-novochar-sky-height'), '2');
    assert.ok(pngRes.headers.get('etag'));
    const { width, height } = pngSize(new Uint8Array(await pngRes.arrayBuffer()));
    assert.equal(width, 2);
    assert.equal(height, 2);

    const etag = pngRes.headers.get('etag');
    const cachedRes = await fetch(`${base}/api/spherex/sky/archive/epoch-a.png`, {
      headers: { 'If-None-Match': etag },
    });
    assert.equal(cachedRes.status, 304);
    assert.equal(await cachedRes.text(), '');

    const missingRes = await fetch(`${base}/api/spherex/sky/archive/epoch-z.png`);
    assert.equal(missingRes.status, 404);
    const body = await missingRes.json();
    assert.equal(body.code, 'unknown_epoch');
  } finally {
    server.close();
  }
});

test('archive errors map to honest HTTP statuses', () => {
  assert.equal(statusForArchiveError(new ArchiveSkyError('unknown_epoch', 'x')), 404);
  assert.equal(statusForArchiveError(new ArchiveSkyError('archive_unavailable', 'x')), 503);
  assert.equal(statusForArchiveError(new ArchiveSkyError('archive_invalid', 'x')), 500);
  assert.equal(statusForArchiveError(new Error('x')), 500);
});

test('the archive service rejects an injected store that cannot serve products', () => {
  assert.throws(() => createArchiveSkyService({ store: null }), /requires/);
  assert.throws(() => createArchiveSkyService({ store: { metadata: () => {} } }), /requires/);
});
