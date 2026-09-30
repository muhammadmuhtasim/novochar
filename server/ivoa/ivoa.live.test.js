// LIVE integration tests against the real IVOA archives.
//
// These actually hit the public endpoints and assert that genuine rows are
// returned. Gated behind NOVOCHAR_LIVE=1 so the default offline suite never
// depends on the network:
//
//   NOVOCHAR_LIVE=1 node --test ivoa/ivoa.live.test.js
//
// An archive passes only when a live request returns rows with QUERY_STATUS OK.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tapQuery } from './tap.js';
import { resolveObject } from './resolver.js';

const LIVE = process.env.NOVOCHAR_LIVE === '1';

const run = (fn, label, ms = 30000) =>
  Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' TIMEOUT')), ms))]);

if (!LIVE) {
  test('live tests skipped unless NOVOCHAR_LIVE=1 (run: NOVOCHAR_LIVE=1 node --test ivoa/ivoa.live.test.js)', () => {
    assert.ok(true);
  });
} else {
  test('VizieR TAP returns real Gaia DR2 catalog rows', async () => {
    const out = await run(() => tapQuery({ archive: 'vizier', query: 'SELECT TOP 3 * FROM "I/345/gaia2"' }));
    assert.equal(out.status, 'OK');
    assert.ok(out.rows.length >= 1, 'expected at least one row');
    assert.ok(out.rows[0].ra != null, 'row has ra');
  });

  test('ESO TAP returns real observation rows', async () => {
    const out = await run(() => tapQuery({ archive: 'eso', query: 'SELECT TOP 3 * FROM dbo.raw' }));
    assert.equal(out.status, 'OK');
    assert.ok(out.rows.length >= 1, 'expected at least one row');
    assert.ok(out.rows[0].access_url, 'row has access_url');
  });

  test('CDS Sesame resolves a name to realistic coordinates', async () => {
    // M31 = Andromeda: RA ~10.66°, Dec ~41.27° (J2000). M1/Crab ≈ 83.63 / 22.02.
    const r = await run(() => resolveObject('M31'));
    assert.equal(r.found, true);
    assert.ok(Math.abs(r.ra - 10.6638) < 0.5, `RA ${r.ra}`);
    assert.ok(r.dec > 40 && r.dec < 43, `DEC ${r.dec}`);
  });
}