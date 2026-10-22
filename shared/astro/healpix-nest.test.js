// Unit tests for the shared HEALPix NEST tile-pyramid helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_NSIDE_NEST,
  angularDistanceRad,
  checkNside,
  nest2xyf,
  nestChildren,
  nestParent,
  nside2npix,
  nside2order,
  nside2resolRad,
  order2nside,
  pix2angRaDecNest,
  pix2xyzNest,
  pixelCenterRaDec,
  tileHalfAngleRad,
  xyf2nest,
} from './healpix-nest.js';

const close = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test('nside / npix / order helpers are consistent', () => {
  assert.equal(nside2npix(1), 12);
  assert.equal(nside2npix(2), 48);
  assert.equal(nside2npix(16), 3072);
  assert.equal(nside2order(1), 0);
  assert.equal(nside2order(16), 4);
  assert.equal(order2nside(0), 1);
  assert.equal(order2nside(4), 16);
  assert.ok(close(nside2resolRad(2) * 2, nside2resolRad(1), 1e-12));
  assert.ok(close(tileHalfAngleRad(2) * 2, tileHalfAngleRad(1), 1e-12));
});

test('NEST pixel centres are finite unit vectors', () => {
  for (const nside of [1, 2, 4, 8]) {
    const n = nside2npix(nside);
    for (let ipix = 0; ipix < n; ipix++) {
      const [x, y, z] = pix2xyzNest(nside, ipix);
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z), `finite nside=${nside} ipix=${ipix}`);
      assert.ok(close(Math.hypot(x, y, z), 1, 1e-9), `unit nside=${nside} ipix=${ipix}`);
      const { ra, dec } = pix2angRaDecNest(nside, ipix);
      assert.ok(ra >= 0 && ra < 360, `ra range nside=${nside} ipix=${ipix}`);
      assert.ok(dec >= -90 && dec <= 90, `dec range nside=${nside} ipix=${ipix}`);
    }
  }
});

test('nested children keep the parent prefix and stay inside the parent footprint', () => {
  for (const order of [0, 1, 2, 3]) {
    const nside = order2nside(order);
    const parentResol = nside2resolRad(nside);
    const n = nside2npix(nside);
    for (let parent = 0; parent < n; parent++) {
      const p = pixelCenterRaDec(order, parent);
      const children = nestChildren(parent);
      for (const child of children) {
        assert.equal(nestParent(child), parent);
        const c = pix2angRaDecNest(nside * 2, child);
        const sep = angularDistanceRad(p.ra, p.dec, c.ra, c.dec);
        assert.ok(sep < 1.1 * parentResol, `child ${child} of ${parent} escaped (${sep} > ${parentResol})`);
      }
    }
  }
});

test('(face, ix, iy) <-> NEST round-trips for every pixel at low orders', () => {
  for (const nside of [1, 2, 4, 8]) {
    const n = nside2npix(nside);
    for (let ipix = 0; ipix < n; ipix++) {
      const { ix, iy, face } = nest2xyf(ipix, nside);
      assert.equal(xyf2nest(ix, iy, face, nside), ipix);
      assert.ok(ix >= 0 && ix < nside);
      assert.ok(iy >= 0 && iy < nside);
      assert.ok(face >= 0 && face < 12);
    }
  }
});

test('pixelCenterRaDec is the order-addressed form of pix2angRaDecNest', () => {
  for (const order of [0, 1, 2]) {
    const nside = order2nside(order);
    for (let ipix = 0; ipix < nside2npix(nside); ipix += 7) {
      assert.deepEqual(
        pixelCenterRaDec(order, ipix),
        pix2angRaDecNest(nside, ipix),
      );
    }
  }
});

test('angular distance is symmetric, zero at identity, and pi at the antipode', () => {
  assert.equal(angularDistanceRad(12, 34, 12, 34), 0);
  assert.ok(close(angularDistanceRad(12, 34, 192, -34), Math.PI, 1e-12));
  const a = angularDistanceRad(12, 34, 200, -10);
  const b = angularDistanceRad(200, -10, 12, 34);
  assert.ok(close(a, b, 1e-12));
});

test('invalid nside and pixel addresses are rejected', () => {
  assert.equal(checkNside(1 << 16), 1 << 16);
  assert.throws(() => checkNside(3), RangeError);
  assert.throws(() => checkNside(1 << 17), RangeError);
  assert.throws(() => nside2npix(0), RangeError);
  assert.throws(() => pix2xyzNest(2, 48), RangeError);
  assert.throws(() => pix2xyzNest(2, -1), RangeError);
  assert.throws(() => xyf2nest(2, 0, 0, 2), RangeError);
  assert.throws(() => order2nside(17), RangeError);
  assert.equal(MAX_NSIDE_NEST, 1 << 16);
});
