// Unit tests for the richer marker channels added to the survey generator
// (RFC: richer markers / co-ordinated views). We assert the extra per-object
// fields the sky viewer + linked-analysis panel now rely on are present and
// deterministic for every generated object.
//
//   node --test data.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSurvey, buildFrames, SPHEREX_BANDS } from './data.js';

const { survey, passes, objects } = generateSurvey();

test('every object ships the richer marker channels', () => {
  assert.ok(objects.length > 0);
  for (const o of objects) {
    // Simulated object distance, measured in light-years (solar-system
    // candidates use heliocentric orbital distance; stars use observer distance).
    assert.equal(typeof o.distanceLy, 'number');
    assert.ok(Number.isFinite(o.distanceLy) && o.distanceLy > 0, `distanceLy positive for ${o.id}`);
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

test('blink frames carry the true on-sky drift, along the object position angle', () => {
  // Frames used to be ×60 amplified and always pointed at a fixed angle; they
  // must now encode the real mas/day rate and the object's own `pa`.
  for (const type of ['TNO', 'AST', 'HPM']) {
    const o = objects.filter((x) => x.type === type).sort((a, b) => b.motion - a.motion)[0];
    const frames = buildFrames(o, passes, 12);
    const f0 = frames[0];
    const fl = frames[frames.length - 1];
    const dE = (fl.ra - f0.ra) * Math.cos((fl.dec * Math.PI) / 180) * 3.6e6;
    const dN = (fl.dec - f0.dec) * 3.6e6;
    const days = fl.epochJD - f0.epochJD;
    const rate = Math.hypot(dE, dN) / days;
    assert.ok(
      Math.abs(rate - o.motion) / o.motion < 0.3,
      `${type} frame rate ${rate.toFixed(1)} should be near the model ${o.motion.toFixed(1)} mas/day`
    );
    let pa = (Math.atan2(dE, dN) * 180) / Math.PI;
    if (pa < 0) pa += 360;
    const dpa = Math.min(Math.abs(pa - o.pa), 360 - Math.abs(pa - o.pa));
    assert.ok(dpa < 25, `${type} frame direction ${pa.toFixed(1)}° should follow pa ${o.pa.toFixed(1)}°`);
  }
});

test('pass epochs advance ~8.5 days and agree with the JD clock', () => {
  for (let i = 1; i < passes.length; i++) {
    const prev = Date.parse(passes[i - 1].epochISO);
    const cur = Date.parse(passes[i].epochISO);
    assert.ok(cur > prev, `pass ${i} epoch advances in time`);
    const spacingDays = (cur - prev) / 86_400_000;
    // rounded to whole days, so successive gaps alternate 8/9 d
    assert.ok(Math.abs(spacingDays - 8.5) <= 0.6, `pass ${i} spacing ~8.5 d (got ${spacingDays})`);
    // the ISO and Julian-Date clocks must describe the same cadence
    assert.equal(passes[i].epochJD - passes[i - 1].epochJD, 8.5);
  }
  // 24 weekly-ish passes should span roughly six months, not a few hours.
  const span = (Date.parse(passes[passes.length - 1].epochISO) - Date.parse(passes[0].epochISO)) / 86_400_000;
  assert.ok(span > 150 && span < 220, `pass chain spans ~6 months (got ${span.toFixed(1)} d)`);
});

test('generation is deterministic (same fields on repeat)', () => {
  const again = generateSurvey();
  const a = objects[0];
  const b = again.objects[0];
  assert.equal(a.distanceLy, b.distanceLy);
  assert.equal(a.pa, b.pa);
  assert.equal(a.snr, b.snr);
  assert.equal(a.nBands, b.nBands);
  assert.deepEqual(a.mags, b.mags);
});
