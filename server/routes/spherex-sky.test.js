// HTTP-contract tests for the four-epoch sky-tile routes.
//
// The renderer is injected, so these tests assert status codes, headers and
// parameter forwarding without spending CPU on PNG generation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSpherexSkyRouter, statusForSkyError } from './spherex-sky.js';
import { SkyTileError, skyIndex, skySources } from '../spherex/sky-tiles.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

function fakeResult(overrides = {}) {
  return {
    png: PNG,
    etag: '"abc123"',
    mode: 'illustrative',
    cached: false,
    epoch: 'epoch-1',
    width: 512,
    height: 256,
    order: 1,
    ipix: 0,
    size: 128,
    ...overrides,
  };
}

function serve(options) {
  const app = express();
  app.use('/api/spherex/sky', createSpherexSkyRouter(options));
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

test('GET /api/spherex/sky serves the index', async () => {
  const { server, base } = await serve({
    index: () => ({ schema: 'test', epochs: [] }),
    sources: () => ({ candidates: [] }),
    renderBase: () => fakeResult(),
    renderTile: () => fakeResult(),
  });
  try {
    const res = await fetch(`${base}/api/spherex/sky`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/json/);
    assert.match(res.headers.get('cache-control'), /max-age=300/);
    assert.deepEqual(await res.json(), { schema: 'test', epochs: [] });
  } finally {
    server.close();
  }
});

test('GET /api/spherex/sky/sources serves the change layer', async () => {
  const { server, base } = await serve({
    index: () => ({}),
    sources: () => ({ schema: 'src', candidates: [{ id: 'x' }] }),
    renderBase: () => fakeResult(),
    renderTile: () => fakeResult(),
  });
  try {
    const res = await fetch(`${base}/api/spherex/sky/sources`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { schema: 'src', candidates: [{ id: 'x' }] });
  } finally {
    server.close();
  }
});

test('base and tile routes serve PNGs with integrity and cache headers', async () => {
  const calls = [];
  const { server, base } = await serve({
    index: () => ({}),
    sources: () => ({}),
    renderBase: (args) => {
      calls.push(['base', args]);
      return fakeResult({ width: 512, height: 256 });
    },
    renderTile: (args) => {
      calls.push(['tile', args]);
      return fakeResult({ order: 2, ipix: 7, size: 128 });
    },
  });
  try {
    const baseRes = await fetch(`${base}/api/spherex/sky/base/epoch-1.png`);
    assert.equal(baseRes.status, 200);
    assert.equal(baseRes.headers.get('content-type'), 'image/png');
    assert.match(baseRes.headers.get('cache-control'), /max-age=86400/);
    assert.equal(baseRes.headers.get('etag'), '"abc123"');
    assert.equal(baseRes.headers.get('x-novochar-sky-mode'), 'illustrative');
    assert.equal(baseRes.headers.get('x-novochar-sky-epoch'), 'epoch-1');
    assert.equal(baseRes.headers.get('x-novochar-sky-width'), '512');
    assert.deepEqual(new Uint8Array(await baseRes.arrayBuffer()), new Uint8Array(PNG));
    assert.deepEqual(calls[0], ['base', { epoch: 'epoch-1' }]);

    const tileRes = await fetch(`${base}/api/spherex/sky/tile/epoch-2/2/7.png`);
    assert.equal(tileRes.status, 200);
    assert.equal(tileRes.headers.get('content-type'), 'image/png');
    assert.equal(tileRes.headers.get('x-novochar-sky-order'), '2');
    assert.equal(tileRes.headers.get('x-novochar-sky-ipix'), '7');
    assert.equal(tileRes.headers.get('x-novochar-sky-size'), '128');
    assert.deepEqual(calls[1], ['tile', { epoch: 'epoch-2', order: '2', ipix: '7' }]);
  } finally {
    server.close();
  }
});

test('a matching ETag returns 304 without a body', async () => {
  const { server, base } = await serve({
    index: () => ({}),
    sources: () => ({}),
    renderBase: () => fakeResult(),
    renderTile: () => fakeResult(),
  });
  try {
    const res = await fetch(`${base}/api/spherex/sky/tile/epoch-1/1/0.png`, {
      headers: { 'If-None-Match': '"abc123"' },
    });
    assert.equal(res.status, 304);
    assert.equal(await res.text(), '');
  } finally {
    server.close();
  }
});

test('invalid tile requests are reported as JSON, never as a blank image', async () => {
  const fail = (code, message) => () => { throw new SkyTileError(code, message); };
  const cases = [
    ['/base/nope.png', 'unknown_epoch', 404],
    ['/base/epoch-1.png', 'bad_request', 400],
    ['/tile/epoch-1/0/0.png', 'bad_tile', 400],
    ['/tile/nope/1/0.png', 'unknown_epoch', 404],
    ['/tile/epoch-1/1/0.png', 'boom', 500],
  ];
  for (const [path, code, status] of cases) {
    const { server, base } = await serve({
      index: () => ({}),
      sources: () => ({}),
      renderBase: path.startsWith('/base') ? fail(code, `${code} failure`) : () => fakeResult(),
      renderTile: path.startsWith('/tile') ? fail(code, `${code} failure`) : () => fakeResult(),
    });
    try {
      const res = await fetch(`${base}/api/spherex/sky${path}`);
      assert.equal(res.status, status, `${path} -> ${status}`);
      assert.match(res.headers.get('content-type'), /application\/json/);
      const body = await res.json();
      assert.equal(body.code, code);
      assert.match(body.error, /failure|unknown|bad/);
    } finally {
      server.close();
    }
  }
});

test('statusForSkyError distinguishes client mistakes from server failures', () => {
  assert.equal(statusForSkyError(new SkyTileError('unknown_epoch', 'x')), 404);
  assert.equal(statusForSkyError(new SkyTileError('bad_tile', 'x')), 400);
  assert.equal(statusForSkyError(new SkyTileError('bad_request', 'x')), 400);
  assert.equal(statusForSkyError(new SkyTileError('other', 'x')), 500);
  assert.equal(statusForSkyError(new Error('x')), 500);
});

test('the router requires all four injectable functions', () => {
  assert.throws(() => createSpherexSkyRouter(null), /requires/);
  assert.throws(() => createSpherexSkyRouter({ renderTile: null }), /requires/);
  assert.throws(() => createSpherexSkyRouter({
    renderTile: () => {},
    renderBase: () => {},
    index: () => {},
    sources: null,
  }), /requires/);
});

test('the public index and sources are self-consistent', () => {
  const index = skyIndex();
  const sources = skySources();
  const epochIds = new Set(index.epochs.map((e) => e.id));
  for (const candidate of sources.candidates) {
    for (const epoch of candidate.epochs) {
      assert.ok(epochIds.has(epoch.epoch), `unknown epoch ${epoch.epoch}`);
    }
  }
  assert.equal(sources.epochs.length, index.epochs.length);
});
