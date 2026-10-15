// Unit-vector / spherical conversion tests (scientific basis).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sphericalToUnit,
  unitToSpherical,
  normalizeRaDeg,
  normalizeVector,
  norm,
  dot,
  cross,
} from './vector.js';

const close = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol;

test('the documented scientific basis is used (RA=0,Dec=0 -> +X)', () => {
  const [x, y, z] = sphericalToUnit(0, 0);
  assert.ok(close(x, 1) && close(y, 0) && close(z, 0), `[${x},${y},${z}]`);
  // RA=90 on the equator -> +Y; NCP -> +Z
  const v90 = sphericalToUnit(90, 0);
  assert.ok(close(v90[0], 0) && close(v90[1], 1) && close(v90[2], 0));
  const ncp = sphericalToUnit(0, 90);
  assert.ok(close(ncp[2], 1));
});

test('direction is unit length and RA is periodic', () => {
  for (const [ra, dec] of [[0, 0], [123.4, -56.7], [359.99, 89.99], [0, -90], [400, 10]]) {
    assert.ok(close(norm(sphericalToUnit(ra, dec)), 1));
  }
  const a = sphericalToUnit(10, 20);
  const b = sphericalToUnit(370, 20);
  assert.ok(close(a[0], b[0]) && close(a[1], b[1]) && close(a[2], b[2]));
});

test('spherical <-> vector round-trips (mod RA at the poles)', () => {
  for (const [ra, dec] of [[0, 0], [123.4, -56.7], [359.99, 89.99], [0, -90]]) {
    const back = unitToSpherical(sphericalToUnit(ra, dec));
    assert.ok(close(back.decDeg, dec, 1e-9), `dec ${back.decDeg} vs ${dec}`);
    if (Math.abs(dec) < 89.999999) {
      const dRa = Math.abs(normalizeRaDeg(back.raDeg - ra)) % 360;
      assert.ok(Math.min(dRa, 360 - dRa) < 1e-9, `ra ${back.raDeg} vs ${ra}`);
    }
  }
});

test('normalizeRaDeg wraps into [0, 360)', () => {
  assert.equal(normalizeRaDeg(-10), 350);
  assert.equal(normalizeRaDeg(370), 10);
  assert.equal(normalizeRaDeg(360), 0);
});

test('invalid input is rejected', () => {
  assert.throws(() => sphericalToUnit(NaN, 0), TypeError);
  assert.throws(() => sphericalToUnit(0, Infinity), TypeError);
  assert.throws(() => sphericalToUnit(0, 91), RangeError);
  assert.throws(() => sphericalToUnit(0, -91), RangeError);
  assert.throws(() => unitToSpherical([0, 0, 0]), RangeError);
  assert.throws(() => unitToSpherical([0, 0, NaN]), TypeError);
  assert.throws(() => normalizeVector([0, 0, 0]), RangeError);
});

test('vector helpers behave', () => {
  assert.equal(dot([1, 0, 0], [0, 1, 0]), 0);
  assert.deepEqual(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assert.ok(close(norm([3, 4, 0]), 5));
});
