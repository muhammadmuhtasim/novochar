// Unit tests for the sky-view coordinate mapping.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { advanceAlongGreatCircle, propagateProperMotion, raDecToSkyDirection } from './sky-coordinates.js';

function angularSeparationDeg(ra1, dec1, ra2, dec2) {
  const a = raDecToSkyDirection(ra1, dec1);
  const b = raDecToSkyDirection(ra2, dec2);
  const dot = Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  return Math.acos(dot) * 180 / Math.PI;
}

function length(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

test('RA 0h Dec 0° maps to [0, 0, -1]', () => {
  const v = raDecToSkyDirection(0, 0);
  assert.ok(Math.abs(v[0]) < 1e-12, 'x near zero');
  assert.ok(Math.abs(v[1]) < 1e-12, 'y near zero');
  assert.ok(Math.abs(v[2] + 1) < 1e-12, 'z -1');
});

test('positive declination moves toward +Y', () => {
  const v = raDecToSkyDirection(0, 45);
  assert.ok(v[1] > 0.7, 'Y up');
});

test('positive RA moves toward +X (right-handed)', () => {
  const v = raDecToSkyDirection(90, 0);
  assert.ok(v[0] > 0.9999, 'X forward-right');
  assert.ok(Math.abs(v[2]) < 1e-12, 'Z near zero');
});

test('direction remains unit length and RA wraps at 360 degrees', () => {
  const a = raDecToSkyDirection(360, 30);
  const b = raDecToSkyDirection(0, 30);
  assert.ok(Math.abs(length(a) - 1) < 1e-12);
  assert.ok(Math.abs(length(b) - 1) < 1e-12);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-12);
  assert.ok(Math.abs(a[1] - b[1]) < 1e-12);
  assert.ok(Math.abs(a[2] - b[2]) < 1e-12);
});

test('invalid declination and non-finite input are rejected', () => {
  assert.throws(() => raDecToSkyDirection(0, 95));
  assert.throws(() => raDecToSkyDirection(0, -95));
  assert.throws(() => raDecToSkyDirection(NaN, 0));
  assert.throws(() => raDecToSkyDirection(0, Infinity));
});

test('propagateProperMotion is a no-op at the reference epoch', () => {
  const r = propagateProperMotion({
    raDeg: 101.2871, decDeg: -16.7161,
    pmRaMasYr: -553, pmDecMasYr: -1205,
    refEpochJD: 2451545, targetEpochJD: 2451545,
  });
  assert.ok(Math.abs(r.ra - 101.2871) < 1e-12);
  assert.ok(Math.abs(r.dec - (-16.7161)) < 1e-12);
});

test('declination advances linearly with pmDec (1000 mas/yr over 10 yr = 10 arcsec)', () => {
  const r = propagateProperMotion({
    raDeg: 0, decDeg: 0, pmRaMasYr: 0, pmDecMasYr: 1000,
    refEpochJD: 2451545, targetEpochJD: 2451545 + 3652.5,
  });
  assert.ok(Math.abs(r.dec - 10 / 3600) < 1e-9, `dec ${r.dec}`);
});

test('projected RA motion (μ*α) is divided by cos(dec)', () => {
  // μ*α = 1000 mas/yr at dec 60° → Δα = 10000/cos60 = 20000 mas = 20 arcsec.
  const r = propagateProperMotion({
    raDeg: 0, decDeg: 60, pmRaMasYr: 1000, pmDecMasYr: 0,
    refEpochJD: 2451545, targetEpochJD: 2451545 + 3652.5,
  });
  assert.ok(Math.abs(r.ra - 20 / 3600) < 1e-9, `ra ${r.ra}`);
});

test('null (absent) proper motion leaves the position unchanged', () => {
  const r = propagateProperMotion({
    raDeg: 10, decDeg: -20, pmRaMasYr: null, pmDecMasYr: null,
    refEpochJD: 2451545, targetEpochJD: 2451545 + 36525,
  });
  assert.ok(Math.abs(r.ra - 10) < 1e-12);
  assert.ok(Math.abs(r.dec - (-20)) < 1e-12);
});

test('propagateProperMotion rejects non-finite inputs', () => {
  assert.throws(() => propagateProperMotion({ raDeg: 0, decDeg: 0, refEpochJD: 2451545 }), TypeError);
  assert.throws(() => propagateProperMotion({ raDeg: 0, decDeg: 95, refEpochJD: 0, targetEpochJD: 1 }), RangeError);
});

test('the RA change carries the cos(dec) factor implied by μ*α', () => {
  // μ*α is already the projected (tangent-plane) east component, so the same
  // projected motion produces twice the change in RA at dec 60° as at dec 0°.
  const at = (decDeg) => propagateProperMotion({
    raDeg: 0, decDeg, pmRaMasYr: 1000, pmDecMasYr: 0,
    refEpochJD: 2451545, targetEpochJD: 2451545 + 3652.5,
  });
  const ratio = at(60).ra / at(0).ra;
  assert.ok(Math.abs(ratio - 2) < 1e-6, `ratio ${ratio}`);
});

test('total angular displacement is hypot(μ*α, μδ)·Δt at any declination', () => {
  const years = 10;
  const expected = Math.hypot(1000, 500) * years / (3600 * 1000); // arcsec → degrees
  for (const dec of [0, 45, 60, 89.9, -60]) {
    const r = propagateProperMotion({
      raDeg: 30, decDeg: dec, pmRaMasYr: 1000, pmDecMasYr: 500,
      refEpochJD: 2451545, targetEpochJD: 2451545 + 3652.5,
    });
    const moved = angularSeparationDeg(30, dec, r.ra, r.dec);
    assert.ok(Math.abs(moved - expected) < 1e-9, `dec ${dec}: moved ${moved} vs ${expected}`);
  }
});

test('propagation is finite and well defined exactly at the celestial pole', () => {
  // cos(dec) = 0 here: the old Δ(RA) = μ*α/cos(dec) form would divide by zero.
  const r = propagateProperMotion({
    raDeg: 123, decDeg: 90, pmRaMasYr: 1000, pmDecMasYr: 0,
    refEpochJD: 2451545, targetEpochJD: 2451545 + 3652.5,
  });
  assert.ok(Number.isFinite(r.ra) && Number.isFinite(r.dec), `ra ${r.ra} dec ${r.dec}`);
  // Great-circle identity: asin(cos θ) = 90° − θ, so the star sits 10″ off the pole.
  assert.ok(Math.abs((90 - r.dec) - 10 / 3600) < 1e-9, `dec ${r.dec}`);
});

test('a target epoch before the reference reverses the motion', () => {
  const at = (targetEpochJD) => propagateProperMotion({
    raDeg: 0, decDeg: 0, pmRaMasYr: 0, pmDecMasYr: 1000,
    refEpochJD: 2451545, targetEpochJD,
  });
  assert.ok(Math.abs(at(2451545 + 3652.5).dec - 10 / 3600) < 1e-12);
  assert.ok(Math.abs(at(2451545 - 3652.5).dec + 10 / 3600) < 1e-12);
});

test('advanceAlongGreatCircle is an identity at zero angle and validates input', () => {
  const r = advanceAlongGreatCircle(42, -33, 0, 0);
  assert.ok(Math.abs(r.ra - 42) < 1e-12);
  assert.ok(Math.abs(r.dec - (-33)) < 1e-12);
  assert.throws(() => advanceAlongGreatCircle(NaN, 0, 0, 0), TypeError);
  assert.throws(() => advanceAlongGreatCircle(0, 91, 0, 0), RangeError);
});
