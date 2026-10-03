// Integration smoke test for the new API routes (spectra / heatmap / ivoa).
//
// Boots the Express app on an ephemeral port (via node:test hooks) and hits
// the Layer-1/Layer-4 endpoints added for the roadmap. IVOA *live* queries that
// would need the network are intentionally not exercised here — the clients are
// unit-tested with injected fetch in ivoa.test.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from './index.js';

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});
after(() => server.close());

test('GET /api/spectra/:id returns a complete SED', async () => {
  const res = await fetch(`${base}/api/spectra/NC-001`);
  assert.equal(res.status, 200);
  const { sed } = await res.json();
  assert.equal(sed.object.id, 'NC-001');
  assert.ok(sed.photometry.length === 9);
  assert.ok(sed.spectrum.length > 100);
  assert.ok(sed.object.teff > 0);
});

test('GET /api/spectra/:id 404s for unknown objects', async () => {
  const res = await fetch(`${base}/api/spectra/NC-9999`);
  assert.equal(res.status, 404);
});

test('GET /api/field/heatmap bins the field', async () => {
  const res = await fetch(`${base}/api/field/heatmap?nside=16`);
  assert.equal(res.status, 200);
  const hm = await res.json();
  assert.equal(hm.nside, 16);
  assert.equal(hm.bins.reduce((s, b) => s + b.count, 0), 40);
  assert.ok(hm.bins.length > 0);
});

test('GET /api/field/heatmap clamps nside', async () => {
  const res = await fetch(`${base}/api/field/heatmap?nside=999999`);
  const hm = await res.json();
  assert.ok(hm.nside <= 1024);
});

test('GET /api/objects/:id/blink returns frames for the selected object', async () => {
  const res = await fetch(`${base}/api/objects/NC-001/blink?count=6`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.object.id, 'NC-001');
  assert.equal(data.frames.length, 6);
  assert.ok(data.frames[0].epochISO);
});

test('GET /api/ivoa exposes the registry', async () => {
  const res = await fetch(`${base}/api/ivoa`);
  const j = await res.json();
  assert.ok(j.protocol.includes('IVOA'));
  assert.ok(Array.isArray(j.registries.tap));
  assert.ok(j.registries.tap.includes('vizier'));
  assert.ok(j.archives && j.archives.eso);
  assert.equal(j.archives.eso.status, 'verified');
});

test('GET /api/archives lists implemented archive operations', async () => {
  const res = await fetch(`${base}/api/archives`);
  assert.equal(res.status, 200);
  const { archives } = await res.json();
  assert.ok(archives.mast.protocols.includes('rest'));
  assert.ok(archives.ned.protocols.includes('rest'));
  assert.equal(archives.lambda.state, 'file-route-present-live-unverified');
});

test('POST /api/archives validates archive operations before outbound requests', async () => {
  const res = await fetch(`${base}/api/archives/mast/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'cone', params: { ra: 999, dec: 0 } }),
  });
  assert.equal(res.status, 400);
});

test('GET /api/archives/lambda/file rejects traversal paths', async () => {
  const res = await fetch(`${base}/api/archives/lambda/file?path=..%2Fsecret`);
  assert.equal(res.status, 400);
});

test('GET /api/archives/mast/file rejects non-MAST URLs', async () => {
  const res = await fetch(`${base}/api/archives/mast/file?uri=https%3A%2F%2Fattacker.example%2Ffile`);
  assert.equal(res.status, 400);
});

test('GET /api/archives/darts/file rejects traversal paths', async () => {
  const res = await fetch(`${base}/api/archives/darts/file?path=..%2Fprivate`);
  assert.equal(res.status, 400);
});

test('GET /api/ivoa/resolve requires a name param', async () => {
  const res = await fetch(`${base}/api/ivoa/resolve`);
  assert.equal(res.status, 400);
});

test('GET /api/ivoa/gaia/motion validates required coordinates', async () => {
  const res = await fetch(`${base}/api/ivoa/gaia/motion`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /ra.*dec/);
});

test('GET /api/ivoa/gaia/motion rejects invalid cone radius before network access', async () => {
  const res = await fetch(`${base}/api/ivoa/gaia/motion?ra=10&dec=20&radius=5`);
  assert.equal(res.status, 400);
});

test('GET /api/ivoa/... live queries fail gracefully under error', async () => {
  // A bad TAP endpoint URL triggers a network/parse error which the route turns
  // into a 502 rather than an unhandled crash.
  const res = await fetch(
    `${base}/api/ivoa/tap?endpoint=http%3A%2F%2F127.0.0.1%3A1%2Ftap&query=SELECT%20*%20FROM%20x`,
    { signal: AbortSignal.timeout(2500) }
  );
  assert.ok([502, 200].includes(res.status));
});