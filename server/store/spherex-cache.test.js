// Unit tests for the on-disk cutout cache (Layer 3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { putCutout, getCutout, hasCutout, listCutouts, removeCutout } from './spherex-cache.js';
import { sha256Hex } from '../ivoa/spherex.js';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novochar-spherex-cache-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

const PROV = {
  sourceUrl: 'https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/x.fits?center=270,66.5&size=0.5',
  obsId: '2025W18_1B_0095_2',
  detector: 'D2',
  sizeDeg: 0.5,
  collection: 'spherex_qr2',
};

test('putCutout writes bytes verbatim plus a provenance sidecar', async (t) => {
  const dir = await tempDir(t);
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  const record = await putCutout(dir, 'X_D2_0.5deg', bytes, PROV);

  assert.equal(record.sha256, await sha256Hex(bytes));
  assert.equal(record.byteLength, 5);
  assert.equal(record.obsId, '2025W18_1B_0095_2');
  assert.ok(record.fetchedAt);

  const stored = new Uint8Array(await readFile(join(dir, 'X_D2_0.5deg.fits')));
  assert.deepEqual([...stored], [1, 2, 3, 4, 5]);
  const sidecar = JSON.parse(await readFile(join(dir, 'X_D2_0.5deg.provenance.json'), 'utf8'));
  assert.equal(sidecar.detector, 'D2');
});

test('getCutout returns verified bytes; absent keys return null', async (t) => {
  const dir = await tempDir(t);
  const bytes = new Uint8Array([9, 8, 7]);
  await putCutout(dir, 'K', bytes, PROV);

  const hit = await getCutout(dir, 'K');
  assert.equal(hit.corrupt, false);
  assert.equal(hit.provenance.obsId, PROV.obsId);
  assert.deepEqual([...hit.bytes], [9, 8, 7]);

  assert.equal(await getCutout(dir, 'missing'), null);
  assert.equal(await hasCutout(dir, 'K'), true);
  assert.equal(await hasCutout(dir, 'missing'), false);
});

test('getCutout reports corruption rather than returning wrong pixels', async (t) => {
  const dir = await tempDir(t);
  await putCutout(dir, 'K', new Uint8Array([1, 2, 3]), PROV);
  // Tamper with the stored bytes behind the cache's back.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'K.fits'), Buffer.from([1, 2, 4]));

  const hit = await getCutout(dir, 'K');
  assert.equal(hit.corrupt, true);
  assert.notEqual(hit.actualSha256, hit.provenance.sha256);
});

test('listCutouts and removeCutout operate on the provenance index', async (t) => {
  const dir = await tempDir(t);
  await putCutout(dir, 'B', new Uint8Array([1]), PROV);
  await putCutout(dir, 'A', new Uint8Array([2]), PROV);

  assert.deepEqual(await listCutouts(dir), ['A', 'B']);
  assert.equal(await removeCutout(dir, 'A'), true);
  assert.deepEqual(await listCutouts(dir), ['B']);
  assert.equal(await removeCutout(dir, 'A'), false);
  assert.deepEqual(await listCutouts(join(dir, 'does-not-exist')), []);
});
