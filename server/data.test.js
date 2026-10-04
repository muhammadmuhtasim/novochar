// Unit tests for the richer marker channels added to the survey generator
// (RFC: richer markers / co-ordinated views). We assert the extra per-object
// fields the sky viewer + linked-analysis panel now rely on are present and
// deterministic for every generated object.
//
//   node --test data.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSurvey, SPHEREX_BANDS } from './data.js';

const { survey, passes, objects } = generateSurvey();

test('every object ships the richer marker channels', () => {
  assert.ok(objects.length > 0);
  for (const o of objects) {
    // position angle of motion (deg, east of north)
    assert.equal(typeof o.pa, 'number');
    assert.ok(o.pa >= 0 && o.pa <= 360, `pa in range for ${o.id}`);
    // detection confidence
    assert.equal(typeof o.snr, 'number');
    assert.ok(o.snr > 0, `snr positive for ${o.id}`);
    // multi-band coverage
    assert.equal(typeof o.nBands, 'number');
    assert.ok(o.nBands >= 1 && o.nBands <= 6, `nBands in 1..6 for ${o.id}`);
    // per-band magnitudes
    assert.ok(Array.isArray(o.mags));
    assert.equal(o.mags.length, SPHEREX_BANDS.length);
    o.mags.forEach((m, i) => {
      assert.equal(typeof m, 'number', `mags[${i}] numeric for ${o.id}`);
    });
  }
});

test('colour indices (B1-B3 and B4-B6) are computable from mags', () => {
  for (const o of objects) {
    const c13 = o.mags[0] - o.mags[2]; // Band 1 - Band 3
    const c46 = o.mags[3] - o.mags[5]; // Band 4 - Band 6
    assert.ok(Number.isFinite(c13) && Number.isFinite(c46), `indices finite for ${o.id}`);
  }
});

test('generation is deterministic (same fields on repeat)', () => {
  const again = generateSurvey();
  const a = objects[0];
  const b = again.objects[0];
  assert.equal(a.pa, b.pa);
  assert.equal(a.snr, b.snr);
  assert.equal(a.nBands, b.nBands);
  assert.deepEqual(a.mags, b.mags);
});