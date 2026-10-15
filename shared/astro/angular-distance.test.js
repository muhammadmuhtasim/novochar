// Angular separation tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { angularSeparationDeg, angularSeparationArcsec } from './angular-distance.js';
import { sphericalToUnit } from './vector.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

// Independent reference via the same atan2 identity, written out longhand.
function vecSep(ra1, dec1, ra2, dec2) {
  const u = sphericalToUnit(ra1, dec1);
  const v = sphericalToUnit(ra2, dec2);
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return (Math.atan2(Math.hypot(...c), d) * 180) / Math.PI;
}

test('simple geometries and symmetry', () => {
  assert.equal(angularSeparationDeg(45.123, -12.5, 45.123, -12.5), 0);
  assert.ok(close(angularSeparationDeg(0, 0, 0, 1), 1, 1e-9));
  assert.ok(close(angularSeparationDeg(0, 0, 1, 0), 1, 1e-9));
  assert.ok(close(angularSeparationDeg(0, 0, 180, 0), 180));
  const a = angularSeparationDeg(12.34, 56.78, 200.11, -30.5);
  const b = angularSeparationDeg(200.11, -30.5, 12.34, 56.78);
  assert.ok(close(a, b, 1e-12));
  assert.ok(close(angularSeparationArcsec(0, 0, 0, 0.5), 1800, 1e-6));
});

test('small angles stay finite and positive (atan2 form)', () => {
  const near = angularSeparationDeg(45.123, -12.5, 45.1230001, -12.5000001);
  assert.ok(Number.isFinite(near) && near > 0 && near < 1e-5, `near ${near}`);
});

test('RA wrap and pole conditioning', () => {
  const wrap = angularSeparationDeg(359.999999, 0, 0.000001, 0);
  assert.ok(close(wrap, 2e-6, 1e-8), `wrap ${wrap}`);
  const polar = angularSeparationDeg(0, 89.5, 1, 89.5);
  assert.ok(close(polar, vecSep(0, 89.5, 1, 89.5)), `polar ${polar}`);
});

test('randomized cross-check, pole- and wrap-inclusive', () => {
  for (let i = 0; i < 600; i++) {
    const ra1 = (i * 97.3) % 360;
    const dec1 = -89.99 + ((i * 31) % 179.98) + Math.sin(i) * 0.005;
    const ra2 = ((i * 53.7) + 120) % 360;
    const dec2 = -89.99 + ((i * 7) % 179.98) - Math.cos(i) * 0.005;
    const a = angularSeparationDeg(ra1, dec1, ra2, dec2);
    assert.ok(Number.isFinite(a), `finite trial ${i}`);
    assert.ok(close(a, vecSep(ra1, dec1, ra2, dec2)), `trial ${i}: ${a}`);
  }
});
