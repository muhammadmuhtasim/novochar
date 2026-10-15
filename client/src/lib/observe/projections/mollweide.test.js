// Mollweide projection tests: definitional values, solver residual, inverse
// round-trips, domain enforcement and the registry contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { forward, inverse, solveTheta, isInsideMap, mollweide } from './mollweide.js';
import { projections, getProjection, listProjections } from './index.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const SQRT2 = Math.SQRT2;
const TWO_SQRT2 = 2 * SQRT2;

test('definitional points', () => {
  const origin = forward(0, 0);
  assert.ok(close(origin.x, 0) && close(origin.y, 0), `origin ${origin.x},${origin.y}`);

  // Equator at the map edge: λ = ±π, φ = 0 -> x = ∓2√2, y = 0.
  const left = forward(-Math.PI, 0);
  assert.ok(close(left.x, -TWO_SQRT2) && close(left.y, 0), `left ${left.x},${left.y}`);

  // Equator at λ = π/2 -> x = √2.
  const quarter = forward(Math.PI / 2, 0);
  assert.ok(close(quarter.x, SQRT2) && close(quarter.y, 0), `quarter ${quarter.x}`);

  // Poles: x = 0, y = ±√2.
  for (const lat of [Math.PI / 2, -Math.PI / 2]) {
    const p = forward(0.7, lat);
    assert.ok(close(p.x, 0) && close(p.y, Math.sign(lat) * SQRT2), `pole ${p.x},${p.y}`);
  }
});

test('solver residual |2θ + sin2θ − π sinφ| is at machine precision', () => {
  for (let i = -90; i <= 90; i++) {
    const lat = (i * Math.PI) / 180;
    const theta = solveTheta(lat);
    const residual = 2 * theta + Math.sin(2 * theta) - Math.PI * Math.sin(lat);
    assert.ok(Math.abs(residual) < 1e-12, `lat ${i}: residual ${residual}`);
  }
  // Degenerate endpoints are handled explicitly.
  assert.equal(solveTheta(Math.PI / 2), Math.PI / 2);
  assert.equal(solveTheta(-Math.PI / 2), -Math.PI / 2);
});

test('forward then inverse round-trips across the sky', () => {
  let worstLon = 0;
  let worstLat = 0;
  for (let i = 0; i < 2000; i++) {
    const lon = -Math.PI + (i / 2000) * 2 * Math.PI;
    const lat = (-1 + (2 * i) / 2000) * (Math.PI / 2) * 0.999;
    const p = forward(lon, lat);
    assert.ok(p, `forward null at ${lon},${lat}`);
    const back = inverse(p.x, p.y);
    assert.ok(back, `inverse null at ${p.x},${p.y}`);
    let dLon = Math.abs(back.lonRad - lon) % (2 * Math.PI);
    dLon = Math.min(dLon, 2 * Math.PI - dLon);
    worstLon = Math.max(worstLon, dLon);
    worstLat = Math.max(worstLat, Math.abs(back.latRad - lat));
  }
  assert.ok(worstLon < 1e-9, `worst lon ${worstLon}`);
  assert.ok(worstLat < 1e-9, `worst lat ${worstLat}`);
});

test('central meridian rotates the map without changing the geometry', () => {
  const cm = Math.PI / 3;
  const p = forward(cm, 0, { centralMeridianRad: cm });
  assert.ok(close(p.x, 0) && close(p.y, 0), `cm origin ${p.x},${p.y}`);
  const back = inverse(SQRT2, 0, { centralMeridianRad: cm });
  assert.ok(close(back.lonRad, cm + Math.PI / 2), `cm inverse ${back.lonRad}`);
});

test('invalid coordinates and off-map points return null (never NaN)', () => {
  assert.equal(forward(NaN, 0), null);
  assert.equal(forward(0, Infinity), null);
  assert.equal(forward(0, 2), null); // |lat| > π/2
  assert.equal(inverse(10, 0), null); // outside the ellipse
  assert.equal(inverse(0, 5), null);
  assert.equal(inverse(NaN, 0), null);
  // The ellipse boundary itself is on the map.
  assert.ok(isInsideMap(TWO_SQRT2, 0));
  assert.ok(isInsideMap(0, SQRT2));
  assert.ok(!isInsideMap(TWO_SQRT2 * 1.01, 0));
});

test('the pole inverse is finite with longitude at the central meridian', () => {
  const top = inverse(0, SQRT2);
  assert.ok(close(top.latRad, Math.PI / 2) && close(top.lonRad, 0));
  const bottom = inverse(0, -SQRT2);
  assert.ok(close(bottom.latRad, -Math.PI / 2));
});

test('projection descriptor and registry contract', () => {
  assert.equal(mollweide.id, 'mollweide');
  assert.ok(close(mollweide.aspectRatio, 2), `aspect ${mollweide.aspectRatio}`);
  assert.equal(mollweide.bounds.xMax, TWO_SQRT2);
  assert.equal(getProjection('mollweide'), mollweide);
  assert.throws(() => getProjection('nope'), RangeError);
  assert.deepEqual(listProjections(), [{ id: 'mollweide', name: mollweide.name, kind: 'whole-sky' }]);
  assert.deepEqual(Object.keys(projections), ['mollweide']);
});
