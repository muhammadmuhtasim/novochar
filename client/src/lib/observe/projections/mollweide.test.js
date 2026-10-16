// Mollweide projection tests: definitional values, solver residual, inverse
// round-trips, domain enforcement and the registry contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { forward, inverse, solveTheta, isInsideMap, mollweide } from './mollweide.js';
import { projections, getProjection, listProjections } from './index.js';

const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const SQRT2 = Math.SQRT2;
const TWO_SQRT2 = 2 * SQRT2;
const ARCSEC_PER_RAD = (180 / Math.PI) * 3600;

/** Unit vector for (lon, lat) in radians. */
function unitVector(lonRad, latRad) {
  const c = Math.cos(latRad);
  return [c * Math.cos(lonRad), c * Math.sin(lonRad), Math.sin(latRad)];
}

/**
 * Angular separation on the sphere, in arcseconds. Well-conditioned at the
 * poles and across the longitude seam, unlike a raw longitude difference.
 */
function separationArcsec(lon1, lat1, lon2, lat2) {
  const u = unitVector(lon1, lat1);
  const v = unitVector(lon2, lat2);
  const cross = [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.atan2(Math.hypot(...cross), dot) * ARCSEC_PER_RAD;
}

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

test('forward/inverse round-trips are exact on the sphere', () => {
  // Compare angular separation on the unit sphere, not raw longitude: near the
  // poles (and across the ±π seam) longitude is ill-conditioned, so a raw
  // longitude difference is not a physical positional error.
  let worst = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    const lon = -Math.PI + (i / N) * 2 * Math.PI;
    const lat = (-1 + (2 * i) / N) * (Math.PI / 2) * 0.999;
    const p = forward(lon, lat);
    assert.ok(p, `forward null at ${lon},${lat}`);
    const back = inverse(p.x, p.y);
    assert.ok(back, `inverse null at ${p.x},${p.y}`);
    worst = Math.max(worst, separationArcsec(lon, lat, back.lonRad, back.latRad));
  }
  assert.ok(worst < 1e-6, `worst round-trip separation ${worst} arcsec`);
});

test('round-trips hold at the poles and across the longitude seam', () => {
  // Exact poles: inverse returns finite coordinates with longitude at the
  // central meridian, and the latitude is preserved.
  for (const lat of [Math.PI / 2, -Math.PI / 2]) {
    const p = forward(2.1, lat);
    const back = inverse(p.x, p.y);
    assert.ok(back && Math.abs(back.latRad - lat) < 1e-12, `pole lat ${back && back.latRad}`);
    assert.ok(close(back.lonRad, 0), `pole lon ${back.lonRad}`);
  }

  // Near-pole round-trip: the inverse is inherently ill-conditioned within
  // ~1e-6 rad of a pole (the plane coordinate y approaches √2 and can no longer
  // resolve latitude), so the bound is a few milliarcseconds rather than
  // machine precision — but it must not blow up.
  for (const lat of [Math.PI / 2 - 1e-9, -Math.PI / 2 + 1e-9, Math.PI / 2 - 1e-6]) {
    const p = forward(1.234, lat);
    const back = inverse(p.x, p.y);
    const sep = separationArcsec(1.234, lat, back.lonRad, back.latRad);
    assert.ok(sep < 1e-2, `near-pole sep ${sep} arcsec at lat ${lat}`);
  }

  // Longitude seam: +π and −π are the same sky direction and the same map edge.
  const plus = forward(Math.PI, 0.3);
  const minus = forward(-Math.PI, 0.3);
  assert.ok(close(plus.x, minus.x, 1e-12) && close(plus.y, minus.y, 1e-12));
  const back = inverse(plus.x, plus.y);
  assert.ok(separationArcsec(Math.PI, 0.3, back.lonRad, back.latRad) < 1e-9);
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

test('non-finite options are rejected (never a NaN point)', () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.equal(forward(0, 0, { centralMeridianRad: bad }), null);
    assert.equal(inverse(0, 0, { centralMeridianRad: bad }), null);
    // A valid lon/lat with a bad central meridian must still not emit NaN.
    const p = forward(1, 0.5, { centralMeridianRad: bad });
    assert.ok(p === null || (Number.isFinite(p.x) && Number.isFinite(p.y)));
  }
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

test('every registered projection satisfies the descriptor contract', () => {
  // Generic: adding a future projection must not need this test to change.
  const ids = Object.keys(projections);
  assert.ok(ids.length >= 1);
  for (const id of ids) {
    const p = getProjection(id);
    assert.equal(p.id, id, `id mismatch for ${id}`);
    assert.ok(typeof p.name === 'string' && p.name.length > 0, `${id} name`);
    assert.ok(typeof p.kind === 'string' && p.kind.length > 0, `${id} kind`);
    assert.ok(typeof p.aspectRatio === 'number' && p.aspectRatio > 0, `${id} aspectRatio`);

    const { bounds } = p;
    assert.ok(bounds && typeof bounds === 'object', `${id} bounds`);
    for (const k of ['xMin', 'xMax', 'yMin', 'yMax']) {
      assert.ok(typeof bounds[k] === 'number' && Number.isFinite(bounds[k]), `${id} bounds.${k}`);
    }
    assert.ok(bounds.xMin < bounds.xMax && bounds.yMin < bounds.yMax, `${id} bounds order`);

    for (const m of ['forward', 'inverse', 'isValidLonLat', 'isInsideMap']) {
      assert.equal(typeof p[m], 'function', `${id}.${m}`);
    }

    // Behavioural contract: invalid input never throws and never yields NaN.
    assert.equal(p.forward(NaN, 0), null, `${id} forward NaN`);
    assert.equal(p.forward(0, 2), null, `${id} forward out-of-range lat`);
    assert.equal(p.inverse(NaN, 0), null, `${id} inverse NaN`);
    assert.equal(p.forward(0, 0, { centralMeridianRad: NaN }), null, `${id} bad option`);
    const c = p.forward(0, 0);
    assert.ok(c !== null && Number.isFinite(c.x) && Number.isFinite(c.y), `${id} origin finite`);
    assert.ok(p.isInsideMap(c.x, c.y), `${id} origin inside map`);
    assert.equal(typeof p.isValidLonLat(0, 0), 'boolean', `${id} isValidLonLat`);
  }
});
