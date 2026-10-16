// Integration smoke test for the new API routes (spectra / heatmap / ivoa).
//
// Boots the Express app on an ephemeral port (via node:test hooks) and hits
// the Layer-1/Layer-4 endpoints added for the roadmap. IVOA *live* queries that
// would need the network are intentionally not exercised here — the clients are
// unit-tested with injected fetch in ivoa.test.js.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import app from './index.js';
import { generateSurvey } from './data.js';

let server;
let base;
const OBJECTS_N = generateSurvey().objects.length;

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
  const res = await fetch(`${base}/api/spectra/NC-0001`);
  assert.equal(res.status, 200);
  const { sed } = await res.json();
  assert.equal(sed.object.id, 'NC-0001');
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
  assert.equal(hm.bins.reduce((s, b) => s + b.count, 0), OBJECTS_N);
  assert.ok(hm.bins.length > 0);
});

test('GET /api/field/heatmap clamps nside', async () => {
  const res = await fetch(`${base}/api/field/heatmap?nside=999999`);
  const hm = await res.json();
  assert.ok(hm.nside <= 1024);
});

test('GET /api/field/heatmap rejects a non-numeric nside', async () => {
  const res = await fetch(`${base}/api/field/heatmap?nside=abc`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /nside/);
});

test('GET /api/objects/:id/blink rejects a non-numeric count', async () => {
  const res = await fetch(`${base}/api/objects/NC-0001/blink?count=abc`);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /count/);
});

test('GET /api/objects/:id/blink returns frames for the selected object', async () => {
  const res = await fetch(`${base}/api/objects/NC-0001/blink?count=6`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.object.id, 'NC-0001');
  assert.equal(data.frames.length, 6);
  assert.ok(data.frames[0].epochISO);
});

test('GET /api/objects/:id/blink returns frames for the selected object', async () => {
  const res = await fetch(`${base}/api/objects/NC-0001/blink?count=6`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.object.id, 'NC-0001');
  assert.equal(data.frames.length, 6);
  assert.ok(data.frames[0].epochISO);
});

test('GET /api/observe/shell returns a band with bounds and coverage', async () => {
  const res = await fetch(`${base}/api/observe/shell`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /max-age/);
  const data = await res.json();
  assert.deepEqual(data.bounds, { rMin: 90, rMax: 110, unit: 'ly' });
  assert.ok(Array.isArray(data.records));
  assert.ok(Array.isArray(data.coverage));
  assert.ok(data.counts.rows > 0);
});

test('GET /api/observe/shell honours the query unit and layer selection', async () => {
  const res = await fetch(`${base}/api/observe/shell?radius=10&thickness=1&unit=pc&include=located&sources=survey`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.selection.unit, 'pc');
  assert.ok(Math.abs(data.bounds.rMin - 9.5 * 3.261563777) < 1e-6);
  assert.equal(data.bounds.unit, 'ly');
  assert.ok(data.records.every((record) => record.status === 'located'));
});

test('GET /api/observe/shell validates its parameters', async () => {
  assert.equal((await fetch(`${base}/api/observe/shell?unit=furlong`)).status, 400);
  assert.equal((await fetch(`${base}/api/observe/shell?include=nope`)).status, 400);
  assert.equal((await fetch(`${base}/api/observe/shell?radius=-1`)).status, 400);
  const badCursor = await fetch(`${base}/api/observe/shell?cursor=not-a-cursor`);
  assert.equal(badCursor.status, 400);
  const body = await badCursor.json();
  assert.equal(body.code, 'invalid-cursor');
  assert.equal(body.reason, 'malformed');
});

test('GET /api/observe/shell pages with a query-bound cursor and rejects stale ones', async () => {
  const firstRes = await fetch(`${base}/api/observe/shell?limit=10`);
  assert.equal(firstRes.status, 200);
  const first = await firstRes.json();
  assert.equal(typeof first.page.next, 'string', 'the next cursor is an opaque token');

  // The same query continues at the next offset without repeating records.
  const secondRes = await fetch(`${base}/api/observe/shell?limit=10&cursor=${encodeURIComponent(first.page.next)}`);
  assert.equal(secondRes.status, 200);
  const second = await secondRes.json();
  assert.equal(second.page.offset, 10);
  const seen = new Set(first.records.map((record) => record.id));
  assert.ok(second.records.every((record) => !seen.has(record.id)));

  // The same token under a different band is an explicit mismatch, not a guess.
  const staleRes = await fetch(`${base}/api/observe/shell?radius=250&limit=10&cursor=${encodeURIComponent(first.page.next)}`);
  assert.equal(staleRes.status, 400);
  const stale = await staleRes.json();
  assert.equal(stale.code, 'invalid-cursor');
  assert.equal(stale.reason, 'mismatch');
});

test('GET /api/observe/shell exposes the unknown/directional layer honestly', async () => {
  const res = await fetch(`${base}/api/observe/shell?include=unknown&sources=stars&limit=50`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.selection.layers.unknown, true);
  assert.equal(data.selection.layers.located, false);
  assert.ok(data.records.every((record) => record.status === 'unknown'));
  assert.ok(data.coverage.every((coverage) => coverage.source !== 'survey'));
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