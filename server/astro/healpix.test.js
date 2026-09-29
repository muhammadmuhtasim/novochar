// Server-side unit tests for the HEALPix spatial-index engine.
//
// Runs with the Node.js built-in test runner (no extra deps):
//   node --test astro/healpix.test.js
//
// The oracle vectors below come from Healpy / astropy-healpix reference
// outputs (documented in the docstrings of healpy.pixelfunc and the
// adam_core_rs_coords healpix.rs port that this implementation mirrors).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ORDERING,
  nside2npix,
  npix2nside,
  nside2order,
  order2nside,
  nside2resol,
  ang2pixLonLat,
  ang2pix,
  ang2pixRing,
  ang2pixNest,
  pix2ang,
  pix2angRing,
  pix2angNest,
  pix2angRaDec,
  ring2nest,
  nest2ring,
  raDecToPixel,
} from './healpix.js';

const close = (a, b, tol = 1e-9) =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test('npix / nside helpers are consistent', () => {
  assert.equal(nside2npix(1), 12);
  assert.equal(nside2npix(2), 48);
  assert.equal(nside2npix(16), 3072);
  assert.equal(npix2nside(12), 1);
  assert.equal(npix2nside(3072), 16);
  assert.equal(nside2order(1), 0);
  assert.equal(nside2order(16), 4);
  assert.equal(nside2order(3), -1);
  assert.equal(order2nside(4), 16);
  // resolution scales as ~1/nside
  const r64 = nside2resol(64);
  const r32 = nside2resol(32);
  assert.ok(close(r64 * 2, r32, 1e-12));
});

test('ring scheme: healpy nside=1 equator/pole anchors', () => {
  assert.equal(ang2pixLonLat(1, 0, 0, ORDERING.RING), 4);
  assert.equal(ang2pixLonLat(1, 0, 90, ORDERING.RING), 0);
  assert.equal(ang2pixLonLat(1, 0, -90, ORDERING.RING), 8);
});

test('nest scheme: healpy pixel-center oracle (nside=16)', () => {
  const centers = [
    [47.8125, 4.780191847199163, 1],
    [42.1875, 4.780191847199163, 2],
    [45.0, 7.180755781458288, 3],
    [50.62499999999999, 7.180755781458288, 4],
    [53.4375, 9.594068226860458, 5],
  ];
  for (const [lon, lat, pix] of centers) {
    assert.equal(ang2pixLonLat(16, lon, lat, ORDERING.NEST), pix);
    // reverse must reproduce the same center back-to-front
    const c = pix2angRaDec(16, pix, ORDERING.NEST);
    assert.ok(close(c.ra, lon, 1e-9), `ra ${c.ra} vs ${lon}`);
    assert.ok(close(c.dec, lat, 1e-9), `dec ${c.dec} vs ${lat}`);
  }
});

test('ring scheme: healpy pix2ang(16, 1440) oracle', () => {
  const { theta, phi } = pix2angRing(16, 1440);
  assert.ok(close(theta, 1.5291175943723188, 1e-12), `theta ${theta}`);
  assert.ok(close(phi, 0.0, 1e-12), `phi ${phi}`);
});

test('ring scheme: healpy pix2ang([1,2,4,8], 11) oracle', () => {
  const expThetas = [2.30052398, 0.84106867, 0.41113786, 0.2044802];
  const expPhis = [5.49778714, 5.89048623, 5.89048623, 5.89048623];
  [1, 2, 4, 8].forEach((ns, i) => {
    const { theta, phi } = pix2angRing(ns, 11);
    assert.ok(close(theta, expThetas[i], 1e-6), `theta ns${ns}: ${theta}`);
    assert.ok(close(phi, expPhis[i], 1e-6), `phi ns${ns}: ${phi}`);
  });
});

test('ring <-> nest conversions match healpy oracles', () => {
  assert.equal(ring2nest(16, 1504), 1130);
  assert.equal(nest2ring(16, 1130), 1504);
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => nest2ring(2, i)),
    [13, 5, 4, 0, 15, 7, 6, 1, 17, 9]
  );
  assert.deepEqual(
    Array.from({ length: 10 }, (_, i) => ring2nest(2, i)),
    [3, 7, 11, 15, 2, 1, 6, 5, 10, 9]
  );
  assert.deepEqual([1, 2, 4, 8].map((ns) => ring2nest(ns, 11)), [11, 13, 61, 253]);
});

test('pixel centres map back to themselves in both schemes (aliased API)', () => {
  for (const scheme of [ORDERING.RING, ORDERING.NEST]) {
    for (const ns of [2, 4, 16]) {
      for (let p = 0; p < Math.min(256, nside2npix(ns)); p++) {
        assert.equal(ang2pix(ns, pix2ang(ns, p, scheme).theta, pix2ang(ns, p, scheme).phi, scheme), p, `${scheme} ns${ns} pix${p}`);
      }
    }
  }
});

test('exhaustive round-trip: ang2pix(pix2ang(p)) == p for every pixel', () => {
  for (const scheme of [ORDERING.RING, ORDERING.NEST]) {
    for (const ns of [1, 2, 4, 8, 16, 32]) {
      const N = nside2npix(ns);
      for (let p = 0; p < N; p++) {
        const { theta, phi } = pix2ang(ns, p, scheme);
        assert.equal(ang2pix(ns, theta, phi, scheme), p, `${scheme} ns${ns} pix${p}`);
      }
    }
  }
});

test('ring2nest / nest2ring are mutually inverse for every pixel', () => {
  for (const ns of [1, 2, 4, 8, 32]) {
    const N = nside2npix(ns);
    for (let p = 0; p < N; p++) {
      assert.equal(ring2nest(ns, nest2ring(ns, p)), p);
      assert.equal(nest2ring(ns, ring2nest(ns, p)), p);
    }
  }
});

test('raDecToPixel is consistent with ang2pixLonLat', () => {
  for (const ns of [4, 16]) {
    for (const [ra, dec] of [[10, 20], [180, -45], [359.9, 89.9], [0, 0]]) {
      assert.equal(raDecToPixel(ns, ra, dec), ang2pixLonLat(ns, ra, dec, ORDERING.RING));
      assert.equal(
        raDecToPixel(ns, ra, dec, ORDERING.NEST),
        ang2pixLonLat(ns, ra, dec, ORDERING.NEST)
      );
    }
  }
});

test('convenience aliases export the schemes', () => {
  const ra = 45;
  const dec = 60;
  const theta = (90 - dec) * (Math.PI / 180);
  const phi = ra * (Math.PI / 180);
  assert.equal(ang2pixRing(16, theta, phi), ang2pix(16, theta, phi, ORDERING.RING));
  assert.equal(ang2pixNest(16, theta, phi), ang2pix(16, theta, phi, ORDERING.NEST));
  assert.deepEqual(
    pix2angRing(16, 0),
    pix2ang(16, 0, ORDERING.RING)
  );
  assert.deepEqual(pix2angNest(16, 0), pix2ang(16, 0, ORDERING.NEST));
});