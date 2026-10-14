// Unit tests for the blink comparator's tangent-plane astrometry helpers.
//
//   node --test astrometry.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dRADegWrapped,
  eastWestMas,
  northSouthMas,
  motionPath,
  spanDays,
  motionStats,
  classifyMotion,
} from './astrometry.js';

// A tiny synthetic frame series: 1 mas north per pass, 2 mas east per pass,
// spaced 8.5 days apart along the JD clock.
function series(n = 6) {
  const frames = [];
  for (let i = 0; i < n; i++) {
    frames.push({
      ra: 100 + (2 * i) / (3.6e6 * Math.cos((20 * Math.PI) / 180)),
      dec: 20 + (1 * i) / 3.6e6,
      epochJD: 2461000 + i * 8.5,
      epochISO: new Date(Date.UTC(2026, 0, 5) + i * 8.5 * 86_400_000).toISOString(),
      measuredMag: 17 + 0.1 * i,
      passCode: `P-0${i + 1}`,
    });
  }
  return frames;
}

test('dRADegWrapped wraps into (−180, 180]', () => {
  assert.equal(dRADegWrapped(10, 350), 20);
  assert.equal(dRADegWrapped(350, 10), -20);
  assert.ok(Math.abs(dRADegWrapped(0, 180) - -180) < 1e-9 || Math.abs(dRADegWrapped(0, 180) - 180) < 1e-9);
});

test('east-west separation shrinks with cos(dec) and is signed', () => {
  const atEq = eastWestMas(1, 0, 0, 0); // 1 deg at the equator = 3.6e6 mas
  assert.ok(Math.abs(atEq - 3.6e6) < 1e-6);
  const at60 = eastWestMas(1, 60, 0, 60);
  assert.ok(Math.abs(at60 - 1.8e6) < 1); // cos(60°) = 0.5
  assert.ok(eastWestMas(1, 0, 359, 0) > 0, 'wraps across RA=0 without a sign flip');
});

test('north-south separation is a plain scaled declination difference', () => {
  assert.equal(northSouthMas(1, 0), 3.6e6);
  assert.equal(northSouthMas(0, 1), -3.6e6);
});

test('motionPath is zero at the reference epoch and accumulates afterwards', () => {
  const path = motionPath(series(5));
  assert.equal(path.length, 5);
  assert.equal(path[0].east, 0);
  assert.equal(path[0].north, 0);
  assert.ok(path[4].north > path[3].north);
});

test('motionStats recovers the injected rate, span and position angle', () => {
  const frames = series(5); // 4 intervals × 8.5 d = 34 d; 1 mas N + 2 mas E per pass
  const s = motionStats(frames);
  assert.ok(Math.abs(s.spanDays - 34) < 1e-6, `spanDays ${s.spanDays}`);
  // net displacement after 4 steps: east 8 mas, north 4 mas -> total ~8.944 mas
  assert.ok(Math.abs(s.totalMas - Math.hypot(8, 4)) < 1e-6, `totalMas ${s.totalMas}`);
  assert.ok(Math.abs(s.masPerDay - s.totalMas / 34) < 1e-9);
  // east-of-north position angle = atan2(8, 4) = 63.43°
  assert.ok(Math.abs(s.paDeg - 63.4349) < 1e-3, `paDeg ${s.paDeg}`);
  assert.ok(s.magMin <= s.magMax);
});

test('a single frame (or none) yields a degenerate but safe summary', () => {
  assert.deepEqual(motionPath([]), []);
  const s = motionStats([series(1)[0]]);
  assert.equal(s.totalMas, 0);
  assert.equal(s.masPerDay, 0);
  assert.ok(Number.isNaN(s.paDeg));
});

test('classifyMotion maps rates onto the catalogue populations', () => {
  assert.equal(classifyMotion(1).key, 'tno');
  assert.equal(classifyMotion(30).key, 'ast');
  assert.equal(classifyMotion(120).key, 'neo');
  assert.equal(classifyMotion(500).key, 'hpm');
  assert.equal(classifyMotion(NaN).key, 'unknown');
});
