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