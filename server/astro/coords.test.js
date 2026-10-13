// Server-side unit tests for equatorial <-> galactic coordinate conversion.
//
//   node --test astro/coords.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  raDecToGalactic,
  galacticToRaDec,
  angularSeparationDeg,
  angularSeparationArcsec,
  raDecToVector,
  vectorToRaDec,
} from './coords.js';

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test('Galactic centre in equatorial coordinates', () => {
  // l=0, b=0 is the direction of Sagittarius A* (IAU 1958 definition)
  const { ra, dec } = galacticToRaDec(0, 0);
  assert.ok(close(ra, 266.405, 1e-3), `ra ${ra}`);
  assert.ok(close(dec, -28.936, 1e-3), `dec ${dec}`);
  const back = raDecToGalactic(ra, dec);
  assert.ok(close(back.l, 0, 1e-3), `l ${back.l}`);
  assert.ok(close(back.b, 0, 1e-3), `b ${back.b}`);
});

test('Galactic north pole maps to b = +90 (astropy _ngp_J2000)', () => {
  const g = raDecToGalactic(192.8594812065348, 27.12825118085622);
  assert.ok(close(g.b, 90, 1e-6), `b ${g.b}`);
});

test('North Celestial Pole galactic longitude equals astropy _lon0_J2000', () => {
  const g = raDecToGalactic(0, 90);
  assert.ok(close(g.l, 122.9319185680026, 1e-6), `l ${g.l}`);
  assert.ok(close(g.b, 27.12825118085622, 1e-6), `b ${g.b}`);
});

test('forward/reverse round-trips are lossless across the sky', () => {
  let worst = 0;
  for (let i = 0; i < 5000; i++) {
    const ra = (i * 67.1) % 360;
    const dec = ((i % 17) - 8) * 2.5 + Math.sin(i);
    const g = raDecToGalactic(ra, dec);
    const eq = galacticToRaDec(g.l, g.b);
    const dRa = Math.abs(eq.ra - ra) % 360;
    const sep = Math.min(dRa, 360 - dRa);
    worst = Math.max(worst, sep, Math.abs(eq.dec - dec));
  }
  assert.ok(worst < 1e-9, `worst round-trip error ${worst}`);
});

test('angular separation is symmetric and matches simple geometries', () => {
  assert.ok(close(angularSeparationDeg(0, 0, 0, 0), 0));
  assert.ok(close(angularSeparationDeg(0, 0, 0, 1), 1)); // 1 deg north
  assert.ok(close(angularSeparationDeg(0, 0, 1, 0), 1)); // 1 deg RA @ dec 0
  assert.ok(close(angularSeparationDeg(0, 0, 180, 0), 180)); // antipode
  // symmetry
  const a = angularSeparationDeg(12.34, 56.78, 200.11, -30.5);
  const b = angularSeparationDeg(200.11, -30.5, 12.34, 56.78);
  assert.ok(close(a, b, 1e-12));
  // arcsec variant
  assert.ok(close(angularSeparationArcsec(0, 0, 0, 0.5), 1800, 1e-6));
});

test('raDecToVector / vectorToRaDec round-trip', () => {
  for (const [ra, dec] of [[0, 0], [123.4, -56.7], [359.99, 89.99], [0, -90]]) {
    const v = raDecToVector(ra, dec);
    // unit length
    assert.ok(close(Math.hypot(...v), 1, 1e-12));
    const back = vectorToRaDec(v[0], v[1], v[2]);
    assert.ok(close(back.dec, dec, 1e-9), `dec ${back.dec} vs ${dec}`);
  }
});

test('angular separation stays finite and matches an independent vector formula', () => {
  // reference: theta = atan2(|u x v|, u . v) for unit vectors u, v
  const vec = (ra, dec) => {
    const a = (ra * Math.PI) / 180;
    const d = (dec * Math.PI) / 180;
    return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  };
  const vecSep = (ra1, dec1, ra2, dec2) => {
    const u = vec(ra1, dec1);
    const v = vec(ra2, dec2);
    const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return (Math.atan2(Math.hypot(...cross), dot) * 180) / Math.PI;
  };

  // identical and near-identical points must not produce NaN (A-06 clamp)
  assert.equal(angularSeparationDeg(45.123, -12.5, 45.123, -12.5), 0);
  const near = angularSeparationDeg(45.123, -12.5, 45.1230001, -12.5000001);
  assert.ok(Number.isFinite(near) && near > 0 && near < 1e-5, `near ${near}`);

  // antipodal points
  assert.ok(close(angularSeparationDeg(0, 0, 180, 0), 180, 1e-9));
  assert.ok(close(angularSeparationDeg(90, 0, 270, 0), 180, 1e-9));

  // RA wraparound across 0/360 on the equator: Δα = 2e-6° → 0.0072″ separation
  const wrap = angularSeparationDeg(359.999999, 0, 0.000001, 0);
  assert.ok(Number.isFinite(wrap) && close(wrap, 2e-6, 1e-8), `wrap ${wrap}`);

  // high declination: east-west offsets shrink by cos(dec)
  const polar = angularSeparationDeg(0, 89.5, 1, 89.5);
  const polarVec = vecSep(0, 89.5, 1, 89.5);
  assert.ok(close(polar, polarVec, 1e-9), `polar ${polar} vs ${polarVec}`);

  // randomized cross-check against the vector formula, pole- and wrap-inclusive
  for (let i = 0; i < 600; i++) {
    const ra1 = (i * 97.3) % 360;
    const dec1 = -89.99 + ((i * 31) % 179.98) + Math.sin(i) * 0.05;
    const ra2 = ((i * 53.7) + 120) % 360;
    const dec2 = -89.99 + ((i * 7) % 179.98) - Math.cos(i) * 0.05;
    const a = angularSeparationDeg(ra1, dec1, ra2, dec2);
    const b = vecSep(ra1, dec1, ra2, dec2);
    assert.ok(Number.isFinite(a), `finite trial ${i}`);
    assert.ok(close(a, b, 1e-9), `trial ${i}: ${a} vs ${b}`);
  }
});