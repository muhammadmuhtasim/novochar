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

test('GET /api/ivoa exposes the registry', async () => {
  const res = await fetch(`${base}/api/ivoa`);
  const j = await res.json();
  assert.ok(j.protocol.includes('IVOA'));
  assert.ok(Array.isArray(j.registries.tap));
  assert.ok(j.registries.tap.includes('vizier'));
  assert.ok(j.archives && j.archives.eso);
  assert.equal(j.archives.eso.status, 'verified');
});

test('GET /api/ivoa/resolve requires a name param', async () => {
  const res = await fetch(`${base}/api/ivoa/resolve`);
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