// HTTP-surface tests for the M3-C SPHEREx product routes.
//
// The store is injected, so this file needs no Python, no network and no cache.
// The important assertions here are Contract 4 ones: the product surface is a
// *closed* set of two routes, and none of them differences two epochs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSpherexProductsRouter, statusForError } from './spherex-products.js';
import { ProductError, WIRE_FORMAT } from '../store/spherex-products.js';

function serve(store) {
  const app = express();
  app.use('/api/spherex', createSpherexProductsRouter(store));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const METADATA = {
  schema: 'novochar.spherex.derived/v1',
  grid: { id: 'nep-qr2-common' },
  gate: { spatial_alignment: true, quantitative_difference_enabled: false },
  epochs: [
    {
      role: 'epoch-a',
      archive: { obs_id: '2025W18_1B_0095_2', date_obs_utc: '2025-04-29T03:50:28.360' },
      derived: { units: 'MJy / sr', shape: [294, 294] },
      raster: '/api/spherex/products/epoch-a/raster',
    },
  ],
};

function fakeStore(overrides = {}) {
  return {
    metadata: async () => METADATA,
    raster: async () => ({
      bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
      width: 1,
      height: 2,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }),
    ...overrides,
  };
}

test('GET /api/spherex/products serves metadata and no pixels', async () => {
  const { server, base } = await serve(fakeStore());
  try {
    const res = await fetch(`${base}/api/spherex/products`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = await res.json();
    assert.equal(body.gate.quantitative_difference_enabled, false);
    assert.equal(body.epochs[0].archive.obs_id, '2025W18_1B_0095_2');
    assert.equal(body.epochs[0].derived.units, 'MJy / sr');
  } finally {
    server.close();
  }
});

test('GET /:role/raster serves the wire format with integrity headers', async () => {
  const { server, base } = await serve(fakeStore());
  try {
    const res = await fetch(`${base}/api/spherex/products/epoch-a/raster`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/octet-stream');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-novochar-wire'), WIRE_FORMAT);
    assert.equal(res.headers.get('x-novochar-width'), '1');
    assert.equal(res.headers.get('x-novochar-height'), '2');
    assert.equal(
      res.headers.get('x-novochar-sha256'),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...bytes], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  } finally {
    server.close();
  }
});

test('maps product failures to honest statuses rather than empty images', async () => {
  const failing = (err) => fakeStore({
    metadata: async () => { throw err; },
    raster: async () => { throw err; },
  });
  const cases = [
    [new ProductError('product_unavailable', 'unknown role'), 404],
    [new ProductError('cutout_unavailable', 'archive unreachable'), 503],
    [new ProductError('sidecar_unavailable', 'python missing'), 503],
    [new ProductError('reprojection_failed', 'gate not passed'), 503],
    [new Error('surprise'), 500],
  ];

  for (const [err, status] of cases) {
    const { server, base } = await serve(failing(err));
    try {
      const meta = await fetch(`${base}/api/spherex/products`);
      assert.equal(meta.status, status, `${err.code ?? err.message} metadata`);
      const json = await meta.json();
      assert.equal(json.error, err.message);
      assert.equal(json.code, err.code ?? null);

      const raster = await fetch(`${base}/api/spherex/products/epoch-a/raster`);
      assert.equal(raster.status, status, `${err.code ?? err.message} raster`);
      assert.match(raster.headers.get('content-type'), /application\/json/, 'a failure is JSON, never a blank raster');
    } finally {
      server.close();
    }
  }
});

test('statusForError treats only a missing product as a client mistake', () => {
  assert.equal(statusForError(new ProductError('product_unavailable', 'x')), 404);
  assert.equal(statusForError(new ProductError('sidecar_unavailable', 'x')), 503);
  assert.equal(statusForError(new ProductError('reprojection_failed', 'x')), 503);
  assert.equal(statusForError(new Error('x')), 500);
});

test('rejects a store that cannot serve products', () => {
  assert.throws(() => createSpherexProductsRouter(null), /requires a product store/);
  assert.throws(() => createSpherexProductsRouter({ metadata: async () => ({}) }), /requires a product store/);
});

// --- Contract 4 ---------------------------------------------------------------
//
// The product surface is closed: these two routes are all there is, and none of
// them differences, subtracts or photometers two epochs. Any new route has to be
// added here on purpose.

function routeTable(router) {
  return router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]).sort(),
    }));
}

test('no SPHEREx product route differences two epochs', () => {
  const router = createSpherexProductsRouter(fakeStore());
  const routes = routeTable(router);

  assert.deepEqual(
    routes.map((r) => `${r.methods.join(',')} ${r.path}`).sort(),
    ['get /products', 'get /products/:role/raster'],
    'the product surface is exactly these two routes',
  );

  const forbidden = /difference|subtract|delta|photometr|variab/i;
  for (const route of routes) {
    assert.doesNotMatch(route.path, forbidden, `"${route.path}" looks like a difference product`);
  }
});
