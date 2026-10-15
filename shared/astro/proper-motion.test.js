// Proper-motion propagation tests (scientific basis, pole-safe exponential map).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { advanceAlongGreatCircle, propagateProperMotion } from './proper-motion.js';
import { sphericalToUnit } from './vector.js';
import { J2000_JD } from './epochs.js';

const DAYS_10YR = 3652.5;

function separationDeg(ra1, dec1, ra2, dec2) {
  const a = sphericalToUnit(ra1, dec1);
  const b = sphericalToUnit(ra2, dec2);
  const dot = Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  return (Math.acos(dot) * 180) / Math.PI;
}

test('zero motion is an exact no-op', () => {
  const r = propagateProperMotion({ raDeg: 10, decDeg: -20, refEpochJD: J2000_JD, targetEpochJD: J2000_JD + DAYS_10YR });
  assert.equal(r.raDeg, 10);
  assert.equal(r.decDeg, -20);
});

test('zero time offset is an exact no-op (pole included)', () => {
  for (const [ra, dec] of [[10, -20], [123, 90], [0, -90]]) {
    const r = propagateProperMotion({ raDeg: ra, decDeg: dec, pmRaMasYr: 5000, pmDecMasYr: 5000, refEpochJD: J2000_JD, targetEpochJD: J2000_JD });
    assert.equal(r.raDeg, ((ra % 360) + 360) % 360, `ra ${r.raDeg}`);
    assert.equal(r.decDeg, dec, `dec ${r.decDeg}`);
  }
});

test('declination advances linearly with pmDec (1000 mas/yr over 10 yr = 10 arcsec)', () => {
  const r = propagateProperMotion({ raDeg: 0, decDeg: 0, pmRaMasYr: 0, pmDecMasYr: 1000, refEpochJD: J2000_JD, targetEpochJD: J2000_JD + DAYS_10YR });
  assert.ok(Math.abs(r.decDeg - 10 / 3600) < 1e-9, `dec ${r.decDeg}`);
});

test('the RA change carries the cos(dec) factor implied by mu*alpha', () => {
  const at = (decDeg) => propagateProperMotion({ raDeg: 0, decDeg, pmRaMasYr: 1000, pmDecMasYr: 0, refEpochJD: J2000_JD, targetEpochJD: J2000_JD + DAYS_10YR });
  assert.ok(Math.abs(at(60).raDeg / at(0).raDeg - 2) < 1e-6);
});

test('total displacement is hypot(mu*alpha, muDec)*dt at any declination', () => {
  const expected = (Math.hypot(1000, 500) * 10) / (3600 * 1000);
  for (const dec of [0, 45, 60, 89.9, -60]) {
    const r = propagateProperMotion({ raDeg: 30, decDeg: dec, pmRaMasYr: 1000, pmDecMasYr: 500, refEpochJD: J2000_JD, targetEpochJD: J2000_JD + DAYS_10YR });
    assert.ok(Math.abs(separationDeg(30, dec, r.raDeg, r.decDeg) - expected) < 1e-9, `dec ${dec}`);
  }
});

test('propagation is finite and well defined exactly at the pole', () => {
  const r = propagateProperMotion({ raDeg: 123, decDeg: 90, pmRaMasYr: 1000, pmDecMasYr: 0, refEpochJD: J2000_JD, targetEpochJD: J2000_JD + DAYS_10YR });
  assert.ok(Number.isFinite(r.raDeg) && Number.isFinite(r.decDeg), `ra ${r.raDeg} dec ${r.decDeg}`);
  assert.ok(Math.abs((90 - r.decDeg) - 10 / 3600) < 1e-9, `dec ${r.decDeg}`);
});

test('a target epoch before the reference reverses the motion', () => {
  const at = (targetEpochJD) => propagateProperMotion({ raDeg: 0, decDeg: 0, pmRaMasYr: 0, pmDecMasYr: 1000, refEpochJD: J2000_JD, targetEpochJD });
  assert.ok(Math.abs(at(J2000_JD + DAYS_10YR).decDeg - 10 / 3600) < 1e-12);
  assert.ok(Math.abs(at(J2000_JD - DAYS_10YR).decDeg + 10 / 3600) < 1e-12);
});

test('advanceAlongGreatCircle is an identity at zero angle and validates input', () => {
  const r = advanceAlongGreatCircle(42, -33, 0, 0);
  assert.ok(Math.abs(r.raDeg - 42) < 1e-9 && Math.abs(r.decDeg + 33) < 1e-12);
  assert.throws(() => advanceAlongGreatCircle(NaN, 0, 0, 0), TypeError);
  assert.throws(() => advanceAlongGreatCircle(0, 91, 0, 0), RangeError);
  assert.throws(() => propagateProperMotion({ raDeg: 0, decDeg: 0, refEpochJD: J2000_JD }), TypeError);
});
