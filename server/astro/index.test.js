// Tests for the Processing/Matching layer public API surface (barrel exports).
//
//   node --test astro/index.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  convertCoordinates,
  raDecToGalactic,
  galacticToRaDec,
  angularSeparationArcsec,
  raDecToPixel,
  pix2angRaDec,
  separationArcsec,
  ORDERING,
  nside2npix,
} from './index.js';

test('barrel exposes the coordinate + HEALPix + cross-match APIs', () => {
  for (const fn of [
    raDecToGalactic,
    galacticToRaDec,
    angularSeparationArcsec,
    raDecToPixel,
    pix2angRaDec,
    separationArcsec,
  ]) {
    assert.equal(typeof fn, 'function');
  }
  assert.equal(nside2npix(4), 192);
  assert.equal(ORDERING.RING, 'RING');
  assert.equal(ORDERING.NEST, 'NEST');
});

test('convertCoordinates normalises an archive row and bins to HEALPix', () => {
  // A bright, well-known source: Sirius A (ICRS J2000).
  // RA 06h45m08.9s ≈ 101.287°, Dec −16°42'58" ≈ −16.716°
  const ra = 101.287155;
  const dec = -16.716116;
  const out = convertCoordinates(ra, dec, 64);
  assert.ok(Math.abs(out.ra - ra) < 1e-9);
  assert.ok(Math.abs(out.dec - dec) < 1e-9);
  // with a HEALPix cell, the cell center is ~within a pixel radius of input
  const px = out.healpix;
  assert.ok(Number.isInteger(px.pixel) && px.pixel >= 0 && px.pixel < nside2npix(64));
  assert.ok(
    separationArcsec(ra, dec, px.center.ra, px.center.dec) < 3300
  );
  // round the pixel through the index to confirm it is self-consistent
  assert.equal(raDecToPixel(64, px.center.ra, px.center.dec), px.pixel);
});

test('convertCoordinates returns galactic transform without a pixel', () => {
  const out = convertCoordinates(266.405, -28.936);
  assert.ok(Math.abs(out.galactic.l) < 0.001);
  assert.ok(Math.abs(out.galactic.b) < 0.001);
  assert.equal(out.healpix, undefined);
});

test('separationArcsec matches angularSeparationArcsec', () => {
  assert.equal(separationArcsec(0, 0, 0, 1), angularSeparationArcsec(0, 0, 0, 1));
});