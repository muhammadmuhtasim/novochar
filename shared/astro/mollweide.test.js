// Unit tests for the shared Mollweide whole-sky projection kernel.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MOLLWEIDE_ASPECT_RATIO,
  MOLLWEIDE_EXTENT,
  MOLLWEIDE_NAME,
  MOLLWEIDE_X_MAX,
  MOLLWEIDE_X_MIN,
  MOLLWEIDE_Y_MAX,
  MOLLWEIDE_Y_MIN,
  forward,
  inverse,
  isInsideMap,
  isValidLonLat,
  mollweide,
  mollweidePlaneToRaDec,
  raDecToMollweidePlane,
  solveTheta,
} from './mollweide.js';
import { angularSeparationArcsec } from './angular-distance.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const SQRT2 = Math.SQRT2;
const TWO_SQRT2 = 2 * SQRT2;
const HALF_PI = Math.PI / 2;
const RAD2DEG = 180 / Math.PI;

function unitVector(lonRad, latRad) {
  const c = Math.cos(latRad);
  return [c * Math.cos(lonRad), c * Math.sin(lonRad), Math.sin(latRad)];
}

/** Angular separation on the sphere, in arcseconds. */
function separationArcsec(lon1, lat1, lon2, lat2) {
  return angularSeparationArcsec(lon1 * RAD2DEG, lat1 * RAD2DEG, lon2 * RAD2DEG, lat2 * RAD2DEG);
}

test('definitional map points', () => {
  const origin = forward(0, 0);
  assert.ok(close(origin.x, 0) && close(origin.y, 0), `origin ${origin.x},${origin.y}`);

  const left = forward(-Math.PI, 0);
  assert.ok(close(left.x, -TWO_SQRT2) && close(left.y, 0), `left ${left.x},${left.y}`);

  const quarter = forward(Math.PI / 2, 0);
  assert.ok(close(quarter.x, SQRT2) && close(quarter.y, 0), `quarter ${quarter.x},${quarter.y}`);

  for (const lat of [HALF_PI, -HALF_PI]) {
    const p = forward(0.7, lat);
    assert.ok(close(p.x, 0) && close(p.y, Math.sign(lat) * SQRT2), `pole ${p.x},${p.y}`);
  }
});

test('the map is the canonical ellipse with aspect ratio 2', () => {
  assert.equal(MOLLWEIDE_ASPECT_RATIO, 2);
  assert.deepEqual(MOLLWEIDE_EXTENT, { xMin: -TWO_SQRT2, xMax: TWO_SQRT2, yMin: -SQRT2, yMax: SQRT2 });
  assert.equal(MOLLWEIDE_X_MIN, -TWO_SQRT2);
  assert.equal(MOLLWEIDE_X_MAX, TWO_SQRT2);
  assert.equal(MOLLWEIDE_Y_MIN, -SQRT2);
  assert.equal(MOLLWEIDE_Y_MAX, SQRT2);
  assert.equal(MOLLWEIDE_NAME, 'Mollweide (equal-area, whole sky)');
  assert.ok(isInsideMap(TWO_SQRT2, 0));
  assert.ok(!isInsideMap(TWO_SQRT2 * 1.01, 0));
});

test('the solver residual stays at machine precision', () => {
  for (let i = -90; i <= 90; i++) {
    const lat = (i * Math.PI) / 180;
    const theta = solveTheta(lat);
    const residual = 2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(lat);
    assert.ok(Math.abs(residual) < 1e-12, `lat ${i}: residual ${residual}`);
  }
  assert.equal(solveTheta(0), 0);
  assert.equal(solveTheta(HALF_PI), HALF_PI);
  assert.equal(solveTheta(-HALF_PI), -HALF_PI);
});

test('forward/inverse round-trip on the sphere', () => {
  let worst = 0;
  const count = 2000;
  for (let i = 0; i < count; i++) {
    const lon = -Math.PI + (i / count) * 2 * Math.PI;
    const lat = -HALF_PI + (i / count) * Math.PI;
    const p = forward(lon, lat);
    assert.ok(p, `forward null at ${lon},${lat}`);
    const back = inverse(p.x, p.y);
    assert.ok(back, `inverse null at ${p.x},${p.y}`);
    worst = Math.max(worst, separationArcsec(lon, lat, back.lonRad, back.latRad));
  }
  assert.ok(worst < 1e-6, `worst round-trip separation ${worst} arcsec`);
});

test('degree helpers round-trip and reject off-map input', () => {
  const plane = raDecToMollweidePlane(37.5, -12.25);
  assert.ok(plane, 'in-map plane coordinate');
  const back = mollweidePlaneToRaDec(plane.x, plane.y);
  assert.ok(back, 'in-map inverse');
  assert.ok(close(back.ra, 37.5), `ra ${back.ra}`);
  assert.ok(close(back.dec, -12.25), `dec ${back.dec}`);
  assert.equal(raDecToMollweidePlane(0, 91), null);
  assert.equal(raDecToMollweidePlane(0, NaN), null);
  assert.equal(mollweidePlaneToRaDec(10, 0), null);
});

test('invalid coordinates and off-map points return null (never NaN)', () => {
  assert.equal(forward(NaN, 0), null);
  assert.equal(forward(0, Infinity), null);
  assert.equal(forward(0, 2), null);
  assert.equal(inverse(10, 0), null);
  assert.equal(inverse(0, 5), null);
  assert.equal(inverse(NaN, 0), null);
  assert.equal(isValidLonLat(NaN, 0), false);
  assert.equal(isValidLonLat(0, Math.PI / 2), true);
  assert.equal(isValidLonLat(0, Math.PI * 1.01), false);
});

test('the descriptor contract is stable', () => {
  assert.equal(mollweide.id, 'mollweide');
  assert.equal(mollweide.name, MOLLWEIDE_NAME);
  assert.equal(mollweide.kind, 'whole-sky');
  assert.ok(close(mollweide.aspectRatio, 2));
  assert.equal(mollweide.bounds.xMax, TWO_SQRT2);
  assert.equal(mollweide.bounds.xMin, -TWO_SQRT2);
  assert.equal(mollweide.bounds.yMax, SQRT2);
  assert.equal(mollweide.bounds.yMin, -SQRT2);
});
