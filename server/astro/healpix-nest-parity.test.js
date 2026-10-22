// Parity between the shared HEALPix NEST helpers (used by the browser renderer)
// and the full server engine. If these ever drift, the GPU tile geometry stops
// matching the server-generated texture grid.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDERING,
  nside2npix,
  pix2angRaDec,
} from './healpix.js';
import {
  nside2npix as sharedNpix,
  pix2angRaDecNest,
  pixelCenterRaDec,
} from '@novochar/astro';

test('shared NEST helpers agree with the full engine at every pixel (order 0-4)', () => {
  for (const order of [0, 1, 2, 3, 4]) {
    const nside = 2 ** order;
    assert.equal(sharedNpix(nside), nside2npix(nside));
    const npix = nside2npix(nside);
    for (let ipix = 0; ipix < npix; ipix++) {
      const expected = pix2angRaDec(nside, ipix, ORDERING.NEST);
      const actual = pix2angRaDecNest(nside, ipix);
      assert.ok(Math.abs(expected.ra - actual.ra) < 1e-12, `ra order=${order} ipix=${ipix}`);
      assert.ok(Math.abs(expected.dec - actual.dec) < 1e-12, `dec order=${order} ipix=${ipix}`);
      if (ipix % 7 === 0) {
        assert.deepEqual(pixelCenterRaDec(order, ipix), actual);
      }
    }
  }
});
